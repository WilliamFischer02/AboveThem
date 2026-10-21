/**
 * Match store (Zustand). Phase 1 fills this in. Shape mirrors MatchState; every
 * mutation is an appended event so the NDJSON log and the store never diverge.
 */
import { create } from 'zustand';
import type { MatchState, Observation, Claim, Vote, Ejection, PhaseChange, ChatLine } from '../types/game';

type Event =
  | { kind: 'observation'; payload: Observation }
  | { kind: 'claim'; payload: Claim }
  | { kind: 'vote'; payload: Vote }
  | { kind: 'ejection'; payload: Ejection }
  | { kind: 'phase'; payload: PhaseChange }
  | { kind: 'chat'; payload: ChatLine };

interface Store {
  match: MatchState | null;
  log: Event[];
  dispatch: (e: Event) => void;
  undo: () => void;
}

export const useMatch = create<Store>((set) => ({
  match: null,
  log: [],
  dispatch: (e) => set((s) => ({ log: [...s.log, e], match: s.match ? apply(s.match, e) : s.match })),
  undo: () => set((s) => {
    const log = s.log.slice(0, -1);
    return { log, match: s.match ? replay(s.match, log) : s.match };
  }),
}));

function apply(m: MatchState, e: Event): MatchState {
  switch (e.kind) {
    case 'observation': return { ...m, observations: [...m.observations, e.payload] };
    case 'claim': return { ...m, claims: [...m.claims, e.payload] };
    case 'vote': return { ...m, votes: [...m.votes, e.payload] };
    case 'ejection': return { ...m, ejections: [...m.ejections, e.payload] };
    case 'phase': return { ...m, phase: e.payload };
    case 'chat': return { ...m, chat: [...m.chat, e.payload] };
  }
}

function replay(base: MatchState, log: Event[]): MatchState {
  const empty: MatchState = { ...base, observations: [], claims: [], votes: [], ejections: [], chat: [] };
  return log.reduce(apply, empty);
}
