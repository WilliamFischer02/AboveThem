import { describe, it, expect } from 'vitest';
import { MAPS } from '../data/maps';
import { travelMatrix } from './map';

/**
 * Sanity bounds for the eyeballed travel seconds: the longest walk on each map at speed 1.0.
 * Community timings put a full Skeld crossing (Reactor → Navigation) at roughly 25–35 s; MIRA is about as
 * long end to end; Polus, Airship and Fungle are larger. These bounds catch a typo (an edge of 60 s, a missing
 * link) rather than pin exact numbers.
 */
describe('map diameters (longest shortest walk)', () => {
  const diameter = (id: keyof typeof MAPS) => {
    const m = travelMatrix(MAPS[id]);
    return Math.max(...m.sec.flat());
  };
  it.each([
    ['skeld', 20, 40],
    ['mira', 20, 40],
    ['polus', 25, 50],
    ['airship', 25, 55],
    ['fungle', 25, 55],
  ] as const)('%s between %i and %i s', (id, lo, hi) => {
    const d = diameter(id);
    expect(d).toBeGreaterThanOrEqual(lo);
    expect(d).toBeLessThanOrEqual(hi);
  });
});
