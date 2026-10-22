/**
 * Claim checks (docs/DEDUCTION_ENGINE.md §3.2–3.3, §4.1): claim vs my
 * observations, claim vs claim, and post-ejection re-weighting. Every rule is
 * a small function returning EvidenceItem[]; `verifyClaims` gives the UI a
 * per-claim status.
 */
import type { MatchState, EvidenceItem, Claim, PlayerId, SightingObs } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { walkSeconds, taskExistsInRoom } from './map';
import { buildAlibiGraph, ROUND_END } from './alibi';
import { fmt, ev } from './evidence';
import { travelLowerBound } from './feasibility';

const W = weightsJson;

type Verdict = 'confirmed' | 'contradicted' | 'pending';

const mySightings = (m: MatchState) => m.observations.filter((o): o is SightingObs => o.type === 'sighting' && o.source === 'me');
const roomName = (m: MatchState, r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
const pname = (m: MatchState, p: string) => m.players[p]?.name ?? p;

/** Location claim vs where I actually saw the claimant. */
function checkLocation(m: MatchState, c: Claim): { verdict: Verdict; ref?: string; seenRoom?: string; seenT?: number } {
  if (!c.room) return { verdict: 'pending' };
  const [t0, t1] = c.timeWindow ?? [0, ROUND_END];
  let confirmedRef: string | undefined;
  for (const s of mySightings(m)) {
    if (s.player !== c.by || s.stamp.round !== c.stamp.round || s.stamp.t < t0 || s.stamp.t > t1) continue;
    if (s.room === c.room) { confirmedRef = s.id; continue; }
    const slack = c.timeWindow ? Math.min(s.stamp.t - t0, t1 - s.stamp.t) : ROUND_END;
    if (travelLowerBound(walkSeconds(m.map, s.room, c.room, m.settings.playerSpeed)) > slack) return { verdict: 'contradicted', ref: s.id, seenRoom: s.room, seenT: s.stamp.t };
  }
  return confirmedRef ? { verdict: 'confirmed', ref: confirmedRef } : { verdict: 'pending' };
}

export function ruleLocationClaims(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const c of m.claims) {
    if (c.type !== 'location' && c.type !== 'sighting') continue;
    const r = checkLocation(m, c);
    if (r.verdict === 'contradicted' && r.ref) {
      out.push(ev(c.by, W.meeting.contradictedByHardClear, 'meeting', `Claimed ${roomName(m, c.room!)} but I saw them in ${roomName(m, r.seenRoom!)} at ${fmt(r.seenT!)}`, [c.id, r.ref], false, 'contradiction',
        { P: pname(m, c.by), R: roomName(m, c.room!), R2: roomName(m, r.seenRoom!), T: fmt(r.seenT!), W: pname(m, m.me) }));
    } else if (r.verdict === 'confirmed' && c.type === 'location' && r.ref) {
      out.push(ev(c.by, W.meeting.preciseUndisputedAlibi, 'meeting', `Location claim (${roomName(m, c.room!)}) matches what I saw`, [c.id, r.ref]));
    }
  }
  return out;
}

/** Same player, same round, two location claims that cannot both be true. */
export function ruleStoryChanged(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const locs = m.claims.filter(c => c.type === 'location' && c.room && c.timeWindow);
  for (let i = 0; i < locs.length; i++) for (let j = i + 1; j < locs.length; j++) {
    const a = locs[i], b = locs[j];
    if (a.by !== b.by || a.stamp.round !== b.stamp.round || a.room === b.room) continue;
    const [a0, a1] = a.timeWindow!, [b0, b1] = b.timeWindow!;
    const gap = Math.max(0, Math.max(b0 - a1, a0 - b1));
    if (travelLowerBound(walkSeconds(m.map, a.room!, b.room!, m.settings.playerSpeed)) > gap) {
      out.push(ev(a.by, W.meeting.storyChanged, 'meeting', `Story changed: ${roomName(m, a.room!)} then ${roomName(m, b.room!)} with no time to walk`, [a.id, b.id], false, 'contradiction',
        { P: pname(m, a.by), R: roomName(m, b.room!), R2: roomName(m, a.room!), T: fmt(b0), W: 'you' }));
    }
  }
  return out;
}

/** Companion claims: confirmed by the other party → both get an alibi bonus; contradicted → penalty. */
export function ruleCompanionClaims(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const e of buildAlibiGraph(m)) {
    if (!e.claimIds) continue;
    const key = [e.a, e.b].sort().join('|') + e.round;
    if (e.status === 'confirmed' && !seen.has(key)) {
      seen.add(key);
      for (const p of [e.a, e.b]) out.push(ev(p, W.meeting.confirmedCompanionAlibi, 'meeting', `${pname(m, e.a)} and ${pname(m, e.b)} confirm each other${e.room ? ' in ' + roomName(m, e.room) : ''}`, e.claimIds));
    }
    if (e.status === 'contradicted') {
      out.push(ev(e.a, W.meeting.contradictedByHardClear, 'meeting', `Claimed to be with ${pname(m, e.b)} but my sighting says otherwise`, e.refs, false, 'contradiction',
        { P: pname(m, e.a), R: e.room ? roomName(m, e.room) : 'with ' + pname(m, e.b), R2: 'elsewhere', T: fmt(e.t0), W: pname(m, m.me) }));
    }
  }
  return out;
}

/** Task claims against the map's task table. */
export function ruleTaskClaims(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const c of m.claims) {
    if (c.type !== 'task' || !c.taskId) continue;
    const task = m.map.tasks.find(t => t.id === c.taskId);
    const taskName = task?.name ?? c.taskId;
    if (!task && m.map.tasks.length > 0) {
      // game-knowledge `task_not_on_map` (high, not hard: alias / name errors).
      out.push(ev(c.by, W.task.taskNotOnMap, 'task', `Claims ${taskName} — there is no such task on ${m.map.name}`, [c.id], !m.map._verified.tasks, 'task_not_in_room',
        { P: pname(m, c.by), R: c.room ? roomName(m, c.room) : m.map.name, TASK: taskName }));
    } else if (c.room && !taskExistsInRoom(m.map, c.taskId, c.room)) {
      out.push(ev(c.by, W.task.taskNotAtClaimedLocation, 'task', `${taskName} does not exist in ${roomName(m, c.room)}`, [c.id], !m.map._verified.tasks, 'task_not_in_room',
        { P: pname(m, c.by), R: roomName(m, c.room), TASK: taskName }));
    } else if (task?.visual && m.settings.visualTasksOn) {
      const seen = m.observations.some(o => o.type === 'sawTask' && o.player === c.by && o.visualConfirmed && o.stamp.round === c.stamp.round);
      if (!seen) out.push(ev(c.by, 0.1, 'task', `Claims visual task ${taskName} — nobody confirmed the animation`, [c.id], false, 'visual_task_check', { P: pname(m, c.by), TASK: taskName }));
    }
  }
  return out;
}

/** Claims a COMMON task I don't have: common tasks are identical for every crewmate (near-hard). */
export function ruleCommonTaskClaims(m: MatchState): EvidenceItem[] {
    const out: EvidenceItem[] = [];
    if (!m.myTasks || m.myTasks.length === 0) return out;
    const mine = new Set(m.myTasks.filter(t => t.matched).map(t => t.id));
    const myCommons = m.map.tasks.filter(t => t.kind === 'common' && mine.has(t.id));
    if (myCommons.length === 0 && m.settings.commonTasks > 0) return out; // my list didn't read well enough to trust
    for (const c of m.claims) {
        if (c.type !== 'task' || !c.taskId) continue;
        const task = m.map.tasks.find(t => t.id === c.taskId);
        if (!task || task.kind !== 'common' || mine.has(task.id)) continue;
        out.push(ev(c.by, W.task.claimedCommonTaskIDontHave, 'task', `Claims ${task.name} — a common task I don't have`, [c.id], !m.map._verified.tasks, 'common_task_claim',
            { P: pname(m, c.by), TASK: task.name, R: c.room ? roomName(m, c.room) : task.rooms.map(r => roomName(m, r)).join('/') }));
    }
    return out;
}

/** Accusations with nothing behind them; bandwagoning. */
export function ruleAccusations(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const byMeeting = new Map<number, Claim[]>();
  for (const c of m.claims) if (c.type === 'accusation' && c.about && c.about !== c.by) (byMeeting.get(c.meeting) ?? byMeeting.set(c.meeting, []).get(c.meeting)!).push(c);
  for (const [, list] of byMeeting) {
    const sorted = [...list].sort((a, b) => a.stamp.wall - b.stamp.wall);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const hasEvidence = !!c.room || !!c.timeWindow || !!c.text;
      if (hasEvidence) continue;
      const earlier = sorted.slice(0, i).find(d => d.about === c.about && d.by !== c.by);
      if (earlier) out.push(ev(c.by, W.meeting.bandwagon, 'meeting', `Bandwagoned onto ${pname(m, c.about!)} with nothing new`, [c.id, earlier.id], false, 'accuser_no_evidence', { P: pname(m, c.by), P2: pname(m, c.about!) }));
      else out.push(ev(c.by, W.meeting.accuseNoEvidence, 'meeting', `Accused ${pname(m, c.about!)} with no stated evidence`, [c.id], false, 'accuser_no_evidence', { P: pname(m, c.by), P2: pname(m, c.about!) }));
    }
  }
  return out;
}

/** Re-weight once an ejection reveals a role (confirm ejects on). */
export function ruleEjectionFeedback(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const e of m.ejections) {
    if (!e.player || e.wasImpostor === null) continue;
    const accusers = new Set(m.claims.filter(c => c.meeting === e.meeting && c.type === 'accusation' && c.about === e.player).map(c => c.by));
    const voters = new Set(m.votes.filter(v => v.meeting === e.meeting && v.known && v.target === e.player).map(v => v.voter));
    const defenders = m.claims.filter(c => c.meeting <= e.meeting && (c.type === 'clear' || c.type === 'defense') && c.about === e.player);
    if (e.wasImpostor === false) {
      // Accusing (pushing) is a choice; voting along is weaker. One item per player, the stronger one.
      for (const p of new Set([...accusers, ...voters])) {
        if (p === e.player || p === m.me) continue;
        if (accusers.has(p)) out.push(ev(p, W.meeting.pushedVoteOnCrew, 'meeting', `Pushed the vote on ${pname(m, e.player)}, who was crew`, [`ej${e.meeting}`]));
        else out.push(ev(p, W.meeting.votedOffCrew, 'meeting', `Voted out ${pname(m, e.player)}, who was crew`, [`ej${e.meeting}`, `votes${e.meeting}`]));
      }
    } else {
      for (const p of voters) if (p !== e.player) out.push(ev(p, W.meeting.votedImpostor, 'meeting', `Voted out ${pname(m, e.player)}, a confirmed impostor`, [`ej${e.meeting}`]));
      for (const d of defenders) {
        if (d.type === 'clear') out.push(ev(d.by, W.structural.hardDefendedConfirmedImpostor, 'structural', `Hard-cleared ${pname(m, e.player)}, a confirmed impostor`, [d.id], false, 'pair_tell', { P: pname(m, d.by), P2: pname(m, e.player) }));
        else out.push(ev(d.by, W.meeting.defendedImpostor, 'meeting', `Defended ${pname(m, e.player)}, a confirmed impostor`, [d.id], false, 'pair_tell', { P: pname(m, d.by), P2: pname(m, e.player) }));
      }
      // The impostor's alibi named someone who agreed → pair tell.
      for (const c of m.claims) {
        if (c.by !== e.player || c.type !== 'companion' || !c.about) continue;
        const agreed = m.claims.some(d => d.by === c.about && d.type === 'companion' && d.about === e.player && d.stamp.round === c.stamp.round);
        if (agreed) out.push(ev(c.about, W.structural.impostorAlibiNamedThem, 'structural', `Confirmed impostor ${pname(m, e.player)}'s alibi was "with ${pname(m, c.about)}" and they agreed`, [c.id], false, 'pair_tell', { P: pname(m, c.about), P2: pname(m, e.player) }));
      }
    }
  }
  return out;
}

/** Near the body, said nothing in that meeting (only judged once the meeting is over). */
export function ruleSilentNearBody(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const currentMeeting = m.phase.phase === 'meetingDiscussion' || m.phase.phase === 'meetingVoting' ? (m.phase.meeting ?? -1) : -1;
  const bodies = m.observations.filter(o => o.type === 'bodyFound');
  const meetingsClosed = new Set(m.ejections.map(e => e.meeting));
  for (const b of bodies) {
    if (b.type !== 'bodyFound') continue;
    const meeting = meetingIndexForRound(m, b.stamp.round);
    if (meeting === null || meeting === currentMeeting || !meetingsClosed.has(meeting)) continue;
    const near = mySightings(m).filter(s => s.stamp.round === b.stamp.round && s.room === b.room && s.stamp.t >= b.stamp.t - W.killWindow.defaultSec && s.stamp.t <= b.stamp.t).map(s => s.player);
    for (const p of new Set(near)) {
      if (m.claims.some(c => c.by === p && c.meeting === meeting)) continue;
      out.push(ev(p, W.meeting.silentNearBody, 'meeting', `Was near ${roomName(m, b.room)} before the report and said nothing in meeting ${meeting + 1}`, [b.id]));
    }
  }
  return out;
}

function meetingIndexForRound(m: MatchState, round: number): number | null {
  // Claims made in a meeting carry the round they discuss; use that mapping.
  const c = m.claims.find(x => x.stamp.round === round);
  if (c) return c.meeting;
  const e = m.ejections[round];
  return e ? e.meeting : null;
}

/** Per-claim status for the UI. */
export function verifyClaims(m: MatchState): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  for (const c of m.claims) out.set(c.id, 'pending');
  for (const c of m.claims) {
    if (c.type === 'location' || c.type === 'sighting') out.set(c.id, checkLocation(m, c).verdict);
    if (c.type === 'task' && c.taskId && c.room) out.set(c.id, taskExistsInRoom(m.map, c.taskId, c.room) ? 'pending' : 'contradicted');
  }
  for (const e of buildAlibiGraph(m)) {
    if (!e.claimIds) continue;
    for (const id of e.claimIds) if (e.status === 'confirmed' || e.status === 'contradicted') out.set(id, e.status);
  }
  return out;
}

export const CLAIM_RULES: Array<(m: MatchState) => EvidenceItem[]> = [
  ruleLocationClaims, ruleStoryChanged, ruleCompanionClaims, ruleTaskClaims, ruleCommonTaskClaims, ruleAccusations, ruleEjectionFeedback, ruleSilentNearBody,
];

export type { PlayerId };
