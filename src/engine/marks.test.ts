import { describe, it, expect } from 'vitest';
import { SUS_REASONS, CLEAR_REASONS, markObservation, markHistory, markWeight, markToast } from './marks';
import { ruleManualMarks, userMarks } from './rules';
import { hardFacts } from './suspicion';
import { fixture3 } from './__fixtures__/skeld_match_03_insufficient';
import type { ManualMarkObs, MarkReason, MatchState } from '../types/game';

let n = 0;
const mark = (player: string, k: ManualMarkObs['mark'], reason?: MarkReason, round = 0): ManualMarkObs =>
  ({ ...markObservation(player, k, reason), id: `mk${++n}`, stamp: { round, t: 10 + n, wall: n }, source: 'manual', confidence: 0.9 }) as ManualMarkObs;
const withMarks = (...obs: ManualMarkObs[]): MatchState => ({ ...fixture3, observations: [...fixture3.observations, ...obs] });

describe('mark reasons', () => {
  it('exports a dropdown list with distinct weights and labels', () => {
    expect(SUS_REASONS.length).toBe(9);
    expect(CLEAR_REASONS.length).toBe(4);
    for (const r of SUS_REASONS) expect(r.weight).toBeGreaterThan(0);
    for (const r of CLEAR_REASONS) expect(r.weight).toBeLessThan(0);
    expect(new Set(SUS_REASONS.map(r => r.label)).size).toBe(SUS_REASONS.length);
    expect(markWeight('sus', 'fakeTasking')).toBeGreaterThan(markWeight('sus', 'unaccountedFor'));
  });

  it('a sus mark without a reason keeps the default weight and label', () => {
    const ev = ruleManualMarks(withMarks(mark('blue', 'sus')));
    expect(ev).toHaveLength(1);
    expect(ev[0].weight).toBeCloseTo(0.8);
    expect(ev[0].label).toBe('Marked sus by you');
  });

  it('different reasons stack, the same reason in one round does not, neutral wipes', () => {
    const m = withMarks(mark('blue', 'sus', 'fakeTasking'), mark('blue', 'sus', 'lyingInChat'), mark('blue', 'sus', 'fakeTasking'));
    const ev = ruleManualMarks(m);
    expect(ev.map(e => e.label).sort()).toEqual(['You caught them lying in chat', 'You saw them fake a task']);
    expect(userMarks(m).get('blue')?.reason).toBe('fakeTasking');
    expect(ruleManualMarks(withMarks(mark('blue', 'sus', 'fakeTasking'), mark('blue', 'neutral')))).toHaveLength(0);
  });

  it('switching direction replaces; a hard clear survives a later round-clear', () => {
    const flip = withMarks(mark('green', 'sus', 'selfReport'), mark('green', 'clear', 'withMeWholeRound'));
    const ev = ruleManualMarks(flip);
    expect(ev).toHaveLength(1);
    expect(ev[0].weight).toBeLessThan(0);
    const hc = withMarks(mark('white', 'hardClear'), mark('white', 'clear', 'taskBarMoved'));
    expect(hardFacts(hc).certainCrew.has('white')).toBe(true);
    expect(markHistory(hc).get('white')).toHaveLength(2);
  });

  it('a clear reason on a sus mark falls back to the sus default (UI slip)', () => {
    expect(markWeight('sus', 'withMeWholeRound')).toBeCloseTo(0.8);
    expect(markToast('Red', 'sus', 'proximityToBody')).toBe('Red: sus — near the body');
    expect(markObservation('red', 'hardClear', 'sawVisualTask')).toEqual({ type: 'manualMark', player: 'red', mark: 'hardClear' });
  });
});
