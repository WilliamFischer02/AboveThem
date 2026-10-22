import { describe, it, expect } from 'vitest';
import { meetingMath, impostorBounds, tally } from './meetingMath';
import { build } from './__fixtures__/build';

const meetingAt = (m: ReturnType<typeof build>) => { m.phase = { phase: 'meetingDiscussion', wall: 0, round: 1, meeting: 1 }; return m; };

describe('impostor bounds', () => {
  it('counts confirmed ejections and the "N remain" text', () => {
    const m = meetingAt(build({ players: 10 }));
    expect(impostorBounds(m)).toMatchObject({ min: 2, max: 2 });
    m.ejections.push({ meeting: 0, player: 'red', wasImpostor: true });
    m.players.red.status = 'ejected';
    expect(impostorBounds(m)).toMatchObject({ min: 1, max: 1 });
  });
  it('confirm ejects off widens the range; a running game caps it (edge)', () => {
    const m = meetingAt(build({ players: 5, settings: { confirmEjectsOn: false } }));
    m.ejections.push({ meeting: 0, player: 'blue', wasImpostor: null });
    m.players.blue.status = 'ejected';
    // 4 alive and the game is still running ⇒ at most 1 impostor (2 would already have won).
    const b = impostorBounds(m);
    expect(b.max).toBe(1);
    expect(b.min).toBe(1);
    expect(b.why.join(' ')).toMatch(/still running/);
  });
});

describe('meeting math', () => {
  it('7 alive, 2 impostors: careful but not critical', () => {
    const m = meetingAt(build({ players: 9, dead: ['purple', 'yellow'] }));
    const r = meetingMath(m);
    expect(r.alive).toBe(7);
    expect(r.crewAlive).toBe(5);
    expect(r.crewDeathsToLoss).toBe(3);
    expect(r.wrongVoteLoses).toBe(false);
    expect(r.guaranteedEject).toBe(4);
    expect(r.ejectionsNeeded).toBe(2);
  });
  it('5 alive with 2 impostors is critical: a wrong vote loses', () => {
    const m = meetingAt(build({ players: 7, dead: ['purple', 'yellow'] }));
    const r = meetingMath(m);
    expect(r.alive).toBe(5);
    expect(r.wrongVoteLoses).toBe(true);
    expect(r.danger).toBe('critical');
    expect(r.lines.join('\n')).toMatch(/CRITICAL/);
  });
  it('3 alive, 1 impostor: critical, and the right vote wins', () => {
    const m = meetingAt(build({ players: 5, dead: ['purple', 'green'], settings: { impostorCount: 1 } }));
    const r = meetingMath(m);
    expect(r.alive).toBe(3);
    expect(r.wrongVoteLoses).toBe(true);
    expect(r.rightVoteWins).toBe(true);
  });
  it('4 alive, 1 impostor: a skip is survivable (one kill → 2v1 meeting)', () => {
    const m = meetingAt(build({ players: 4, settings: { impostorCount: 1 } }));
    const r = meetingMath(m);
    expect(r.skipThenOneKillLoses).toBe(false);
    expect(r.crewDeathsToLoss).toBe(2);
  });
});

describe('tally (plurality)', () => {
  it('most votes is ejected', () => {
    expect(tally([{ voter: 'a', target: 'red' }, { voter: 'b', target: 'red' }, { voter: 'c', target: 'blue' }])).toMatchObject({ ejected: 'red', reason: 'plurality' });
  });
  it('tie for the top ejects nobody', () => {
    expect(tally([{ voter: 'a', target: 'red' }, { voter: 'b', target: 'blue' }])).toMatchObject({ ejected: null, reason: 'tie' });
  });
  it('skip equal to the top ejects nobody (edge)', () => {
    expect(tally([{ voter: 'a', target: 'red' }, { voter: 'b', target: 'skip' }, { voter: 'c', target: 'none' }])).toMatchObject({ ejected: null, reason: 'skip' });
  });
  it('a later vote by the same voter replaces the earlier one', () => {
    expect(tally([{ voter: 'a', target: 'red' }, { voter: 'a', target: 'blue' }, { voter: 'b', target: 'blue' }])).toMatchObject({ ejected: 'blue' });
  });
});
