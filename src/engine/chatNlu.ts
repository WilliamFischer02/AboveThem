/**
 * MERGE STUB (ui-streamline): chat-nlu owns the real src/engine/chatNlu.ts (contract in
 * scratchpad/relay/from-chat-nlu.md). This stub only exists so the transcript view compiles
 * on this branch; it returns no assertions, so the view shows grouped lines without badges.
 * At merge: TAKE chat-nlu's version wholesale and delete this stub.
 */
import type { MatchState, PlayerId } from '../types/game';

/** Subset of chat-nlu's ChatAssertion (the real one lives in game.ts after merge). */
export interface ChatAssertionStub {
  id: string; line: string; meeting: number; speaker: PlayerId;
  kind: string; about: PlayerId[]; polarity: 1 | -1 | 0; strength: number; confidence: number;
  quote: string; why: string[]; supersededBy?: string;
}

export function parseMeetingChat(_m: MatchState, _meeting: number): ChatAssertionStub[] {
  return [];
}
