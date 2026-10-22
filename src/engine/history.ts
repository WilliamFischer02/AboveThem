/**
 * Game timeline helpers: which meetings are over, who was alive when, and the match
 * "as we knew it" at the end of an earlier meeting (for score trends). Pure.
 *
 * Convention: round r is the play before meeting r (round 0 → meeting 0 → round 1 …).
 */
import type { MatchState, PlayerId, Player } from '../types/game';

const IN_MEETING = new Set(['meetingDiscussion', 'meetingVoting']);

export function meetingsSeen(m: MatchState): number[] {
  const s = new Set<number>();
  for (const e of m.ejections) s.add(e.meeting);
  for (const c of m.claims) s.add(c.meeting);
  for (const v of m.votes) s.add(v.meeting);
  for (const l of m.chat) s.add(l.meeting);
  return [...s].filter(k => Number.isFinite(k) && k >= 0).sort((a, b) => a - b);
}

/** Meeting in progress, or the next one to come. */
export function currentMeeting(m: MatchState): number {
  if (IN_MEETING.has(m.phase.phase) && m.phase.meeting !== undefined) return m.phase.meeting;
  const seen = meetingsSeen(m);
  if (m.phase.phase === 'ejection' && m.phase.meeting !== undefined) return m.phase.meeting + 1;
  return seen.length ? seen[seen.length - 1] + 1 : 0;
}

/** Meetings that are over (strictly before the current one). */
export function completedMeetings(m: MatchState): number[] {
  const cur = currentMeeting(m);
  return meetingsSeen(m).filter(k => k < cur);
}

/** The round being played now (or discussed, during a meeting). */
export function nowRound(m: MatchState): number {
  let r = Math.max(0, m.phase.round);
  for (const o of m.observations) r = Math.max(r, o.stamp.round);
  return r;
}

/** Round a meeting discusses: claims made in it carry that round; default = the meeting index. */
export function roundOfMeeting(m: MatchState): (k: number) => number {
  const map = new Map<number, number>();
  for (const c of m.claims) if (!map.has(c.meeting)) map.set(c.meeting, c.stamp.round);
  return k => map.get(k) ?? k;
}

/** First round in which the player was found dead / seen killed; meeting they were ejected in. */
export function deathOf(m: MatchState, p: PlayerId): { diedRound?: number; ejectedMeeting?: number } {
  let diedRound: number | undefined;
  for (const o of m.observations) {
    if ((o.type === 'bodyFound' && o.victim === p) || (o.type === 'sawKill' && o.victim === p)) diedRound = Math.min(diedRound ?? Infinity, o.stamp.round);
  }
  const ej = m.ejections.find(e => e.player === p);
  return { diedRound, ejectedMeeting: ej?.meeting };
}

/** Was the player alive (and able to talk / vote) in meeting k? Unknown deaths keep the current status. */
export function aliveAtMeeting(m: MatchState, p: PlayerId, k: number): boolean {
  const pl = m.players[p];
  if (!pl) return false;
  const { diedRound, ejectedMeeting } = deathOf(m, p);
  if (diedRound !== undefined && diedRound <= k) return false;
  if (ejectedMeeting !== undefined && ejectedMeeting < k) return false;
  if (pl.status === 'alive') return true;
  return diedRound !== undefined || ejectedMeeting !== undefined; // died later → alive then
}

/**
 * The match as it was known at the end of meeting k (after its ejection): later rounds,
 * claims, votes, chat and ejections dropped; players who died later are alive again and
 * roles revealed only later are unknown again.
 */
export function snapshotAtMeeting(m: MatchState, k: number): MatchState {
  const players: Record<PlayerId, Player> = {};
  for (const p of Object.values(m.players)) {
    const { diedRound, ejectedMeeting } = deathOf(m, p.id);
    let next = p;
    const diedLater = (diedRound !== undefined && diedRound > k) || (ejectedMeeting !== undefined && ejectedMeeting > k);
    const diedByThen = (diedRound !== undefined && diedRound <= k) || (ejectedMeeting !== undefined && ejectedMeeting <= k);
    if (p.status !== 'alive' && diedLater && !diedByThen) next = { ...next, status: 'alive' };
    if (ejectedMeeting !== undefined && ejectedMeeting > k && !p.isMe && !p.isPartner) next = { ...next, knownRole: 'unknown' };
    players[p.id] = next;
  }
  return {
    ...m,
    players,
    phase: { phase: 'ejection', wall: m.phase.wall, round: k, meeting: k },
    observations: m.observations.filter(o => o.stamp.round <= k),
    claims: m.claims.filter(c => c.meeting <= k),
    votes: m.votes.filter(v => v.meeting <= k),
    ejections: m.ejections.filter(e => e.meeting <= k),
    chat: m.chat.filter(l => l.meeting <= k),
  };
}
