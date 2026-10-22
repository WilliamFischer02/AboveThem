import { describe, it, expect } from 'vitest';
import { killClock, killWindows, summarizeKillWindow, cooldownForRound, FIRST_ROUND_COOLDOWN_SEC, doubleKills } from './killWindow';
import { impostorTravelSec, subtract } from './util';
import { fixture } from '../__fixtures__/skeld_match_01';
import { build, o, st } from './__fixtures__/build';

describe('util', () => {
  it('impostor travel uses vents and never exceeds walking', () => {
    expect(impostorTravelSec(fixture.map, 'medbay', 'electrical')).toBe(2); // same vent network
    expect(impostorTravelSec(fixture.map, 'navigation', 'electrical')).toBe(12); // nav→shields vent, shields→cafe vent, cafe→medbay walk 6, medbay→elec vent
    expect(impostorTravelSec(fixture.map, 'nowhere', 'electrical')).toBeNull();
  });
  it('subtracts open intervals', () => {
    expect(subtract([[0, 50]], 10, 20)).toEqual([[0, 10], [20, 50]]);
    expect(subtract([[0, 50]], -5, 100)).toEqual([]);
  });
});

describe('kill clock', () => {
  it('uses the short first cooldown in round 0 and the lobby value afterwards', () => {
    const m = build();
    expect(cooldownForRound(m, 0)).toBe(FIRST_ROUND_COOLDOWN_SEC);
    expect(cooldownForRound(m, 1)).toBe(30);
    const c = killClock(m, st(18, 1));
    expect(c.ready).toBe(false);
    expect(c.readyIn).toBe(12);
    expect(killClock(m, st(31, 1)).ready).toBe(true);
  });
  it('tracks the next possible kill of an impostor I saw kill', () => {
    const m = build({ obs: [o(40, { type: 'sawKill', killer: 'red', victim: 'blue', room: 'storage' }, 2)] });
    const c = killClock(m, st(50, 2));
    expect(c.seenKillers).toHaveLength(1);
    expect(c.seenKillers[0].nextAt).toBe(70);
  });
});

describe('double kills', () => {
  it('two deaths certainly closer than the cooldown need two killers', () => {
    const m = build({
      obs: [
        o(32, { type: 'sighting', player: 'yellow', room: 'storage' }, 1),
        o(40, { type: 'sighting', player: 'orange', room: 'admin' }, 1),
        o(45, { type: 'bodyFound', victim: 'yellow', room: 'electrical' }, 1),
        o(45, { type: 'bodyFound', victim: 'orange', room: 'admin' }, 1),
      ],
    });
    const d = doubleKills(m, killWindows(m, 1));
    expect(d).toHaveLength(1);
    expect(d[0].maxGap).toBe(13);
    expect(d[0].line).toMatch(/two different killers/);
  });
  it('wide windows prove nothing (edge)', () => {
    const m = build({
      obs: [
        o(80, { type: 'bodyFound', victim: 'yellow', room: 'electrical' }, 1),
        o(80, { type: 'bodyFound', victim: 'orange', room: 'admin' }, 1),
      ],
    });
    expect(doubleKills(m, killWindows(m, 1))).toEqual([]);
  });
});

describe('kill window', () => {
  it('splits the fixture lobby into could / could not with reasons', () => {
    const [w] = killWindows(fixture);
    expect(w.lo).toBe(10);
    expect(w.hi).toBe(50);
    const could = w.could.map(p => p.player);
    const couldNot = w.couldNot.map(p => p.player);
    expect(couldNot).toContain('blue');          // with me the whole round
    expect(could).toEqual(expect.arrayContaining(['red', 'green', 'purple', 'white', 'orange']));
    const purple = w.could.find(p => p.player === 'purple')!;
    expect(purple.feasible).toEqual([[10, 31.6], [48.4, 50]]); // Nav at 0:40, 12 s by vent × 0.7 slack = 8.4 s
    expect(purple.reasons[0].refs).toEqual(['o5']);
    const blue = w.couldNot.find(p => p.player === 'blue')!;
    expect(blue.reasons[0].refs).toContain('o2'); // traceable to the with-me toggle
    expect(summarizeKillWindow(fixture, w)).toMatch(/could not: Blue \(with me since 0:03\)/);
  });

  it('tightens the window with the last time the victim was seen alive and a vitals read', () => {
    const m = build({
      obs: [
        o(20, { type: 'sighting', player: 'yellow', room: 'storage' }),
        o(30, { type: 'vitalsRead', dead: ['yellow'], alive: ['red', 'green'] }),
        o(40, { type: 'withMe', player: 'green', room: 'cafeteria', on: true }),
        o(60, { type: 'bodyFound', victim: 'yellow', room: 'electrical', reporter: 'red' }),
      ],
    });
    const [w] = killWindows(m);
    expect([w.lo, w.hi]).toEqual([20, 30]);
    expect(w.lowerBy).toBe('lastSeenAlive');
    expect(w.upperBy).toBe('vitals');
    // Green joined me only at 0:40 — after the window closed — so Green stays a candidate.
    expect(w.could.map(p => p.player)).toContain('green');
  });

  it('a with-me interval in the middle leaves both ends open (edge: partial cover)', () => {
    const m = build({
      obs: [
        o(15, { type: 'withMe', player: 'red', room: 'admin', on: true }),
        o(35, { type: 'withMe', player: 'red', room: 'admin', on: false }),
        o(60, { type: 'bodyFound', victim: 'yellow', room: 'electrical' }),
      ],
    });
    const [w] = killWindows(m);
    const red = w.could.find(p => p.player === 'red')!;
    // admin → electrical: admin→storage 5 + storage→elec 5 = 10 s
    expect(red.feasible).toEqual([[42, 60]]); // cut (15 − 7, 35 + 7): 10 s × 0.7 slack
    expect(red.openFraction).toBeLessThan(1);
  });

  it('players dead or ejected before the round are not candidates; other victims are not killers', () => {
    const m = build({
      obs: [
        o(50, { type: 'bodyFound', victim: 'white', room: 'admin' }, 0),
        o(30, { type: 'bodyFound', victim: 'yellow', room: 'electrical' }, 1),
        o(32, { type: 'bodyFound', victim: 'orange', room: 'storage' }, 1),
      ],
    });
    m.ejections.push({ meeting: 0, player: 'pink', wasImpostor: false });
    const ws = killWindows(m);
    expect(ws).toHaveLength(2);
    const all = [...ws[0].could, ...ws[0].couldNot].map(p => p.player);
    expect(all).not.toContain('white');
    expect(all).not.toContain('pink');
    expect(all).not.toContain('orange');
    expect(all).not.toContain('cyan');
  });
});
