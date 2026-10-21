import { describe, it, expect } from 'vitest';
import { buildConfig, interpret, roomKeyCodes } from './hotkeys';
import { MAPS } from '../data/maps';

const skeld = MAPS.skeld;

describe('hotkey chords', () => {
  it('every Skeld room has a unique single-key code that does not collide with an action key', () => {
    const codes = roomKeyCodes(skeld);
    expect(Object.keys(codes)).toHaveLength(skeld.rooms.length);
    for (const bad of ['KeyV', 'KeyK', 'Period', 'Minus']) expect(codes[bad]).toBeUndefined();
  });

  it('config registers 18 colours + 4 specials in layer 1', () => {
    const c = buildConfig(skeld);
    expect(c.first).toHaveLength(22);
    expect(c.immediate).toEqual(['KeyZ', 'Backquote']);
    expect(c.second).toContain('KeyE');
    expect(c.second).toContain('Shift+Digit1');
  });

  it('interprets colour+room, colour+action, body+room, my room, undo', () => {
    expect(interpret(skeld, { first: 'KeyR', second: 'KeyE', cancelled: false })).toEqual({ kind: 'sighting', color: 'red', room: 'electrical' });
    expect(interpret(skeld, { first: 'KeyB', second: 'Period', cancelled: false })).toEqual({ kind: 'withMe', color: 'blue' });
    expect(interpret(skeld, { first: 'KeyG', second: 'Shift+Digit1', cancelled: false })).toEqual({ kind: 'sawVent', color: 'green' });
    expect(interpret(skeld, { first: 'KeyG', second: 'Shift+Equal', cancelled: false })).toEqual({ kind: 'mark', color: 'green', mark: 'sus' });
    expect(interpret(skeld, { first: 'Space', second: 'KeyE', cancelled: false })).toEqual({ kind: 'bodyFound', room: 'electrical' });
    expect(interpret(skeld, { first: 'Slash', second: 'KeyM', cancelled: false })).toEqual({ kind: 'myRoom', room: 'medbay' });
    expect(interpret(skeld, { first: 'KeyZ', second: null, cancelled: false })).toEqual({ kind: 'undo' });
    expect(interpret(skeld, { first: 'KeyR', second: null, cancelled: true })).toEqual({ kind: 'cancelled', first: 'KeyR' });
    expect(interpret(skeld, { first: 'KeyR', second: 'KeyZ', cancelled: false }).kind).toBe('unknown');
  });
});
