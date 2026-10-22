/**
 * Impostor-pair detection (2+ impostor lobbies). Partners tend to: alibi only each other,
 * vouch for each other, never accuse each other, and vote together as a small bloc.
 * Each signal alone is weak (crew friends do all of this too) — the UI should show
 * `impostorPairs` as "watch this pair", never as a verdict.
 *
 * `ruleMutualAlibiPair` is the only piece that feeds the score directly (game-knowledge
 * `mutual_pair`); the other signals already have their own evidence rules
 * (voting.ruleMinorityVoteBloc, rules.ruleVotingPairs, chatEvidence pair hints), so
 * `impostorPairs` aggregates them for display without double counting the score.
 */
import type { EvidenceItem, MatchState, PlayerId } from '../types/game';
import type { ChatAssertion } from './chatNluTypes';
import weightsJson from '../data/tactics/weights.json';
import { ev } from './evidence';
import { buildAlibiGraph } from './alibi';
import { knownVotes } from './voting';

const pname = (m: MatchState, p: string) => m.players[p]?.name ?? p;
const key = (a: PlayerId, b: PlayerId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Rounds where a and b confirmed each other and nobody I trust (me / my sightings) placed either. */
function mutualAlibiRounds(m: MatchState): Map<string, { rounds: number[]; refs: string[] }> {
  const edges = buildAlibiGraph(m);
  const out = new Map<string, { rounds: number[]; refs: string[] }>();
  for (const e of edges) {
    if (e.status !== 'confirmed' || !e.claimIds) continue;
    const thirdParty = edges.some(f => f.status === 'trusted' && f.round === e.round && (f.a === e.a || f.b === e.a || f.a === e.b || f.b === e.b));
    if (thirdParty) continue;
    const k = key(e.a, e.b);
    const cur = out.get(k) ?? { rounds: [], refs: [] };
    if (!cur.rounds.includes(e.round)) { cur.rounds.push(e.round); cur.refs.push(...e.claimIds); }
    out.set(k, cur);
  }
  return out;
}

/** `mutual_pair`: the same two players alibi only each other in ≥ 2 rounds, never seen by a third. */
export function ruleMutualAlibiPair(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  if (m.settings.impostorCount < 2) return out;
  for (const [k, v] of mutualAlibiRounds(m)) {
    if (v.rounds.length < 2) continue;
    const [a, b] = k.split('|');
    for (const p of [a, b]) {
      if (p === m.me || !m.players[p]) continue;
      const e = ev(p, weightsJson.structural.mutualVouchPair * (v.rounds.length - 1), 'structural',
        `${pname(m, a)} and ${pname(m, b)} only ever alibi each other (${v.rounds.length} rounds, nobody else saw them)`, [...new Set(v.refs)], false, 'pair_tell', { P: pname(m, a), P2: pname(m, b) });
      e.round = Math.max(...v.rounds);
      out.push(e);
    }
  }
  return out;
}

export interface PairSignal { a: PlayerId; b: PlayerId; score: number; reasons: string[]; refs: string[] }

/** Ranked candidate impostor pairs among alive, unresolved players (display only; see the header). */
export function impostorPairs(m: MatchState, assertions: ChatAssertion[] = [], exclude: Set<PlayerId> = new Set()): PairSignal[] {
  if (m.settings.impostorCount < 2) return [];
  const alive = Object.values(m.players).filter(p => p.status === 'alive' && !p.isMe && !exclude.has(p.id)).map(p => p.id);
  const pairs = new Map<string, PairSignal>();
  const add = (a: PlayerId, b: PlayerId, w: number, reason: string, refs: string[]) => {
    if (a === b || !alive.includes(a) || !alive.includes(b)) return;
    const k = key(a, b);
    const [x, y] = k.split('|');
    const cur = pairs.get(k) ?? { a: x, b: y, score: 0, reasons: [], refs: [] };
    cur.score += w; cur.reasons.push(reason); cur.refs.push(...refs);
    pairs.set(k, cur);
  };
  for (const [k, v] of mutualAlibiRounds(m)) {
    const [a, b] = k.split('|');
    add(a, b, 0.3 * v.rounds.length, `alibi only each other (${v.rounds.length} round${v.rounds.length === 1 ? '' : 's'})`, v.refs);
  }
  // Vouches both ways.
  const vouch = new Map<string, string[]>();
  const accused = new Map<PlayerId, Set<PlayerId>>();
  for (const a of assertions) {
    if (a.supersededBy) continue;
    for (const x of a.about) {
      if (x === a.speaker) continue;
      if (a.polarity < 0) vouch.set(`${a.speaker}>${x}`, [...(vouch.get(`${a.speaker}>${x}`) ?? []), ...a.refs]);
      if (a.polarity > 0) accused.set(a.speaker, (accused.get(a.speaker) ?? new Set()).add(x));
    }
  }
  for (const [k, refs] of vouch) {
    const [s, x] = k.split('>');
    if (s < x && vouch.has(`${x}>${s}`)) add(s, x, 0.4, 'vouch for each other', [...refs, ...(vouch.get(`${x}>${s}`) ?? [])]);
  }
  // Both accuse others freely, never each other.
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    const A = accused.get(a), B = accused.get(b);
    if (A && B && A.size >= 2 && B.size >= 2 && !A.has(b) && !B.has(a)) add(a, b, 0.2, 'accuse others, never each other', []);
  }
  // Same target, together, in ≥ 2 meetings (any bloc size ≤ 3).
  const votes = knownVotes(m).filter(v => v.target !== 'skip' && v.target !== 'none');
  const together = new Map<string, number[]>();
  for (const k of new Set(votes.map(v => v.meeting))) {
    const inK = votes.filter(v => v.meeting === k);
    for (const v of inK) for (const u of inK) {
      if (v.voter >= u.voter || v.target !== u.target) continue;
      if (inK.filter(w => w.target === v.target).length > 3) continue;
      const kk = key(v.voter, u.voter);
      together.set(kk, [...(together.get(kk) ?? []), k]);
    }
  }
  for (const [k, ks] of together) if (ks.length >= 2) { const [a, b] = k.split('|'); add(a, b, 0.2 * ks.length, `voted together in ${ks.length} meetings`, ks.map(x => `votes${x}`)); }
  return [...pairs.values()].filter(p => p.score >= 0.5).map(p => ({ ...p, refs: [...new Set(p.refs)] })).sort((x, y) => y.score - x.score);
}
