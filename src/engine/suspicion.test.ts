import { describe, it, expect } from 'vitest';
import { scoreAll, hardFacts } from './suspicion';
import { buildMeetingScript } from './meetingScript';
import { walkSeconds, ventConnected } from './map';
import { fixture } from './__fixtures__/skeld_match_01';

describe('map geometry', () => {
  it('computes walking time between rooms', () => {
    expect(walkSeconds(fixture.map, 'medbay', 'medbay')).toBe(0);
    expect(walkSeconds(fixture.map, 'navigation', 'electrical')).toBeGreaterThan(10);
  });
  it('knows vent connectivity', () => {
    expect(ventConnected(fixture.map, 'medbay', 'electrical')).toBe(true);
    expect(ventConnected(fixture.map, 'navigation', 'electrical')).toBe(false);
  });
});

describe('hard facts', () => {
  it('hard-clears a player whose visual task was seen', () => {
    const hf = hardFacts(fixture);
    expect(hf.certainCrew.has('blue')).toBe(true);
  });
  it('clears a continuous companion for the kill window', () => {
    const hf = hardFacts(fixture);
    expect(hf.clearedForKill.get('o6')?.has('blue')).toBe(true);
    expect(hf.clearedForKill.get('o6')?.has('red')).toBe(false);
  });
});

describe('scoring', () => {
  it('ranks the self-reporter and the lone wanderer above the far-away player', () => {
    const scores = scoreAll(fixture);
    const byId = Object.fromEntries(scores.map(s => [s.player, s]));
    expect(byId.blue.verdict).toBe('certainCrew');
    expect(byId.green.logOdds).toBeGreaterThan(byId.purple.logOdds);
    expect(byId.red.logOdds).toBeGreaterThan(byId.purple.logOdds);
    for (const s of scores) for (const e of s.evidence) expect(e.refs.length).toBeGreaterThan(0); // traceable
  });
});

describe('meeting script', () => {
  it('leads with a hard clear and asks the self-reporter a question', () => {
    const script = buildMeetingScript(fixture, scoreAll(fixture), 0);
    expect(script.say.some(s => /Blue is clear/.test(s.text))).toBe(true);
    expect(script.ask.some(q => q.to === 'green')).toBe(true);
    expect(script.headline).toMatch(/Prime suspect/);
    expect(['skip', 'green', 'red']).toContain(script.vote.target);
  });
});
