import { describe, it, expect } from 'vitest';
import { parseChatClaims, resolvePlayer, resolveRoom } from './chatClaims';
import { fixture2 } from './__fixtures__/skeld_match_02_two_imp';

const m = fixture2; // cyan=me, blue, green, purple, yellow, white, black, orange(dead), red(ejected)

describe('chat → claims', () => {
  it('resolves colours and name fragments to players, aliases to rooms', () => {
    expect(resolvePlayer('blue', m)).toBe('blue');
    expect(resolvePlayer('grey', m)).toBeUndefined(); // nobody is gray in this lobby
    expect(resolvePlayer('purp', m)).toBe('purple');
    expect(resolveRoom('elec', m)).toBe('electrical');
    expect(resolveRoom('nav', m)).toBe('navigation');
    expect(resolveRoom('upper engine', m)).toBe('upperEngine');
  });

  it('parses location, companion, accusation and clear claims', () => {
    expect(parseChatClaims('i was in elec with purple', 'green', m)).toEqual([
      { type: 'location', room: 'electrical' },
      { type: 'companion', about: 'purple' },
    ]);
    expect(parseChatClaims('blue is sus', 'white', m)).toEqual([{ type: 'accusation', about: 'blue', reason: undefined }]);
    expect(parseChatClaims('i saw purple vent in nav', 'white', m)).toEqual([{ type: 'accusation', about: 'purple', reason: 'vent' }]);
    expect(parseChatClaims('green is clear, scanned', 'yellow', m)).toEqual([{ type: 'clear', about: 'green' }]);
    expect(parseChatClaims('vote yellow', 'black', m)).toEqual([{ type: 'accusation', about: 'yellow', reason: undefined }]);
    expect(parseChatClaims('white was in admin', 'blue', m)).toEqual([{ type: 'sighting', about: 'white', room: 'admin' }]);
  });

  it('ignores small talk', () => {
    expect(parseChatClaims('hi', 'blue', m)).toEqual([]);
    expect(parseChatClaims('where', 'blue', m)).toEqual([]);
    expect(parseChatClaims('skip', 'blue', m)).toEqual([]);
  });
});
