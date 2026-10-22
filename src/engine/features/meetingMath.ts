/**
 * Player counter + vote arithmetic for meetings (features #2).
 *
 * Game rules encoded here (Among Us wiki Meeting / Ejection / Guide:Crewmate, confirmed by the
 * research agent in relay/game-knowledge.md §1.1 and §1.4):
 *  - Impostors WIN as soon as alive impostors ≥ alive crewmates (checked after every kill and
 *    every ejection). So the crew can lose `crew − impostors` more crewmates (kills or wrong
 *    ejections) before the game ends; the last of those ends it.
 *  - Crew WIN when every impostor is ejected (or tasks complete).
 *  - Voting is PLURALITY, not majority: the player with the most votes is ejected. If two or more
 *    players tie for the most votes, or Skip has at least as many votes as the top player, nobody
 *    is ejected (wiki: "skip-plurality, ties (incl. tie with skip) or no votes ⇒ nobody ejected").
 *    Players who never vote are not counted.
 *  - A strict majority (⌊alive/2⌋ + 1) on one name therefore GUARANTEES the ejection.
 *  - Ghosts cannot vote.
 *
 * Only on-screen information is used: who is alive (vote grid), ejection texts, lobby settings.
 */
import type { MatchState, PlayerId, Vote } from '../../types/game';

export interface ImpostorBounds {
  min: number;
  max: number;
  /** Why the bounds are what they are (human lines). */
  why: string[];
}

export function impostorBounds(m: MatchState): ImpostorBounds {
  const why: string[] = [];
  const start = m.settings.impostorCount;
  const confirmedOut = m.ejections.filter(e => e.wasImpostor === true).length;
  const unknownOut = m.ejections.filter(e => e.player && e.wasImpostor === null).length;
  let max = Math.max(0, start - confirmedOut);
  let min = Math.max(0, max - unknownOut);
  if (confirmedOut) why.push(`${confirmedOut} impostor${confirmedOut > 1 ? 's' : ''} ejected (confirmed)`);
  if (unknownOut) why.push(`${unknownOut} ejection${unknownOut > 1 ? 's' : ''} not confirmed (confirm ejects off)`);
  // The ejection screen said "N impostors remain": that is exact.
  const said = [...m.ejections].reverse().find(e => e.impostorsRemaining !== undefined);
  if (said && said.impostorsRemaining !== undefined) { min = max = said.impostorsRemaining; why.push(`ejection screen: ${said.impostorsRemaining} remain`); }
  const alive = Object.values(m.players).filter(p => p.status === 'alive').length;
  const running = m.phase.phase !== 'gameOver' && m.phase.phase !== 'lobby';
  if (running) {
    // The game would have ended if impostors ≥ crew, so impostors < alive / 2.
    const cap = Math.floor((alive - 1) / 2);
    if (cap < max) { max = Math.max(0, cap); why.push(`game still running with ${alive} alive ⇒ at most ${max}`); }
    if (min < 1 && max >= 1) { min = 1; why.push('game still running ⇒ at least 1'); }
  }
  // Impostors I know are dead do not count (ejected = already subtracted above).
  return { min: Math.min(min, max), max, why };
}

export type Danger = 'safe' | 'careful' | 'critical';

export interface MeetingMath {
  alive: number;
  dead: number;
  /** Alive players whose vote counts (ghosts cannot vote). */
  voters: number;
  impostors: ImpostorBounds;
  /** Worst case (most impostors alive). */
  crewAlive: number;
  /** Crewmates the crew can still lose (kills + wrong ejections) before the game ends — the last one ends it. */
  crewDeathsToLoss: number;
  /** Correct ejections the crew still needs. */
  ejectionsNeeded: number;
  /** Ejecting a crewmate now ends the game (impostors win). */
  wrongVoteLoses: boolean;
  /** After a skip, one kill ends the game. */
  skipThenOneKillLoses: boolean;
  /** After a skip, every impostor killing once ends the game. */
  skipThenEachKillsLoses: boolean;
  /** Ejecting an impostor now ends the game (crew win) — certain only if `impostors.max === 1`. */
  rightVoteWins: boolean | 'maybe';
  /** Votes on one name that guarantee the ejection. */
  guaranteedEject: number;
  danger: Danger;
  lines: string[];
}

export function meetingMath(m: MatchState): MeetingMath {
  const players = Object.values(m.players);
  const alive = players.filter(p => p.status === 'alive').length;
  const dead = players.filter(p => p.status === 'dead' || p.status === 'ejected').length;
  const imp = impostorBounds(m);
  const I = imp.max;
  const crewAlive = Math.max(0, alive - I);
  const crewDeathsToLoss = Math.max(0, crewAlive - I);
  const wrongVoteLoses = I > 0 && crewAlive - 1 <= I;
  const skipThenOneKillLoses = wrongVoteLoses;
  const skipThenEachKillsLoses = I > 0 && crewAlive - I <= I;
  const rightVoteWins: MeetingMath['rightVoteWins'] = imp.max === 1 ? true : imp.min === 1 ? 'maybe' : false;
  const guaranteedEject = Math.floor(alive / 2) + 1;
  const danger: Danger = wrongVoteLoses ? 'critical' : skipThenEachKillsLoses || crewDeathsToLoss <= 2 ? 'careful' : 'safe';

  const impText = imp.min === imp.max ? `${imp.max}` : `${imp.min}–${imp.max}`;
  const lines: string[] = [];
  lines.push(`${alive} alive · ${dead} dead · ${impText} impostor${imp.max === 1 ? '' : 's'} left ⇒ crew needs ${imp.min === imp.max ? I : `${imp.min}–${imp.max}`} more correct ejection${I === 1 ? '' : 's'}`);
  if (wrongVoteLoses) lines.push('CRITICAL: ejecting a crewmate now LOSES the game — and so does skipping, if they get one kill');
  else if (skipThenEachKillsLoses) lines.push(`Careful: a skip + ${I} kills next round ends it; a wrong vote leaves ${crewDeathsToLoss - 1} crew death${crewDeathsToLoss - 1 === 1 ? '' : 's'} of slack`);
  else lines.push(`Crew can afford ${crewDeathsToLoss - 1} more crew death${crewDeathsToLoss - 1 === 1 ? '' : 's'} (kills or wrong votes); the ${ordinal(crewDeathsToLoss)} ends it`);
  if (rightVoteWins === true) lines.push('Eject the last impostor ⇒ crew wins');
  else if (rightVoteWins === 'maybe') lines.push('If this is the last impostor, ejecting them wins');
  lines.push(`${guaranteedEject} of ${alive} votes on one name guarantees the ejection (most votes wins; a tie, or skip ≥ the top name, ejects nobody)`);
  if (I >= 2 && !wrongVoteLoses) lines.push(`An impostor bloc is ${I} votes: the crew needs ${I + 1}+ together to beat it`);
  return { alive, dead, voters: alive, impostors: imp, crewAlive, crewDeathsToLoss, ejectionsNeeded: I, wrongVoteLoses, skipThenOneKillLoses, skipThenEachKillsLoses, rightVoteWins, guaranteedEject, danger, lines };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------

export interface TallyResult {
  counts: Record<string, number>; // PlayerId | 'skip'
  ejected: PlayerId | null;
  reason: 'plurality' | 'tie' | 'skip' | 'noVotes';
  top: (PlayerId | 'skip')[];
}

/** Apply the in-game vote rule to a set of votes (one per voter; later votes replace earlier ones). */
export function tally(votes: Pick<Vote, 'voter' | 'target'>[]): TallyResult {
  const last = new Map<PlayerId, Vote['target']>();
  for (const v of votes) last.set(v.voter, v.target);
  const counts: Record<string, number> = {};
  for (const t of last.values()) if (t !== 'none') counts[t] = (counts[t] ?? 0) + 1;
  const skip = counts.skip ?? 0;
  const players = Object.entries(counts).filter(([k]) => k !== 'skip');
  if (players.length === 0) return { counts, ejected: null, reason: skip > 0 ? 'skip' : 'noVotes', top: skip > 0 ? ['skip'] : [] };
  const best = Math.max(...players.map(([, n]) => n));
  const top = players.filter(([, n]) => n === best).map(([k]) => k);
  if (skip >= best) return { counts, ejected: null, reason: 'skip', top: skip > best ? ['skip'] : ['skip', ...top] };
  if (top.length > 1) return { counts, ejected: null, reason: 'tie', top };
  return { counts, ejected: top[0], reason: 'plurality', top };
}
