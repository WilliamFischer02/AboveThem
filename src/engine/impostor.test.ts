import { describe, it, expect } from 'vitest';
import { impostorAdvice, impostorVars, classifyAccusation } from './impostor';
import { scoreAll } from './suspicion';
import { fixture } from './__fixtures__/skeld_match_01';
import type { MatchState } from '../types/game';

// Me = cyan, impostor this time; blue was with me in MedBay; red seen alone; green self-reported.
const m: MatchState = { ...fixture, myRole: 'impostor', players: { ...fixture.players, cyan: { ...fixture.players.cyan, knownRole: 'impostor' } } };

describe('impostor advice', () => {
  it('builds vars from real observations only', () => {
    const v = impostorVars(m, 0);
    expect(v.R).toBe('MedBay');
    expect(v.W).toBe('Blue');
    expect(v.K).toBe('Electrical');
    expect(v.X).toBeDefined(); // red or purple were seen alone
    expect(v.TASK).not.toBe('Submit Scan'); // visual with visuals on — never offered
  });

  it('offers a corroborable alibi first and a push target that is not me', () => {
    const a = impostorAdvice(m, scoreAll(m), 0);
    expect(a.alibis[0].text).toMatch(/MedBay with Blue/);
    expect(a.push?.target).not.toBe('cyan');
    expect(a.defenses[0].type).toBe('where_were_you');
    expect(a.defenses[0].lines[0]).toMatch(/MedBay/);
  });

  it('classifies accusations and answers the one against me', () => {
    const mm: MatchState = { ...m, claims: [{ id: 'q', meeting: 0, stamp: { round: 0, t: 50, wall: 1 }, by: 'red', type: 'accusation', about: 'cyan', text: 'cyan near the body [near body]' }] };
    expect(classifyAccusation(mm.claims[0], mm)).toBe('saw_you_leave_kill_room');
    const a = impostorAdvice(mm, scoreAll(mm), 0);
    expect(a.defenses[0].accuser).toBe('Red');
    expect(a.defenses[0].type).toBe('saw_you_leave_kill_room');
  });

  it('warns when the partner is being pushed', () => {
    const mm: MatchState = { ...m, players: { ...m.players, white: { ...m.players.white, isPartner: true } },
      claims: [{ id: 'q', meeting: 0, stamp: { round: 0, t: 50, wall: 1 }, by: 'red', type: 'accusation', about: 'white' }] };
    const a = impostorAdvice(mm, scoreAll(mm), 0);
    expect(a.partnerWarning).not.toBeNull();
    expect(a.partnerWarning![0]).toMatch(/White/);
    expect(a.push?.target).not.toBe('white');
  });
});
