/**
 * Soft evidence from observations (docs/DEDUCTION_ENGINE.md §3.1, §3.2, §3.4, §3.5).
 * One small function per rule; each returns EvidenceItem[] with refs to the
 * observations it used. Weights come from data/tactics/weights.json.
 */
import type { MatchState, EvidenceItem, BodyFoundObs, SightingObs, PlayerId, MarkReason } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { isDeadEnd } from './map';
import { killWindow } from './feasibility';
import { ev, fmt } from './evidence';
import { markHistory, markLabel, markWeight } from './marks';
import { chatAssertions, chatPlaced } from './chatEvidence';
import { roundOfMeeting } from './history';

const W = weightsJson;
const roomName = (m: MatchState, r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
const pname = (m: MatchState, p: string) => m.players[p]?.name ?? p;
const bodies = (m: MatchState) => m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
const sightings = (m: MatchState) => m.observations.filter((o): o is SightingObs => o.type === 'sighting');
const isAlone = (s: SightingObs) => s.alone ?? (!s.withPlayers || s.withPlayers.length === 0);

// ---------------------------------------------------------------------------
// Manual
// ---------------------------------------------------------------------------

/** The user's latest mark per player (for the card's mark chip). Scoring uses every mark in force: `markHistory`. */
export function userMarks(m: MatchState): Map<PlayerId, { mark: 'sus' | 'clear' | 'hardClear'; id: string; round: number; reason?: MarkReason }> {
  const out = new Map<PlayerId, { mark: 'sus' | 'clear' | 'hardClear'; id: string; round: number; reason?: MarkReason }>();
  for (const [player, list] of markHistory(m)) {
    const last = list[list.length - 1];
    out.set(player, { mark: last.mark, id: last.id, round: last.round, reason: last.reason });
  }
  return out;
}

/** Sus / round-clear marks, one item per distinct reason in force (hard clears are hard facts in suspicion.ts). */
export function ruleManualMarks(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const [player, list] of markHistory(m)) {
    for (const k of list) {
      if (k.mark === 'hardClear') continue;
      const e = ev(player, markWeight(k.mark, k.reason, k.weight), 'manual', markLabel(k.mark, k.reason), [k.id]);
      e.round = k.round;
      out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Movement / positioning
// ---------------------------------------------------------------------------

export function ruleSelfReport(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const o of bodies(m)) {
    if (!o.reporter) continue;
    const alone = !o.present || o.present.filter(p => p !== o.reporter).length === 0;
    if (!alone) continue;
    let w = W.movement.selfReportAlone;
    const dead = isDeadEnd(m.map, o.room);
    if (dead) w += W.movement.selfReportDeadEndBonus;
    out.push(ev(o.reporter, w, 'movement', `Self-reported alone in ${roomName(m, o.room)}${dead ? ' (dead end)' : ''}`, [o.id], !m.map._verified.rooms, 'self_report',
      { P: pname(m, o.reporter), R: roomName(m, o.room), V: pname(m, o.victim) }));
  }
  return out;
}

/** Last seen alone heading toward / in the body room inside the kill window; vent-only reachability. */
export function ruleProximityToKill(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const b of bodies(m)) {
    const t0 = Math.max(0, b.stamp.t - W.killWindow.defaultSec);
    for (const s of sightings(m)) {
      if (s.stamp.round !== b.stamp.round || s.stamp.t < t0 || s.stamp.t > b.stamp.t || s.player === b.victim) continue;
      const towardBody = s.heading === b.room || s.room === b.room;
      if (towardBody && isAlone(s)) {
        const kind = isDeadEnd(m.map, b.room) ? 'body_in_dead_end' : undefined;
        out.push(ev(s.player, W.movement.headingToBodyRoomInWindowAlone, 'movement', `Alone near ${roomName(m, b.room)} at ${fmt(s.stamp.t)} (kill window)`, [s.id, b.id], false, kind,
          { P: pname(m, s.player), R: roomName(m, b.room), T: fmt(s.stamp.t), V: pname(m, b.victim) }));
      }
      if (s.room === b.room && s.heading && s.heading !== b.room && b.stamp.t - s.stamp.t <= 20) {
        out.push(ev(s.player, W.movement.leavingBodyRoomBeforeReport, 'movement', `Seen leaving ${roomName(m, b.room)} toward ${roomName(m, s.heading)} just before the report`, [s.id, b.id], false, 'body_in_dead_end',
          { P: pname(m, s.player), R: roomName(m, b.room), T: fmt(s.stamp.t), V: pname(m, b.victim) }));
      }
      // Vent-only / unreachable: feasibility.ts (interval check over every sighting, not just this one).
    }
  }
  return out;
}

/** The last player I saw with the victim before the body was found. */
export function ruleLastSeenWithVictim(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const b of bodies(m)) {
    if (b.victim === 'unknown') continue;
    let last: { who: PlayerId; s: SightingObs } | null = null;
    for (const s of sightings(m)) {
      if (s.stamp.round !== b.stamp.round || s.stamp.t > b.stamp.t) continue;
      const group = [s.player, ...(s.withPlayers ?? [])];
      if (!group.includes(b.victim)) continue;
      for (const who of group) {
        if (who === b.victim || who === m.me) continue;
        if (!last || s.stamp.t > last.s.stamp.t) last = { who, s };
      }
    }
    if (last) {
      // game-knowledge `two_together_one_dies`: just the two of them, inside the kill window → very strong.
      const pair = new Set([last.s.player, ...(last.s.withPlayers ?? [])]).size === 2;
      const inWindow = last.s.stamp.t >= killWindow(m, b)[0];
      const strong = pair && inWindow;
      out.push(ev(last.who, strong ? W.movement.aloneWithVictimInWindow : W.movement.stackingNearVictim, 'movement',
        `${strong ? 'Alone with' : 'Last seen with'} ${pname(m, b.victim)} in ${roomName(m, last.s.room)} at ${fmt(last.s.stamp.t)}${strong ? ' (kill window)' : ''}`, [last.s.id, b.id], false, 'last_seen_with_victim',
        { P: pname(m, last.who), V: pname(m, b.victim), R: roomName(m, last.s.room), T: fmt(last.s.stamp.t) }));
    }
  }
  return out;
}

/** Players the chat of the meeting(s) discussing `round` places somewhere (chat-nlu location / task / with / saw). */
function chatPlacedInRound(m: MatchState, round: number): Set<PlayerId> {
  const roundOf = roundOfMeeting(m);
  const assertions = chatAssertions(m);
  const out = new Set<PlayerId>();
  for (const k of new Set(assertions.map(a => a.meeting))) if (roundOf(k) === round) for (const p of chatPlaced(assertions, k)) out.add(p);
  return out;
}

/**
 * Base-rate gate (found replaying real logs): when most of the lobby is "unaccounted", that says the user
 * logged little, not that those players are sus. Only flag when it is a minority (≤ half of the alive others).
 */
function standsOut(m: MatchState, flagged: number): boolean {
  const alive = Object.values(m.players).filter(p => !p.isMe && p.status === 'alive').length;
  return flagged > 0 && flagged <= Math.max(1, Math.floor(alive / 2));
}

/** Alive, not me, and nothing at all logged about them in a round where someone died. */
export function ruleUnaccounted(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const rounds = new Set(bodies(m).map(b => b.stamp.round));
  for (const round of rounds) {
    const mentioned = new Set<PlayerId>();
    for (const o of m.observations) {
      if (o.stamp.round !== round) continue;
      if ('player' in o) mentioned.add(o.player);
      if (o.type === 'sighting') o.withPlayers?.forEach(p => mentioned.add(p));
      if (o.type === 'sawKill') { mentioned.add(o.killer); mentioned.add(o.victim); }
      if (o.type === 'bodyFound') { mentioned.add(o.victim); if (o.reporter) mentioned.add(o.reporter); o.present?.forEach(p => mentioned.add(p)); }
      if (o.type === 'sabotage') o.fixers?.forEach(p => mentioned.add(p));
    }
    for (const c of m.claims) if (c.stamp.round === round) { mentioned.add(c.by); if (c.about) mentioned.add(c.about); }
    for (const p of chatPlacedInRound(m, round)) mentioned.add(p);
    const bodyIds = bodies(m).filter(b => b.stamp.round === round).map(b => b.id);
    const unmentioned = Object.values(m.players).filter(p => !p.isMe && p.status === 'alive' && !mentioned.has(p.id));
    if (!standsOut(m, unmentioned.length)) continue;
    for (const p of unmentioned) out.push(ev(p.id, W.movement.unaccountedWholeRound, 'movement', `Nobody vouches for them in round ${round + 1}`, bodyIds));
  }
  return out;
}

/**
 * Mentioned somewhere in the round, but nothing places them inside a kill window: no sighting,
 * no with-me stretch, no task seen, not at the body, no location / companion claim covering it.
 * (Players nobody mentioned at all already get ruleUnaccounted; this does not stack on that.)
 */
export function ruleUnaccountedKillWindow(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const wholeRound = new Set(ruleUnaccounted(m).map(e => `${e.player}|${e.refs.join(',')}`));
  for (const b of bodies(m)) {
    const [w0, w1] = killWindow(m, b);
    const overlaps = (a0: number, a1: number) => a0 <= w1 + 5 && a1 >= w0 - 5;
    const placed = new Set<PlayerId>();
    const open = new Map<PlayerId, number>();
    for (const o of m.observations) {
      if (o.stamp.round !== b.stamp.round) continue;
      const t = o.stamp.t;
      if (o.type === 'sighting' && overlaps(t, t)) { placed.add(o.player); o.withPlayers?.forEach(p => placed.add(p)); }
      if (o.type === 'sawTask' && overlaps(t - (o.durationSec ?? 0), t)) placed.add(o.player);
      if (o.type === 'withMe') {
        if (o.on) open.set(o.player, t);
        else { const t0 = open.get(o.player); if (t0 !== undefined && overlaps(t0, t)) placed.add(o.player); open.delete(o.player); }
      }
      if (o.type === 'sabotage' && overlaps(t, t)) o.fixers?.forEach(p => placed.add(p));
    }
    for (const [p, t0] of open) if (t0 <= w1 + 5) placed.add(p);
    for (const p of chatPlacedInRound(m, b.stamp.round)) placed.add(p); // chat statements carry no time: whole round
    if (b.reporter) placed.add(b.reporter);
    b.present?.forEach(p => placed.add(p));
    for (const c of m.claims) {
      if (c.stamp.round !== b.stamp.round || (c.type !== 'location' && c.type !== 'companion' && c.type !== 'sighting')) continue;
      const [a0, a1] = c.timeWindow ?? [0, 1e9];
      if (!overlaps(a0, a1)) continue;
      if (c.type === 'location' || c.type === 'companion') placed.add(c.by);
      if ((c.type === 'companion' || c.type === 'sighting') && c.about) placed.add(c.about);
    }
    const roundBodies = bodies(m).filter(x => x.stamp.round === b.stamp.round).map(x => x.id).join(',');
    const unplaced = Object.values(m.players).filter(p => !p.isMe && p.status === 'alive' && !placed.has(p.id) && p.id !== b.victim);
    if (!standsOut(m, unplaced.length)) continue;
    for (const p of unplaced) {
      if (wholeRound.has(`${p.id}|${roundBodies}`)) continue;
      const e = ev(p.id, W.movement.unaccountedKillWindow, 'movement', `Nobody places them during the ${roomName(m, b.room)} kill window (${fmt(w0)}–${fmt(w1)})`, [b.id]);
      e.round = b.stamp.round;
      out.push(e);
    }
  }
  return out;
}

/** At the body with only the reporter (2-person find): opportunity, mild. */
export function rulePresentAtBody(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const b of bodies(m)) {
    if (!b.reporter || !b.present) continue;
    const group = new Set([b.reporter, ...b.present]);
    group.delete(b.victim);
    if (group.size !== 2) continue;
    for (const p of group) {
      if (p === b.reporter || p === m.me) continue;
      const e = ev(p, W.movement.presentAtBodySmallGroup, 'movement', `At the ${roomName(m, b.room)} body with only ${pname(m, b.reporter)}`, [b.id]);
      e.round = b.stamp.round;
      out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Task behaviour (from what I watched, not what they said)
// ---------------------------------------------------------------------------

export function ruleTaskObservations(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const o of m.observations) {
    if (o.type !== 'sawTask') continue;
    const task = o.taskId ? m.map.tasks.find(t => t.id === o.taskId) : undefined;
    if (o.visualConfirmed) {
      // Hard clear in suspicion.ts when the task is visual on THIS map (or unnamed). Otherwise it is only "seen at a task".
      if (!m.settings.visualTasksOn || !task || task.visual) continue;
      out.push(ev(o.player, W.task.sawNonVisualTask, 'task', `Seen at ${task.name} (not a visual task on ${m.map.name}: proves nothing hard)`, [o.id]));
      continue;
    }
    if (task && o.durationSec !== undefined) {
      const expected = task.stageDurationSec;
      const ratio = o.durationSec / Math.max(1, expected);
      if (ratio < 0.5 || ratio > 1.8) {
        out.push(ev(o.player, W.movement.taskDurationMismatch, 'movement', `Stood at ${task.name} for ${Math.round(o.durationSec)} s (expected ~${expected} s)`, [o.id], !m.map._verified.durations));
      }
    }
    if (o.taskBarMoved !== undefined && m.settings.taskBarMode === 'always') {
      if (o.taskBarMoved) out.push(ev(o.player, W.task.taskBarMoved, 'task', `Task bar moved as they finished in ${roomName(m, o.room)}`, [o.id]));
      else out.push(ev(o.player, W.task.taskBarDidNotMove, 'task', `Task bar did not move when they "finished" in ${roomName(m, o.room)}`, [o.id]));
    }
    if (task?.visual && m.settings.visualTasksOn) {
      out.push(ev(o.player, W.task.visualWithoutAnimation, 'task', `"Did" ${task.name} (visual) with no animation`, [o.id], false, 'visual_task_check', { P: pname(m, o.player), TASK: task.name }));
    }
  }
  return out;
}

/** With Engineers on, a vent is not proof (Engineers are crew and vent) — but it is still strong. */
export function ruleVentWithEngineers(m: MatchState): EvidenceItem[] {
  if (!m.settings.roles?.engineer) return [];
  return m.observations.filter(o => o.type === 'sawVent').map(o => {
    const e = ev((o as { player: PlayerId }).player, W.movement.sawVentEngineersOn, 'movement', `Seen venting in ${roomName(m, (o as { room: string }).room)} (Engineers are on: could be an Engineer)`, [o.id]);
    e.round = o.stamp.round;
    return e;
  });
}

// ---------------------------------------------------------------------------
// Sabotage
// ---------------------------------------------------------------------------

export function ruleSabotage(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const o of m.observations) {
    if (o.type !== 'sabotage' || !o.fixers?.length) continue;
    for (const p of o.fixers) if (p !== m.me) out.push(ev(p, W.sabotage.fixedSabotageWithMe, 'sabotage', `Fixed ${o.kind} with me`, [o.id], false, 'sabotage_unfixed', { W: pname(m, p), TASK: o.kind }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural (needs visible votes)
// ---------------------------------------------------------------------------

export function ruleVotingPairs(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const known = m.votes.filter(v => v.known && v.target !== 'none');
  const meetings = new Set(known.map(v => v.meeting));
  if (meetings.size < 3) return out;
  const alive = Object.values(m.players).filter(p => p.status === 'alive' && !p.isMe).map(p => p.id);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    const aVotes = known.filter(v => v.voter === a), bVotes = known.filter(v => v.voter === b);
    const bothActive = [...meetings].filter(mt => aVotes.some(v => v.meeting === mt && v.target !== 'skip') && bVotes.some(v => v.meeting === mt && v.target !== 'skip'));
    if (bothActive.length < 3) continue;
    if (aVotes.some(v => v.target === b) || bVotes.some(v => v.target === a)) continue;
    for (const p of [a, b]) out.push(ev(p, W.structural.neverVoteEachOther, 'structural', `${pname(m, a)} and ${pname(m, b)} never vote each other (${bothActive.length} meetings)`, bothActive.map(mt => `votes${mt}`), false, 'pair_tell', { P: pname(m, a), P2: pname(m, b) }));
  }
  return out;
}

export const OBSERVATION_RULES: Array<(m: MatchState) => EvidenceItem[]> = [
  ruleManualMarks, ruleSelfReport, ruleProximityToKill, ruleLastSeenWithVictim, ruleUnaccounted,
  ruleTaskObservations, ruleSabotage, ruleVotingPairs, ruleUnaccountedKillWindow, rulePresentAtBody, ruleVentWithEngineers,
];
