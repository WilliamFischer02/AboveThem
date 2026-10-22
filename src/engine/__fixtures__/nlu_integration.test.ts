/**
 * End-to-end: real chat lines → chat-nlu → scoreAll. Skipped while src/engine/chatNlu is the
 * stub (pre-merge); runs automatically once chat-nlu's parser is merged. Verified once against
 * chat-nlu's branch (2026-10-22 03:45) by copying their modules in temporarily.
 */
import { describe, it, expect } from 'vitest';
import { scoreAll } from '../suspicion';
import { parseAllChat } from '../chatNlu';
import { fixture3 } from './skeld_match_03_insufficient';
import type { MatchState } from '../../types/game';

const lines: [string, string][] = [
  ['green', 'body in storage'],
  ['blue', 'where'],
  ['white', 'purple sus he was near storage'],
  ['purple', 'no i was in admin doing card'],
  ['blue', 'yeah purple sus'],
  ['white', 'blue and me were in cafe'],
  ['green', 'i saw blue scan, blue clear'],
  ['purple', 'green self report'],
  ['blue', 'vote purple'],
];
const m: MatchState = { ...fixture3, chat: lines.map(([s, t], i) => ({ id: `L${i}`, meeting: 0, stamp: { round: 0, t: 60 + i, wall: i }, sender: s, original: t, source: 'ocr' })) };
const realParser = parseAllChat(m).length > 0;

describe.skipIf(!realParser)('chat-nlu → suspicion (needs the merged parser)', () => {
  it('accused + near-body sighting ranks Purple first; the scan-vouched player last; a false self-report call implicates the caller', () => {
    const s = scoreAll(m);
    expect(s[0].player).toBe('purple');
    expect(s[s.length - 1].player).toBe('blue');
    const purple = s[0];
    expect(purple.evidence.some(e => /saw them near the body/.test(e.label))).toBe(true);
    expect(purple.evidence.some(e => /self-report, but Blue and White were there/.test(e.label))).toBe(true);
    expect(purple.evidence.some(e => /Nobody vouches/.test(e.label))).toBe(false); // their own location line places them
    for (const x of s) for (const e of x.evidence) expect(e.refs.length).toBeGreaterThan(0);
  });
});
