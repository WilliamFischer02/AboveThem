/**
 * Round clock: converts wall time into `Stamp { round, t }`.
 * Pure. The store feeds it phase events; it answers "what round, how many
 * seconds in" for the next observation.
 */
import type { PhaseChange, Stamp } from '../types/game';

export interface ClockState {
  round: number;        // -1 before the first round
  roundStartWall: number | null;
  /** Wall time the current meeting opened (observations during a meeting keep the round's t frozen). */
  frozenAtWall: number | null;
}

export const initialClock: ClockState = { round: -1, roundStartWall: null, frozenAtWall: null };

export function clockOnPhase(c: ClockState, p: PhaseChange): ClockState {
  switch (p.phase) {
    case 'roundStart':
    case 'round':
      // A new round begins only when coming from a non-round phase.
      if (c.frozenAtWall !== null || c.roundStartWall === null) {
        return { round: c.round + 1, roundStartWall: p.wall, frozenAtWall: null };
      }
      return c;
    case 'meetingDiscussion':
    case 'meetingVoting':
    case 'ejection':
      return { ...c, frozenAtWall: c.frozenAtWall ?? p.wall };
    case 'lobby':
    case 'gameOver':
      return { ...c, roundStartWall: null, frozenAtWall: p.wall };
  }
}

export function stampAt(c: ClockState, wall: number): Stamp {
  if (c.roundStartWall === null) return { round: Math.max(0, c.round), t: 0, wall };
  const end = c.frozenAtWall ?? wall;
  return { round: Math.max(0, c.round), t: Math.max(0, (end - c.roundStartWall) / 1000), wall };
}
