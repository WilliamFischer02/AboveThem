import { describe, it, expect } from 'vitest';
import { parseChatClaims, pushTally, resolvePlayer, resolveRoom, resolveTask } from './chatClaims';
import { fixture2 } from './__fixtures__/skeld_match_02_two_imp';

const m = fixture2; // cyan=me, blue, green, purple, yellow, white, black, orange(dead), red(ejected)
const p = (text: string, sender = 'white') => parseChatClaims(text, sender, m);

describe('chat → claims', () => {
  it('resolves colours and name fragments to players, aliases to rooms and tasks', () => {
    expect(resolvePlayer('blue', m)).toBe('blue');
    expect(resolvePlayer('grey', m)).toBeUndefined(); // nobody is gray in this lobby
    expect(resolvePlayer('purp', m)).toBe('purple');
    expect(resolveRoom('elec', m)).toBe('electrical');
    expect(resolveRoom('nav', m)).toBe('navigation');
    expect(resolveRoom('upper engine', m)).toBe('upperEngine');
    expect(resolveTask('wires', m)).toBe('fixWiring');
    expect(resolveTask('card swipe', m)).toBe('swipeCard');
  });

  it('location + companion', () => {
    expect(p('i was in elec with purple', 'green')).toEqual([{ type: 'companion', about: 'purple' }, { type: 'location', room: 'electrical' }]);
    expect(p('in admin the whole time', 'green')).toEqual([{ type: 'location', room: 'admin' }]);
    expect(p('blue was with me', 'green')).toEqual([{ type: 'companion', about: 'blue' }]);
  });

  it('accusations with and without reasons, votes, defenses, clears', () => {
    expect(p('blue is sus')).toEqual([{ type: 'accusation', about: 'blue', reason: undefined }]);
    expect(p('i saw purple vent in nav')).toEqual([{ type: 'accusation', about: 'purple', reason: 'vent' }]);
    expect(p('purple self reported')).toEqual([{ type: 'accusation', about: 'purple', reason: 'self reported' }]);
    expect(p('vote yellow', 'black')).toEqual([{ type: 'accusation', about: 'yellow', reason: undefined }]);
    expect(p('green is clear, scanned', 'yellow')).toEqual([{ type: 'clear', about: 'green' }]);
    expect(p('its not blue', 'yellow')).toEqual([{ type: 'defense', about: 'blue' }]);
    expect(p('blue is not sus', 'yellow')).toEqual([{ type: 'defense', about: 'blue' }]);
    expect(p('black killed yellow', 'green')).toEqual([{ type: 'accusation', about: 'black', about2: 'yellow', reason: 'kill' }]);
  });

  it('sightings and third-party companions', () => {
    expect(p('white was in admin', 'blue')).toEqual([{ type: 'sighting', about: 'white', room: 'admin' }]);
    expect(p('saw green in storage', 'blue')).toEqual([{ type: 'sighting', about: 'green', room: 'storage' }]);
    expect(p('purple and black were together', 'blue')).toEqual([{ type: 'companion', about: 'purple', about2: 'black' }]);
  });

  it('tasks and bodies', () => {
    expect(p('i did wires in elec', 'green')).toEqual([{ type: 'task', taskId: 'fixWiring', room: 'electrical' }]);
    expect(p('body in storage', 'green')).toEqual([{ type: 'body', room: 'storage' }]);
    expect(p('found the body in elec', 'green')).toEqual([{ type: 'body', room: 'electrical' }]);
  });

  it('ignores small talk and questions', () => {
    expect(p('hi')).toEqual([]);
    expect(p('where')).toEqual([]);
    expect(p('where was everyone')).toEqual([]);
    expect(p('skip')).toEqual([]);
  });

  it('tallies pushes per meeting', () => {
    const mm = { ...m, claims: [...m.claims, { id: 'x', meeting: 1, stamp: { round: 1, t: 40, wall: 9 }, by: 'yellow', type: 'defense' as const, about: 'green' }] };
    const tally = pushTally(mm, 1);
    expect(tally[0].target).toBe('green');
    expect(tally[0].accusers.sort()).toEqual(['black', 'white']);
    expect(tally[0].defenders).toEqual(['yellow']);
  });
});
