/**
 * Vote tracker analysis (features #5). Input: `Vote` entries the user tapped in from the
 * results screen (only when votes are NOT anonymous — then the screen shows each voter's icon
 * under the name they voted). Pure functions; `suspicion-core` may consume them.
 */
import type { MatchState, PlayerId, Vote } from '../../types/game';
import { tally, type TallyResult } from './meetingMath';

export type Target = Vote['target'];

/** Last recorded vote per voter in a meeting (a re-tap replaces the earlier one). */
export function meetingVotes(m: MatchState, meeting: number): Map<PlayerId, Target> {
  const out = new Map<PlayerId, Target>();
  for (const v of m.votes) if (v.meeting === meeting && v.known) out.set(v.voter, v.target);
  return out;
}

export interface VoteMatrix {
  meeting: number;
  rows: { voter: PlayerId; target: Target }[];
  /** Alive players with nothing recorded yet. */
  missing: PlayerId[];
  tally: TallyResult;
}

/**
 * Who could vote in `meeting`: everyone alive now plus whoever that meeting ejected. The results screen is read
 * during / after the ejection, when the ejected player is no longer 'alive' — without them the tracker could
 * neither record their vote nor the votes cast against them.
 */
export function meetingVoters(m: MatchState, meeting: number): PlayerId[] {
  const ejected = new Set(m.ejections.filter(e => e.meeting === meeting && e.player).map(e => e.player as PlayerId));
  return Object.values(m.players).filter(p => p.status === 'alive' || ejected.has(p.id)).map(p => p.id);
}

export function voteMatrix(m: MatchState, meeting: number, voters?: PlayerId[]): VoteMatrix {
  const votes = meetingVotes(m, meeting);
  const rows = [...votes.entries()].map(([voter, target]) => ({ voter, target }));
  const pool = voters ?? meetingVoters(m, meeting);
  return { meeting, rows, missing: pool.filter(p => !votes.has(p)), tally: tally(rows) };
}

/** Meetings that have at least one recorded vote, ascending. */
export const votedMeetings = (m: MatchState): number[] => [...new Set(m.votes.filter(v => v.known).map(v => v.meeting))].sort((a, b) => a - b);

/** Was `p` revealed as impostor / crew by an ejection (confirm ejects) or known role? */
function revealed(m: MatchState, p: PlayerId): 'impostor' | 'crew' | null {
  const ej = m.ejections.find(e => e.player === p && e.wasImpostor !== null);
  if (ej) return ej.wasImpostor ? 'impostor' : 'crew';
  const r = m.players[p]?.knownRole;
  return r === 'impostor' || r === 'crew' ? r : null;
}

export interface Bandwagon {
  meeting: number;
  voter: PlayerId;
  target: PlayerId;
  /** The target turned out crew (stronger tell) / impostor (harmless) / unknown. */
  targetWas: 'impostor' | 'crew' | null;
  line: string;
  refs: string[];
}

/**
 * Voted the meeting's top target without having accused them (or given any reason) in chat that
 * meeting. Only meaningful when chat claims were logged; the UI shows it as a soft note.
 */
export function bandwagons(m: MatchState): Bandwagon[] {
  const out: Bandwagon[] = [];
  const name = (p: PlayerId) => m.players[p]?.name ?? p;
  for (const meeting of votedMeetings(m)) {
    const votes = meetingVotes(m, meeting);
    const t = tally([...votes.entries()].map(([voter, target]) => ({ voter, target })));
    const top = t.top.filter((x): x is PlayerId => x !== 'skip');
    if (top.length !== 1) continue;
    const target = top[0];
    const accusers = new Set(m.claims.filter(c => c.meeting === meeting && c.type === 'accusation' && c.about === target).map(c => c.by));
    if (accusers.size === 0) continue; // nobody argued anything: everyone is equally "silent", not a bandwagon
    const was = revealed(m, target);
    for (const [voter, tg] of votes) {
      if (tg !== target || accusers.has(voter) || voter === m.me) continue;
      out.push({ meeting, voter, target, targetWas: was, refs: [`votes${meeting}`],
        line: `${name(voter)} piled onto ${name(target)} in meeting ${meeting + 1} without saying why${was === 'crew' ? ' — and they were crew' : ''}` });
    }
  }
  return out;
}

export interface VotePair {
  a: PlayerId;
  b: PlayerId;
  /** Meetings where both voted the same non-skip player. */
  together: number[];
  /** Meetings where both cast a non-skip vote. */
  bothVoted: number[];
  /** Neither ever voted for the other. */
  neverEachOther: boolean;
  line: string;
}

/** "Same pair every meeting": pairs voting the same name in ≥ minTogether meetings. */
export function votingPairs(m: MatchState, minTogether = 2): VotePair[] {
  const meetings = votedMeetings(m);
  const per = meetings.map(mt => meetingVotes(m, mt));
  const voters = [...new Set(m.votes.filter(v => v.known).map(v => v.voter))].filter(p => p !== m.me);
  const name = (p: PlayerId) => m.players[p]?.name ?? p;
  const out: VotePair[] = [];
  for (let i = 0; i < voters.length; i++) for (let j = i + 1; j < voters.length; j++) {
    const a = voters[i], b = voters[j];
    const together: number[] = [], bothVoted: number[] = [];
    let eachOther = false;
    per.forEach((v, k) => {
      const ta = v.get(a), tb = v.get(b);
      if (ta === b || tb === a) eachOther = true;
      const real = (x?: Target) => x !== undefined && x !== 'skip' && x !== 'none';
      if (real(ta) && real(tb)) { bothVoted.push(meetings[k]); if (ta === tb) together.push(meetings[k]); }
    });
    if (together.length < minTogether) continue;
    out.push({ a, b, together, bothVoted, neverEachOther: !eachOther,
      line: `${name(a)} + ${name(b)} voted the same name in ${together.length}/${bothVoted.length} meetings${!eachOther ? ', never each other' : ''}` });
  }
  return out.sort((x, y) => y.together.length - x.together.length);
}

export interface VoterRecord {
  player: PlayerId;
  votes: number;
  skips: number;
  /** Votes on players later revealed impostor (good for them) / crew (bad for them). */
  hitImpostor: number;
  hitCrew: number;
  /** Times they voted with the meeting's plurality. */
  withMajority: number;
}

export function voterRecords(m: MatchState): VoterRecord[] {
  const rec = new Map<PlayerId, VoterRecord>();
  const get = (p: PlayerId) => rec.get(p) ?? (rec.set(p, { player: p, votes: 0, skips: 0, hitImpostor: 0, hitCrew: 0, withMajority: 0 }), rec.get(p)!);
  for (const meeting of votedMeetings(m)) {
    const votes = meetingVotes(m, meeting);
    const t = tally([...votes.entries()].map(([voter, target]) => ({ voter, target })));
    for (const [voter, target] of votes) {
      const r = get(voter);
      if (target === 'none') continue;
      r.votes++;
      if (target === 'skip') r.skips++;
      else { const was = revealed(m, target); if (was === 'impostor') r.hitImpostor++; if (was === 'crew') r.hitCrew++; }
      if (t.top.length === 1 && t.top[0] === target) r.withMajority++;
    }
  }
  return [...rec.values()];
}

/** Build a Vote for the store (`dispatch({ kind: 'vote', payload })`). */
export function makeVote(m: MatchState, meeting: number, voter: PlayerId, target: Target): Vote {
  return { meeting, voter, target, known: !m.settings.anonymousVotes };
}
