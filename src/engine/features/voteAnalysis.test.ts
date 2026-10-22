import { describe, it, expect } from 'vitest';
import { voteMatrix, bandwagons, votingPairs, voterRecords, makeVote, meetingVotes } from './voteAnalysis';
import { build, st } from './__fixtures__/build';
import type { Vote } from '../../types/game';

const v = (meeting: number, voter: string, target: Vote['target']): Vote => ({ meeting, voter, target, known: true });

describe('vote matrix', () => {
  it('keeps the last tap per voter and lists who is missing', () => {
    const m = build({ players: 5 });
    m.votes.push(v(0, 'blue', 'red'), v(0, 'blue', 'green'), v(0, 'red', 'green'), v(0, 'green', 'skip'));
    const mx = voteMatrix(m, 0);
    expect(meetingVotes(m, 0).get('blue')).toBe('green');
    expect(mx.tally).toMatchObject({ ejected: 'green', reason: 'plurality' });
    expect(mx.missing.sort()).toEqual(['cyan', 'purple']);
  });
  it('anonymous lobbies produce unknown votes that analysis ignores (edge)', () => {
    const m = build({ settings: { anonymousVotes: true } });
    const vote = makeVote(m, 0, 'blue', 'red');
    expect(vote.known).toBe(false);
    m.votes.push(vote);
    expect(voteMatrix(m, 0).rows).toEqual([]);
  });
});

describe('bandwagons', () => {
  it('flags voters who joined the top target without accusing, stronger when the target was crew', () => {
    const m = build();
    m.claims.push({ id: 'c1', meeting: 0, stamp: st(60), by: 'blue', type: 'accusation', about: 'red' });
    m.votes.push(v(0, 'blue', 'red'), v(0, 'green', 'red'), v(0, 'purple', 'red'), v(0, 'red', 'skip'), v(0, 'white', 'skip'));
    m.ejections.push({ meeting: 0, player: 'red', wasImpostor: false });
    const b = bandwagons(m);
    expect(b.map(x => x.voter).sort()).toEqual(['green', 'purple']);
    expect(b[0].targetWas).toBe('crew');
    expect(b[0].line).toMatch(/they were crew/);
  });
  it('no accusation logged → no bandwagon (edge)', () => {
    const m = build();
    m.votes.push(v(0, 'blue', 'red'), v(0, 'green', 'red'));
    expect(bandwagons(m)).toEqual([]);
  });
});

describe('voting pairs', () => {
  it('finds a pair voting together every meeting and never each other', () => {
    const m = build();
    for (const [mt, t] of [[0, 'white'], [1, 'orange'], [2, 'blue']] as const) m.votes.push(v(mt, 'red', t), v(mt, 'green', t), v(mt, 'purple', 'skip'));
    m.votes.push(v(1, 'blue', 'red'));
    const pairs = votingPairs(m);
    expect(pairs[0]).toMatchObject({ a: 'red', b: 'green', together: [0, 1, 2], neverEachOther: true });
    expect(pairs.find(p => p.a === 'purple' || p.b === 'purple')).toBeUndefined();
  });
});

describe('voter records', () => {
  it('counts hits on revealed impostors and crew', () => {
    const m = build();
    m.votes.push(v(0, 'blue', 'red'), v(0, 'green', 'red'), v(0, 'purple', 'skip'), v(1, 'blue', 'white'), v(1, 'green', 'white'));
    m.ejections.push({ meeting: 0, player: 'red', wasImpostor: true }, { meeting: 1, player: 'white', wasImpostor: false });
    const r = Object.fromEntries(voterRecords(m).map(x => [x.player, x]));
    expect(r.blue).toMatchObject({ votes: 2, hitImpostor: 1, hitCrew: 1, withMajority: 2 });
    expect(r.purple).toMatchObject({ skips: 1 });
  });
});
