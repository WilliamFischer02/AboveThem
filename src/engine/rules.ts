/**
 * Soft evidence from observations (docs/DEDUCTION_ENGINE.md §3.1, §3.2, §3.4, §3.5).
 * One small function per rule; each returns EvidenceItem[] with refs to the
 * observations it used. Weights come from data/tactics/weights.json.
 */
import type { MatchState, EvidenceItem, BodyFoundObs, SightingObs, PlayerId } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { isDeadEnd, reachableOnFoot, ventConnected } from './map';
import { ev, fmt } from './evidence';

const W = weightsJson;
const roomName = (m: MatchState, r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
const pname = (m: MatchState, p: string) => m.players[p]?.name ?? p;
const bodies = (m: MatchState) => m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
const sightings = (m: MatchState) => m.observations.filter((o): o is SightingObs => o.type === 'sighting');
const isAlone = (s: SightingObs) => s.alone ?? (!s.withPlayers || s.withPlayers.length === 0);

// ---------------------------------------------------------------------------
// Manual
// ---------------------------------------------------------------------------

export function ruleManualMarks(m: MatchState): EvidenceItem[] {
  return m.observations.flatMap(o => {
    if (o.type !== 'manualMark' || o.mark === 'neutral') return [];
    const w = o.weight ?? (o.mark === 'sus' ? W.manual.sus : W.manual.clear);
    return [ev(o.player, w, 'manual', `Marked ${o.mark} by you`, [o.id])];
  });
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
      const onFoot = reachableOnFoot(m.map, s.room, b.room, s.stamp.t, b.stamp.t, m.settings.playerSpeed);
      if (!onFoot && ventConnected(m.map, s.room, b.room)) {
        out.push(ev(s.player, W.movement.ventOnlyReachable, 'movement', `Could only reach ${roomName(m, b.room)} from ${roomName(m, s.room)} by vent`, [s.id, b.id], !m.map._verified.vents));
      }
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
      out.push(ev(last.who, W.movement.stackingNearVictim, 'movement', `Last seen with ${pname(m, b.victim)} in ${roomName(m, last.s.room)} at ${fmt(last.s.stamp.t)}`, [last.s.id, b.id], false, 'last_seen_with_victim',
        { P: pname(m, last.who), V: pname(m, b.victim), R: roomName(m, last.s.room), T: fmt(last.s.stamp.t) }));
    }
  }
  return out;
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
    const bodyIds = bodies(m).filter(b => b.stamp.round === round).map(b => b.id);
    for (const p of Object.values(m.players)) {
      if (p.isMe || p.status !== 'alive' || mentioned.has(p.id)) continue;
      out.push(ev(p.id, W.movement.unaccountedWholeRound, 'movement', `Nobody vouches for them in round ${round + 1}`, bodyIds));
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
    if (o.type !== 'sawTask' || o.visualConfirmed) continue;
    const task = o.taskId ? m.map.tasks.find(t => t.id === o.taskId) : undefined;
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
  ruleTaskObservations, ruleSabotage, ruleVotingPairs,
];
