import { describe, expect, it } from 'vitest';
import { stripStep, type Strip } from './reasonStrip';

const open = (player = 'red', mode: 'sus' | 'clear' = 'sus', plain = true, seq = 1): Strip => ({ player, mode, plain, seq });

describe('reason strip state machine', () => {
  it('SUS opens a pending strip and logs nothing yet', () => {
    const r = stripStep(null, { type: 'button', player: 'red', mode: 'sus' }, 1);
    expect(r.state).toEqual(open());
    expect(r.marks).toEqual([]);
  });

  it('a reason logs exactly one mark with that reason (no double count)', () => {
    const r = stripStep(open(), { type: 'reason', reason: 'proximityToBody' }, 2);
    expect(r.state).toBeNull();
    expect(r.marks).toEqual([{ player: 'red', mark: 'sus', reason: 'proximityToBody' }]);
  });

  it('same button again, Enter and the timeout each log one plain mark', () => {
    expect(stripStep(open(), { type: 'button', player: 'red', mode: 'sus' }, 2).marks).toEqual([{ player: 'red', mark: 'sus' }]);
    expect(stripStep(open(), { type: 'enter' }, 2).marks).toEqual([{ player: 'red', mark: 'sus' }]);
    expect(stripStep(open(), { type: 'timeout', seq: 1 }, 2).marks).toEqual([{ player: 'red', mark: 'sus' }]);
  });

  it('Esc cancels without logging', () => {
    expect(stripStep(open(), { type: 'escape' }, 2)).toEqual({ state: null, marks: [] });
  });

  it('a stale timeout (older strip) is ignored', () => {
    const r = stripStep(open('red', 'sus', true, 5), { type: 'timeout', seq: 4 }, 6);
    expect(r.state?.seq).toBe(5);
    expect(r.marks).toEqual([]);
  });

  it("another card's button commits the pending plain mark and opens a new strip", () => {
    const r = stripStep(open('red'), { type: 'button', player: 'blue', mode: 'clear' }, 2);
    expect(r.marks).toEqual([{ player: 'red', mark: 'sus' }]);
    expect(r.state).toEqual(open('blue', 'clear', true, 2));
  });

  it('the other button on the same card is a misclick: nothing logged', () => {
    const r = stripStep(open('red', 'sus'), { type: 'button', player: 'red', mode: 'clear' }, 2);
    expect(r.marks).toEqual([]);
    expect(r.state?.mode).toBe('clear');
  });

  it('already marked → strip only adds a reason; Enter / timeout / same button log nothing', () => {
    const s = stripStep(null, { type: 'button', player: 'red', mode: 'sus', current: 'sus' }, 1).state!;
    expect(s.plain).toBe(false);
    expect(stripStep(s, { type: 'enter' }, 2).marks).toEqual([]);
    expect(stripStep(s, { type: 'timeout', seq: 1 }, 2).marks).toEqual([]);
    expect(stripStep(s, { type: 'button', player: 'red', mode: 'sus' }, 2).marks).toEqual([]);
    expect(stripStep(s, { type: 'reason', reason: 'ventSound', current: 'sus' }, 2).marks).toEqual([{ player: 'red', mark: 'sus', reason: 'ventSound' }]);
  });

  it('edge: a reason on a hard-cleared player keeps the clear hard; HARD and unmark', () => {
    const s = stripStep(null, { type: 'button', player: 'red', mode: 'clear', current: 'hardClear' }, 1).state!;
    expect(stripStep(s, { type: 'reason', reason: 'sawVisualTask', current: 'hardClear' }, 2).marks).toEqual([{ player: 'red', mark: 'hardClear', reason: 'sawVisualTask' }]);
    expect(stripStep(open('red', 'clear'), { type: 'hard' }, 2).marks).toEqual([{ player: 'red', mark: 'hardClear' }]);
    expect(stripStep(s, { type: 'unmark' }, 2).marks).toEqual([{ player: 'red', mark: 'neutral' }]);
  });

  it('events with no strip open are no-ops', () => {
    for (const ev of [{ type: 'enter' }, { type: 'escape' }, { type: 'hard' }, { type: 'unmark' }, { type: 'reason', reason: 'other' }, { type: 'timeout', seq: 1 }] as const) {
      expect(stripStep(null, ev, 1)).toEqual({ state: null, marks: [] });
    }
  });
});
