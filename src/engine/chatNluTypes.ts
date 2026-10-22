/**
 * SHIM — chat-nlu's contract v1 types, copied verbatim so this branch compiles before the merge.
 * chat-nlu appends the real definitions to src/types/game.ts (block "Chat NLU").
 *
 * MERGE: once chat-nlu's game.ts block is in, replace this whole file with
 *   export type { ChatAssertion, ChatAssertionKind, ChatReason, ChatResolution, SpeakerProfile, StanceFlip } from '../types/game';
 * (If forgotten it still compiles: the shapes are structurally identical.)
 */
import type { PlayerColor, PlayerId, RoomId } from '../types/game';

export type ChatAssertionKind =
  | 'accuse' | 'clear' | 'withMe' | 'sawTask' | 'sawVent' | 'sawKill' | 'location'
  | 'selfReport' | 'bodyLocation' | 'voteCall' | 'skipCall' | 'question' | 'defense' | 'noise'
  | 'sighting' | 'withOther' | 'task' | 'dead' | 'myColor';

export type ChatReason =
  | 'sus' | 'vent' | 'kill' | 'selfReport' | 'followed' | 'fakeTask' | 'lying' | 'nearBody'
  | 'leftBody' | 'stack' | 'its' | 'either' | 'bare' | 'visual' | 'scan' | 'task' | 'safe'
  | 'withThem' | 'notSus' | 'notClear' | 'didnt';

export type ChatResolution = 'direct' | 'fuzzy' | 'pronoun' | 'addressee' | 'context' | 'reply' | 'implicit';

export interface ChatAssertion {
  id: string;
  line: string;
  meeting: number;
  speaker: PlayerId;
  kind: ChatAssertionKind;
  about: PlayerId[];
  room?: RoomId;
  taskId?: string;
  victim?: PlayerId;
  reason?: ChatReason;
  polarity: 1 | -1 | 0;
  strength: number;
  confidence: number;
  negated?: boolean;
  question?: 'where' | 'who' | 'why' | 'what' | 'proof' | 'how';
  color?: PlayerColor;
  text: string;
  span: [number, number];
  quote: string;
  resolvedVia: ChatResolution;
  refs: string[];
  why: string[];
  supersededBy?: string;
}

export interface StanceFlip {
  target: PlayerId;
  from: 1 | -1;
  to: 1 | -1;
  fromAssertion: string;
  toAssertion: string;
  fromMeeting: number;
  toMeeting: number;
  sameMeeting: boolean;
}

export interface SpeakerProfile {
  player: PlayerId;
  lines: number;
  assertions: number;
  accusations: number;
  accused: PlayerId[];
  clears: number;
  cleared: PlayerId[];
  selfDefenses: number;
  questions: number;
  voteCalls: number;
  skipCalls: number;
  accusedBy: PlayerId[];
  clearedBy: PlayerId[];
  firstAccusations: number;
  bandwagons: number;
  flips: StanceFlip[];
  locationChanges: { meeting: number; rooms: RoomId[]; assertions: string[] }[];
  consistency: number;
  refs: string[];
}
