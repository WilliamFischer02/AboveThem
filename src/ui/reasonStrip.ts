/**
 * Sus / clear "why?" strip as a pure state machine (no React, no DOM) so it can be tested.
 *
 * SUS or CLR on a card opens the strip for that player + mode. Nothing is logged yet, because
 * same-direction marks with different reasons STACK in the engine (marks.ts). Logging a plain
 * mark first and a reasoned one second would count twice. The pending mark resolves as:
 *   reason / digit n      → mark with that reason (a hard clear stays hard)
 *   same button again     → plain mark
 *   Enter / timeout       → plain mark
 *   Esc                   → nothing
 *   other card's button   → previous pending plain mark is logged, new strip opens
 *   other button same card→ previous one was a misclick: dropped, new strip opens
 *   🛡 HARD / ✕ unmark    → hardClear / neutral
 * If the player already carries a mark in that direction the strip only ADDS a reason
 * (`plain: false`): Enter / timeout / same button then log nothing.
 */
import type { PlayerId, UserMark } from '../types/game';

export type StripMode = 'sus' | 'clear';
export interface Strip { player: PlayerId; mode: StripMode; plain: boolean; seq: number }
export interface MarkCmd<R extends string = string> { player: PlayerId; mark: UserMark | 'neutral'; reason?: R }

export type StripEvent<R extends string = string> =
  | { type: 'button'; player: PlayerId; mode: StripMode; current?: UserMark }
  | { type: 'reason'; reason: R; current?: UserMark }
  | { type: 'hard' }
  | { type: 'unmark' }
  | { type: 'enter' }
  | { type: 'escape' }
  | { type: 'timeout'; seq: number };

export interface StripResult<R extends string = string> { state: Strip | null; marks: MarkCmd<R>[] }

export const STRIP_MS = 3000;

const alreadyMarked = (mode: StripMode, current?: UserMark) =>
  mode === 'sus' ? current === 'sus' : current === 'clear' || current === 'hardClear';

const plainOf = <R extends string>(s: Strip): MarkCmd<R>[] => (s.plain ? [{ player: s.player, mark: s.mode }] : []);

export function stripStep<R extends string>(state: Strip | null, ev: StripEvent<R>, nextSeq: number): StripResult<R> {
  switch (ev.type) {
    case 'button': {
      if (state && state.player === ev.player && state.mode === ev.mode) return { state: null, marks: plainOf(state) };
      const carried = state && state.player !== ev.player ? plainOf<R>(state) : [];
      return { state: { player: ev.player, mode: ev.mode, plain: !alreadyMarked(ev.mode, ev.current), seq: nextSeq }, marks: carried };
    }
    case 'reason': {
      if (!state) return { state: null, marks: [] };
      const mark: UserMark = state.mode === 'clear' && ev.current === 'hardClear' ? 'hardClear' : state.mode;
      return { state: null, marks: [{ player: state.player, mark, reason: ev.reason }] };
    }
    case 'hard':
      return state ? { state: null, marks: [{ player: state.player, mark: 'hardClear' }] } : { state: null, marks: [] };
    case 'unmark':
      return state ? { state: null, marks: [{ player: state.player, mark: 'neutral' }] } : { state: null, marks: [] };
    case 'enter':
      return state ? { state: null, marks: plainOf(state) } : { state: null, marks: [] };
    case 'escape':
      return { state: null, marks: [] };
    case 'timeout':
      if (!state || state.seq !== ev.seq) return { state, marks: [] }; // stale timer
      return { state: null, marks: plainOf(state) };
  }
}
