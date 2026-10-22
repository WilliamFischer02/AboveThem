import { describe, it, expect } from 'vitest';
import { scoreAll } from './suspicion';
import { SIM_GAMES } from './__fixtures__/sim';

describe('calibration harness (scripted games, answer key never shown to the engine)', () => {
  for (const make of SIM_GAMES) {
    const g = make();
    it(`${g.name}: an impostor still in play ranks top-2 by the last meeting`, () => {
      const scores = scoreAll(g.state);
      const live = g.truth.impostors.filter(p => g.state.players[p].status === 'alive');
      const top2 = scores.filter(s => s.verdict !== 'certainCrew').slice(0, 2).map(s => s.player);
      for (const imp of live) expect(top2, scores.map(s => `${s.player} ${s.probability.toFixed(2)} ${s.summary}`).join('\n')).toContain(imp);
    });
    it(`${g.name}: hard-cleared players never score above 0.2`, () => {
      for (const s of scoreAll(g.state)) if (s.verdict === 'certainCrew' || s.verdict === 'hardClear') expect(s.probability).toBeLessThanOrEqual(0.2);
    });
    it(`${g.name}: probabilities over unresolved players add up to the impostors left`, () => {
      const scores = scoreAll(g.state);
      const unresolved = scores.filter(s => s.verdict !== 'certainCrew' && s.verdict !== 'certainImpostor');
      const knownImp = scores.filter(s => s.verdict === 'certainImpostor').length;
      const left = g.truth.impostors.filter(p => g.state.players[p].status === 'alive').length - knownImp; // impostors still at large
      if (unresolved.length > left && left > 0) expect(unresolved.reduce((a, s) => a + s.probability, 0)).toBeCloseTo(left, 2);
      for (const s of scores) for (const e of s.evidence) expect(e.refs.length).toBeGreaterThan(0);
    });
  }
});
