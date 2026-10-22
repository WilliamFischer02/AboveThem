// STUB — replaced by chat-nlu's branch at merge (take theirs on the add/add conflict).
// Same exported names and signatures as chat-nlu contract v1; returns nothing so the engine
// falls back to Claim records (chatEvidence.claimsToAssertions).
import type { MatchState } from '../../types/game';
import type { ChatAssertion } from '../chatNluTypes';

export function parseMeetingChat(_m: MatchState, _meeting: number): ChatAssertion[] { return []; }
export function parseAllChat(_m: MatchState): ChatAssertion[] { return []; }
export function activeAssertions(list: ChatAssertion[]): ChatAssertion[] {
  return list.filter(a => !a.supersededBy && a.kind !== 'question' && a.kind !== 'noise' && a.kind !== 'myColor');
}
