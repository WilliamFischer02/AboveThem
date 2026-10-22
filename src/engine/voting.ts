/**
 * Voting behaviour (needs visible votes: anonymous votes OFF and the vote screen read or
 * typed). Every rule is about the VOTER. Refs use `votes{k}` (the vote screen of meeting k)
 * and `ej{k}` (its ejection) — the UI shows both as "meeting k+1 votes".
 *
 * Deliberately not here: "late bandwagon votes" — the vote screen shows no order or timing,
 * so we cannot tell a late vote from an early one without hidden info.
 */
import type { EvidenceItem, MatchState, PlayerId, Vote } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { ev } from './evidence';
import { roundOfMeeting } from './history';

const W = weightsJson;
const pname = (m: MatchState, p: string) => m.players[p]?.name ?? p;

/** One vote per voter per meeting (the latest read wins — merges can leave two). */
export function knownVotes(m: MatchState): Vote[] {
  const latest = new Map<string, Vote>();
  for (const v of m.votes) if (v.known && v.voter !== v.target) latest.set(`${v.meeting}|${v.voter}`, v);
  return [...latest.values()];
}

/** Voted out a crewmate in two or more meetings. */
export function ruleRepeatedCrewEjections(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const votes = knownVotes(m);
  const roundOf = roundOfMeeting(m);
  const count = new Map<PlayerId, number[]>();
  for (const e of m.ejections) {
    if (!e.player || e.wasImpostor !== false) continue;
    for (const v of votes) if (v.meeting === e.meeting && v.target === e.player) count.set(v.voter, [...(count.get(v.voter) ?? []), e.meeting]);
  }
  for (const [p, ks] of count) {
    if (ks.length < 2) continue;
    const e = ev(p, W.structural.repeatedCrewEjections * (ks.length - 1), 'structural', `Voted out a crewmate in ${ks.length} meetings`, ks.map(k => `ej${k}`));
    e.round = roundOf(Math.max(...ks)); out.push(e);
  }
  return out;
}

/** Skipped while the lobby ejected an impostor (the case was there and they sat it out). */
export function ruleSkipWhenImpostorFound(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const roundOf = roundOfMeeting(m);
  for (const e of m.ejections) {
    if (!e.player || e.wasImpostor !== true) continue;
    for (const v of knownVotes(m)) {
      if (v.meeting !== e.meeting || v.target !== 'skip') continue;
      const x = ev(v.voter, W.meeting.skipWhenImpostorFound, 'meeting', `Skipped the vote that ejected impostor ${pname(m, e.player)}`, [`votes${e.meeting}`, `ej${e.meeting}`]);
      x.round = roundOf(e.meeting); out.push(x);
    }
  }
  return out;
}

/** Skipped on a vote where one more kill would hand the impostors the game. */
export function ruleSkipOnCriticalVote(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const roundOf = roundOfMeeting(m);
  const votes = knownVotes(m);
  const meetings = new Set(votes.map(v => v.meeting));
  for (const k of meetings) {
    const inK = votes.filter(v => v.meeting === k);
    const alive = new Set(inK.map(v => v.voter)).size;
    const imps = Math.max(0, m.settings.impostorCount - m.ejections.filter(e => e.meeting < k && e.wasImpostor === true).length);
    if (alive < 3 || imps < 1 || alive > 2 * imps + 1) continue;
    for (const v of inK) {
      if (v.target !== 'skip' || v.voter === m.me) continue;
      const x = ev(v.voter, W.meeting.skipOnCriticalVote, 'meeting', `Skipped on a critical vote (meeting ${k + 1}, ${alive} alive)`, [`votes${k}`]);
      x.round = roundOf(k); out.push(x);
    }
  }
  return out;
}

/**
 * Two players forming a 2-vote minority bloc on the same target in ≥ 2 meetings (2+ impostor
 * lobbies): impostors often pile onto the same crewmate together. Majority votes are excluded —
 * converging on the obvious suspect says nothing.
 */
export function ruleMinorityVoteBloc(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  if (m.settings.impostorCount < 2) return out;
  const roundOf = roundOfMeeting(m);
  const votes = knownVotes(m);
  const pairs = new Map<string, number[]>();
  for (const k of new Set(votes.map(v => v.meeting))) {
    const inK = votes.filter(v => v.meeting === k && v.target !== 'none');
    const byTarget = new Map<string, PlayerId[]>();
    for (const v of inK) if (v.target !== 'skip') byTarget.set(v.target, [...(byTarget.get(v.target) ?? []), v.voter]);
    const imp = m.ejections.find(e => e.meeting === k && e.wasImpostor === true)?.player;
    for (const [t, voters] of byTarget) {
      if (voters.length !== 2 || voters.length * 2 >= inK.length || t === imp || voters.includes(m.me)) continue;
      const key = [...voters].sort().join('|');
      pairs.set(key, [...(pairs.get(key) ?? []), k]);
    }
  }
  for (const [key, ks] of pairs) {
    if (ks.length < 2) continue;
    const [a, b] = key.split('|');
    for (const p of [a, b]) {
      const e = ev(p, W.structural.minorityVoteBloc, 'structural', `${pname(m, a)} and ${pname(m, b)} voted together as a 2-player bloc in ${ks.length} meetings`, ks.map(k => `votes${k}`), false, 'pair_tell', { P: pname(m, a), P2: pname(m, b) });
      e.round = roundOf(Math.max(...ks)); out.push(e);
    }
  }
  return out;
}

export const VOTING_RULES: Array<(m: MatchState) => EvidenceItem[]> = [
  ruleRepeatedCrewEjections, ruleSkipWhenImpostorFound, ruleSkipOnCriticalVote, ruleMinorityVoteBloc,
];
