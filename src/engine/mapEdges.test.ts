/** Map helpers on missing / odd data must fail soft (never "too far", never throw, never NaN). bugs-rust review. */
import { describe, expect, it } from 'vitest';
import { MAPS } from '../data/maps';
import { couldReach, fastestSeconds, reachableOnFoot, travelMatrix, walkSeconds } from './map';
import { monitorContradiction, monitorReadFromObs } from './mapChecks';

const skeld = MAPS.skeld;
const [a, b] = [skeld.rooms[0].id, skeld.rooms[skeld.rooms.length - 1].id];

describe('map helpers with unknown rooms / bad numbers', () => {
  it('walkSeconds: an unknown room is "could be anywhere" (0), not a throw or Infinity', () => {
    expect(() => walkSeconds(skeld, 'unknown', a)).not.toThrow();
    expect(walkSeconds(skeld, 'unknown', a)).toBe(0);
    expect(walkSeconds(skeld, a, 'unknown')).toBe(0);
    expect(reachableOnFoot(skeld, a, 'unknown', 10, 11)).toBe(true);
    expect(walkSeconds(skeld, a, b)).toBeGreaterThan(0);
    expect(Number.isFinite(walkSeconds(skeld, a, b))).toBe(true);
  });

  it('walkSeconds: zero / negative / NaN speed falls back to 1', () => {
    const base = walkSeconds(skeld, a, b);
    expect(walkSeconds(skeld, a, b, 0)).toBe(base);
    expect(walkSeconds(skeld, a, b, -2)).toBe(base);
    expect(walkSeconds(skeld, a, b, Number.NaN)).toBe(base);
  });

  it('couldReach: an unknown time gap never says "could not have got there"', () => {
    expect(couldReach(skeld, a, b, Number.NaN)).toBe(true);
    expect(couldReach(skeld, a, b, 0)).toBe(false);
  });

  it('travelMatrix is cached per map object: a different map object gets its own matrix', () => {
    const m1 = travelMatrix(skeld);
    expect(travelMatrix(skeld)).toBe(m1);
    const clone = { ...skeld, rooms: skeld.rooms.map(r => ({ ...r, adjacent: r.adjacent.map(x => ({ ...x, sec: x.sec * 2 })) })) };
    expect(travelMatrix(clone)).not.toBe(m1);
    expect(fastestSeconds(clone, a, b)).toBeCloseTo(fastestSeconds(skeld, a, b) * 2);
  });

  it('monitor reads without a usable time never produce a contradiction', () => {
    expect(monitorReadFromObs({ type: 'adminRead', counts: { [a]: 0 } })).toBeNull();
    const claim = { player: 'red', room: a, t: Number.NaN };
    expect(monitorContradiction(skeld, { kind: 'admin', t: 3, counts: { [a]: 0 } }, claim)).toBeNull();
    expect(monitorContradiction(skeld, { kind: 'admin', t: Number.NaN, counts: { [a]: 0 } }, { ...claim, t: 3 })).toBeNull();
    // a doorlog read keeps working without a stamp (it carries its own from/to)
    expect(monitorReadFromObs({ type: 'doorLogRead', entries: [], from: 0, to: 10 })).not.toBeNull();
  });
});
