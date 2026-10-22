import { describe, it, expect } from 'vitest';
import { lastSeenBoard, byRoom, unplacedThisRound } from './lastSeen';
import { fixture } from '../__fixtures__/skeld_match_01';
import { build, o, st } from './__fixtures__/build';

describe('last-seen board', () => {
  it('places everyone from the fixture with company and staleness', () => {
    const board = lastSeenBoard(fixture, st(50));
    const by = Object.fromEntries(board.map(e => [e.player, e]));
    expect(by.red).toMatchObject({ room: 'storage', t: 35, kind: 'seen', heading: 'electrical', staleness: 1 });
    expect(by.green).toMatchObject({ room: 'electrical', kind: 'reported', staleness: 0 });
    expect(by.blue.kind).toBe('withMeNow');
    expect(by.blue.with).toContain('cyan');
    expect(by.yellow).toMatchObject({ kind: 'dead', status: 'dead' });
    expect(by.white).toMatchObject({ room: null, staleness: 3 });
    // dead players sort after the living
    expect(board[board.length - 1].status).toBe('dead');
    expect(by.red.ref).toBe('o4'); // traceable
  });

  it('a later round wins over an earlier one; earlier rounds are stale (edge)', () => {
    const m = build({
      obs: [
        o(80, { type: 'sighting', player: 'red', room: 'admin' }, 0),
        o(5, { type: 'sighting', player: 'red', room: 'medbay', withPlayers: ['green'] }, 1),
        o(70, { type: 'sighting', player: 'blue', room: 'reactor' }, 0),
      ],
    });
    const board = lastSeenBoard(m, st(12, 1));
    const by = Object.fromEntries(board.map(e => [e.player, e]));
    expect(by.red).toMatchObject({ room: 'medbay', round: 1, ageSec: 7, staleness: 0 });
    expect(by.green.with).toContain('red');
    expect(by.blue).toMatchObject({ room: 'reactor', round: 0, staleness: 3, ageSec: null });
    expect(byRoom(board, 1)).toEqual([{ room: 'medbay', players: expect.arrayContaining(['red', 'green']) }]);
    expect(unplacedThisRound(board, 1)).toContain('blue');
  });

  it('shows the latest location claim separately', () => {
    const m = build();
    m.claims.push({ id: 'c1', meeting: 0, stamp: st(60), by: 'red', type: 'location', room: 'navigation', text: 'i was nav' });
    const by = Object.fromEntries(lastSeenBoard(m, st(60)).map(e => [e.player, e]));
    expect(by.red.claim).toMatchObject({ room: 'navigation', ref: 'c1' });
  });
});
