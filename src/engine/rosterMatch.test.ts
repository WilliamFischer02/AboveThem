import { describe, it, expect } from 'vitest';
import { matchGrid, hashDistance, rosterConfidence, type RosterPlayer, type GridEntry } from './rosterMatch';

const P = (id: string, name: string, color: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({ id, name, color, status: 'alive', ...extra });
const E = (index: number, name: string, color: string, extra: Partial<GridEntry> = {}): GridEntry => ({ index, name, color, dead: false, ...extra });

describe('rosterMatch', () => {
  it('re-sorted grid (dead last) still maps cards to the right players by name + icon', () => {
    // Meeting 1 order: red(0) blue(1) green(2). Red died; meeting 2 order: blue(0) green(1) red(2, dead).
    const players = [
      P('red', 'Alkylraven', 'red', { slot: 1, slotMeeting: 1, iconHash: 'aaaa0000ffff1111' }),
      P('blue', 'SHUSH', 'blue', { slot: 2, slotMeeting: 1, iconHash: '1234567890abcdef' }),
      P('green', 'Bean', 'green', { slot: 3, slotMeeting: 1, iconHash: 'ffffffff00000000' }),
    ];
    const entries = [
      E(0, 'SHUSH', 'blue', { iconHash: '1234567890abcdef' }),
      E(1, 'Bean', 'green', { iconHash: 'ffffffff00000000' }),
      E(2, 'Alkylraven', 'red', { dead: true, iconHash: 'aaaa0000ffff1111' }),
    ];
    const a = matchGrid(players, entries, 2);
    expect(a.map(x => x.playerId)).toEqual(['blue', 'green', 'red']);
    expect(a[2].reasons).toContain('icon');
  });

  it('a mangled name is rescued by the icon hash, and a same-meeting slot by itself', () => {
    const players = [P('red', 'Alkylraven', 'red', { iconHash: 'aaaa0000ffff1111' }), P('blue', 'SHUSH', 'blue', { slot: 2, slotMeeting: 3 })];
    const entries = [E(0, '#1', 'unknown', { iconHash: 'aaaa0000ffff1113' }), E(1, '#2', 'unknown')];
    const a = matchGrid(players, entries, 3);
    expect(a[0].playerId).toBe('red');
    expect(a[1].playerId).toBe('blue');
  });

  it('colour alone never pairs; an unmatched card becomes a new-player candidate', () => {
    const players = [P('red', 'Alkylraven', 'red')];
    const entries = [E(0, 'Totally New', 'red')];
    const a = matchGrid(players, entries, 1);
    expect(a[0].playerId).toBeNull();
  });

  it('elimination: with a settled roster, leftover cards go to leftover players instead of new ones', () => {
    const players = [P('red', 'Alkylraven', 'red'), P('blue', 'SHUSH', 'blue'), P('green', 'Bonsainew', 'green'), P('pink', 'Waxscarce', 'pink'), P('lime', 'Gone', 'lime', { status: 'disconnected' })];
    const entries = [E(0, 'Alkylraven', 'red'), E(1, 'SHUSH', 'blue'), E(2, 'Bonsainew', 'green'), E(3, 'W@x$c', 'unknown', { dead: true })];
    const a = matchGrid(players, entries, 1);
    expect(a[3].playerId).toBe('pink');
    expect(a[3].reasons).toContain('elimination');
    // a card has no owner left: still a candidate, never a disconnected player
    const b = matchGrid(players.filter(p => p.id !== 'pink'), entries, 1);
    expect(b[3].playerId).toBeNull();
  });

  it('a dead player cannot be matched to an alive card when a better alive candidate exists', () => {
    const players = [P('red', 'Sam', 'red', { status: 'dead' }), P('blue', 'Sam', 'blue')];
    const a = matchGrid(players, [E(0, 'Sam', 'unknown')], 2);
    expect(a[0].playerId).toBe('blue');
  });

  it('hash distance and confidence behave', () => {
    expect(hashDistance('ff', 'ff')).toBe(0);
    expect(hashDistance('ff', '0f')).toBe(4);
    expect(hashDistance(undefined, 'ff')).toBe(64);
    const entries = [E(0, 'A', 'red'), E(1, '#2', 'unknown')];
    const good = rosterConfidence([{ index: 0, playerId: 'a', score: 3, reasons: [] }, { index: 1, playerId: 'b', score: 3, reasons: [] }], entries);
    const bad = rosterConfidence([{ index: 0, playerId: null, score: 0, reasons: [] }, { index: 1, playerId: null, score: 0, reasons: [] }], entries);
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(1);
  });
});
