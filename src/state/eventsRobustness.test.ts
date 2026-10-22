import { describe, it, expect } from 'vitest';
import { replay, parseLines, lastUndoable, type MatchEvent, type InitPayload } from './events';
import { fixture } from '../engine/__fixtures__/skeld_match_01';

const init: InitPayload = {
  id: 'm1', startedAt: 1000, settings: fixture.settings, map: 'skeld', me: 'cyan', myRole: 'crew',
  players: Object.values(fixture.players).map(p => ({ ...p, status: 'alive', knownRole: p.isMe ? 'crew' : 'unknown' })),
};

describe('event log robustness (resume after restart / newer builds)', () => {
  it('an unknown event kind from a newer build leaves the state alone instead of wiping it', () => {
    const log = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'somethingNew', wall: 2000, payload: { x: 1 } },
      { kind: 'observation', wall: 3000, payload: { id: 'o1', type: 'myRoom', stamp: { round: 0, t: 1, wall: 3000 }, source: 'me', confidence: 1, room: 'medbay' } },
    ] as unknown as MatchEvent[];
    const m = replay(log);
    expect(m).not.toBeNull();
    expect(m!.observations).toHaveLength(1);
  });

  it('parseLines skips null / number / half-written lines', () => {
    const text = [JSON.stringify({ kind: 'init', wall: 1, payload: init }), 'null', '42', '{"kind":"chat"', '"str"', ''].join('\n');
    expect(parseLines(text).map(e => e.kind)).toEqual(['init']);
  });

  it('diag events are logged but never undone and never change the state', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'diag', wall: 2000, payload: { what: 'chatUnreadable', sender: 'red' } },
    ];
    const m = replay(log)!;
    expect(m.chat).toHaveLength(0);
    expect(lastUndoable(log)).toBeNull();
  });

  it('a translation guess is patched onto its chat line', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'chat', wall: 2000, payload: { id: 'c1', meeting: 0, stamp: { round: 0, t: 0, wall: 2000 }, sender: 'red', original: 'KTO y6mn', source: 'ocr', unreadable: true, scriptHint: 'cyrillic' } },
      { kind: 'chatPatch', wall: 2100, payload: { id: 'c1', translated: 'who killed', lang: 'ru', xlatGuess: true } },
    ];
    const c = replay(log)!.chat[0];
    expect(c).toMatchObject({ translated: 'who killed', lang: 'ru', xlatGuess: true, unreadable: true, scriptHint: 'cyrillic' });
  });
});
