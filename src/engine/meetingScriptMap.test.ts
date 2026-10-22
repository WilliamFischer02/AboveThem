import { describe, expect, it } from 'vitest';
import type { Claim, MatchState } from '../types/game';
import { fixture } from './__fixtures__/skeld_match_01';
import { scoreAll } from './suspicion';
import { buildMeetingScript, questionSituation } from './meetingScript';

const claim = (by: string, extra: Partial<Claim>): Claim => ({ id: 'c' + Math.random().toString(36).slice(2, 7), meeting: 0, stamp: { round: 0, t: 60, wall: 0 }, by, type: 'location', ...extra });

describe('meeting script: per-map questions (maps agent question bank)', () => {
  const top = () => scoreAll(fixture).filter(s => s.verdict === 'unknown' || s.verdict === 'softClear')[0].player;

  it('situation: body room + victim from this round, the top suspect\'s claimed room', () => {
    const t = top();
    const m: MatchState = { ...fixture, claims: [claim(t, { room: 'electrical' })] };
    const s = questionSituation(m, 0, t);
    expect(s.bodyRoom).toBe('electrical');
    expect(s.victim).toBe('Yellow');
    expect(s.claimRoom).toBe('electrical');
    expect(s.player).toBe(fixture.players[t].name);
  });

  it('the top suspect claiming Electrical on Skeld adds the map question, aimed at them, with a note; ≤ 4 asks', () => {
    const t = top();
    const m: MatchState = { ...fixture, claims: [claim(t, { room: 'electrical' })] };
    const script = buildMeetingScript(m, scoreAll(m), 0);
    const q = script.ask.find(a => /you said elec/i.test(a.text));
    expect(q).toBeDefined();
    expect(q!.to).toBe(t);
    expect(q!.note).toBeTruthy();
    expect(script.ask.length).toBeLessThanOrEqual(4);
  });

  it('a claimed dummy panel becomes a Watch line (lie note)', () => {
    const t = top();
    const m: MatchState = { ...fixture, claims: [claim(t, { type: 'task', taskId: 'divertPower', room: 'reactor' })] };
    const script = buildMeetingScript(m, scoreAll(m), 0);
    expect(script.watch.some(w => /dummy/i.test(w))).toBe(true);
  });

  it('edge: no claims and a map with no bank → engine questions only, nothing breaks', () => {
    const m: MatchState = { ...fixture, map: { ...fixture.map, id: 'mira' }, claims: [] };
    const script = buildMeetingScript(m, scoreAll(m), 0);
    expect(script.ask.every(a => a.note === undefined || typeof a.note === 'string')).toBe(true);
    expect(script.ask.length).toBeLessThanOrEqual(4);
  });
});
