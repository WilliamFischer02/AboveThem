import { describe, it, expect } from 'vitest';
import { clockOnPhase, initialClock, stampAt } from './clock';

const ph = (phase: 'round' | 'meetingDiscussion' | 'ejection' | 'lobby', wall: number, lagMs?: number) => ({ phase, wall, round: 0, ...(lagMs !== undefined ? { lagMs } : {}) });

describe('round clock and detector lag', () => {
  it('a round confirmed 2.5 s late is back-dated, so t is not under-counted', () => {
    let c = clockOnPhase(initialClock, ph('round', 10_000, 2_500));
    expect(stampAt(c, 20_000).t).toBeCloseTo(12.5);
    c = clockOnPhase(c, ph('meetingDiscussion', 30_000, 1_000)); // meeting really began at 29 s
    expect(stampAt(c, 40_000).t).toBeCloseTo(21.5);              // frozen at 29 s - 7.5 s
  });

  it('a back-dated round never starts before the meeting that preceded it ended', () => {
    let c = clockOnPhase(initialClock, ph('round', 1_000));
    c = clockOnPhase(c, ph('meetingDiscussion', 5_000));
    c = clockOnPhase(c, ph('ejection', 6_000));
    c = clockOnPhase(c, ph('round', 6_500, 9_000)); // absurd lag: clamp to the freeze
    expect(c.round).toBe(1);
    expect(c.roundStartWall).toBe(5_000);
  });

  it('missing / bad lag values behave like no lag', () => {
    const a = clockOnPhase(initialClock, ph('round', 1_000));
    const b = clockOnPhase(initialClock, { ...ph('round', 1_000), lagMs: Number.NaN });
    const d = clockOnPhase(initialClock, ph('round', 1_000, -50));
    expect(b.roundStartWall).toBe(a.roundStartWall);
    expect(d.roundStartWall).toBe(1_000);
  });

  it('lobby resets the round start; the next round counts on', () => {
    let c = clockOnPhase(initialClock, ph('round', 1_000));
    c = clockOnPhase(c, ph('lobby', 2_000));
    expect(stampAt(c, 3_000).t).toBe(0);
    c = clockOnPhase(c, ph('round', 4_000));
    expect(c.round).toBe(1);
  });
});
