import { describe, expect, it } from 'vitest';
import { consolidate, isPlaceholderName, nameQuality, sameIdentity, type ConsolidatePlayer } from './rosterConsolidate';

const P = (id: string, name: string, extra: Partial<ConsolidatePlayer> = {}): ConsolidatePlayer =>
  ({ id, name, color: 'gray', status: 'alive', isMe: false, refs: 0, ...extra });

describe('name quality', () => {
  it('knows placeholders', () => {
    for (const n of ['#3', 'slot7', 'You', '(Black)', 'black', 'Red', 'unknown', '']) expect(isPlaceholderName(n), n).toBe(true);
    for (const n of ['BigBingus', 'Sir Nachos', 'LJ', 'N4ta']) expect(isPlaceholderName(n), n).toBe(false);
  });
  it('ranks chat lines and OCR noise below real names', () => {
    expect(nameQuality('BigBingus')).toBe(1);
    expect(nameQuality('told u 4 times')).toBeLessThan(0.3);
    expect(nameQuality('i saw it ot')).toBeLessThan(0.5);
    expect(nameQuality('BAMBÄM')).toBeLessThan(1);
    expect(nameQuality('(Black)')).toBe(0);
  });
});

describe('sameIdentity', () => {
  it('matches an OCR variant of a name', () => {
    expect(sameIdentity(P('a', 'BigBingus'), P('b', 'BigBihgis')).same).toBe(true);
    expect(sameIdentity(P('a', 'Neataunty'), P('b', 'NealAunty')).same).toBe(true);
    expect(sameIdentity(P('a', 'ExceLL01'), P('b', 'ExceLLoI')).same).toBe(true);
    expect(sameIdentity(P('a', 'Raymidland'), P('b', 'ymidland')).same).toBe(true);
  });
  it('never merges two cards that shared a vote grid', () => {
    expect(sameIdentity(P('a', 'Tim', { slot: 1, slotMeeting: 2 }), P('b', 'Tim2', { slot: 5, slotMeeting: 2 })).same).toBe(false);
  });
  it('folds a colour placeholder into the named card of that colour', () => {
    expect(sameIdentity(P('black', '(Black)', { color: 'black' }), P('slot9', 'straykids', { color: 'black', slot: 9, slotMeeting: 0 })).same).toBe(true);
    expect(sameIdentity(P('a', 'popz'), P('b', 'Kayleyy')).same).toBe(false);
  });
  it('folds a garbled grid name into the chat card of the same colour (live 2026-10-22)', () => {
    expect(sameIdentity(P('blue', 'Gobaltfox', { color: 'blue' }), P('slot4', 'eobältfÖ*', { color: 'blue', slot: 4, slotMeeting: 0 })).same).toBe(true);
    // two clean, different names of the same colour are two people (a colour misread)
    expect(sameIdentity(P('a', 'popz', { color: 'red' }), P('b', 'Kayleyy', { color: 'red', slot: 3, slotMeeting: 0 })).same).toBe(false);
  });
});

describe('consolidate', () => {
  it('merges the weaker duplicate into the grid-confirmed card', () => {
    const acts = consolidate([P('chat3', 'BigBihgis'), P('me', 'BigBingus', { isMe: true, slot: 1, slotMeeting: 0 }), P('red', 'Kayleyy', { slot: 2, slotMeeting: 0 }), P('chat9', 'Kayleyy ', { refs: 2 })], { size: null, tolerance: 0, meeting: 0 });
    expect(acts).toEqual([
      { kind: 'merge', from: 'chat9', into: 'red', why: expect.stringContaining('name') },
      { kind: 'merge', from: 'chat3', into: 'me', why: expect.stringContaining('name') },
    ]);
  });
  it('drops the weakest cards above the roster size, never me or the cards on this meeting grid', () => {
    const players = [
      P('me', 'BigBingus', { isMe: true, slot: 1, slotMeeting: 1 }),
      P('red', 'Kayleyy', { slot: 2, slotMeeting: 1, color: 'red' }),
      P('blue', 'popz', { slot: 3, slotMeeting: 1, color: 'blue' }),
      P('chat4', 'told u 4 times'),
      P('black', '(Black)', { color: 'black' }),
      P('lime', 'Monarch', { color: 'lime', refs: 3 }),
    ];
    const acts = consolidate(players, { size: 4, tolerance: 0, meeting: 1 });
    expect(acts.filter(a => a.kind === 'remove').map(a => (a as { id: string }).id)).toEqual(['chat4', 'black']);
    expect(acts.some(a => a.kind === 'remove' && a.id === 'lime')).toBe(false);
  });
  it('tolerates one extra card in the lobby', () => {
    const players = [P('me', 'BigBingus', { isMe: true }), P('a', 'Kayleyy'), P('b', 'popz'), P('c', 'Monarch')];
    expect(consolidate(players, { size: 3, tolerance: 1, meeting: 0 })).toEqual([]);
    expect(consolidate(players, { size: 2, tolerance: 1, meeting: 0 }).filter(a => a.kind === 'remove')).toHaveLength(1);
  });
});
