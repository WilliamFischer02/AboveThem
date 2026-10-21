import { describe, it, expect } from 'vitest';
import { scoreAll, hardFacts } from './suspicion';
import { buildMeetingScript } from './meetingScript';
import { buildAlibiGraph, killWindowClears, contradictsTogether } from './alibi';
import { ruleLocationClaims, ruleCompanionClaims, ruleTaskClaims, ruleAccusations, ruleEjectionFeedback, ruleStoryChanged, ruleCommonTaskClaims, verifyClaims } from './contradictions';
import { ruleLastSeenWithVictim, ruleUnaccounted, ruleTaskObservations, ruleProximityToKill } from './rules';
import { fixture } from './__fixtures__/skeld_match_01';
import { fixture2 } from './__fixtures__/skeld_match_02_two_imp';
import { fixture3 } from './__fixtures__/skeld_match_03_insufficient';
import type { MatchState } from '../types/game';

const byId = (m: MatchState) => Object.fromEntries(scoreAll(m).map(s => [s.player, s]));

describe('alibi graph', () => {
  it('builds trusted edges from with-me toggles and clears across the kill window', () => {
    const edges = buildAlibiGraph(fixture);
    expect(edges.some(e => e.a === 'cyan' && e.b === 'blue' && e.status === 'trusted')).toBe(true);
    const clears = killWindowClears(edges, new Set(['cyan']), 0, 5, 50);
    expect(clears.map(c => c.player)).toEqual(['blue']);
  });

  it('confirms mirrored companion claims and contradicts impossible ones', () => {
    const edges = buildAlibiGraph(fixture2);
    const pb = edges.find(e => e.claimIds?.includes('c2'));
    expect(pb?.status).toBe('confirmed');
    expect(contradictsTogether(fixture2, 'green', 'yellow', 'admin', 1, 35, 45)).toBe('o3');
  });

  it('chains one hop through a confirmed edge', () => {
    const m: MatchState = {
      ...fixture,
      claims: [
        { id: 'k1', meeting: 0, stamp: { round: 0, t: 50, wall: 1 }, by: 'blue', type: 'companion', about: 'white', timeWindow: [0, 50] },
        { id: 'k2', meeting: 0, stamp: { round: 0, t: 50, wall: 2 }, by: 'white', type: 'companion', about: 'blue', timeWindow: [0, 50] },
      ],
    };
    const clears = killWindowClears(buildAlibiGraph(m), new Set(['cyan']), 0, 5, 50);
    expect(clears.find(c => c.player === 'white')?.hops).toBe(2);
    expect(hardFacts(m).clearedForKill.get('o6')?.has('white')).toBe(true);
  });
});

describe('claim rules', () => {
  it('flags a location claim contradicted by my own sighting', () => {
    const ev = ruleLocationClaims(fixture2);
    expect(ev.some(e => e.player === 'green' && e.weight > 1.5 && e.kind === 'contradiction')).toBe(true);
    expect(verifyClaims(fixture2).get('c1')).toBe('contradicted');
  });
  it('rewards mutually confirmed companions', () => {
    const ev = ruleCompanionClaims(fixture2);
    expect(ev.filter(e => e.weight < 0).map(e => e.player).sort()).toEqual(['blue', 'purple']);
    expect(verifyClaims(fixture2).get('c2')).toBe('confirmed');
  });
  it('flags a task that does not exist in the claimed room', () => {
    const ev = ruleTaskClaims(fixture2);
    expect(ev.some(e => e.player === 'black' && e.kind === 'task_not_in_room' && e.weight >= 2)).toBe(true);
  });
  it('flags a common task I do not have, only when my list is known', () => {
    expect(ruleCommonTaskClaims(fixture2)).toHaveLength(0);
    const m: MatchState = { ...fixture2, myTasks: [{ id: 'fixWiring', name: 'Fix Wiring', matched: true }, { id: 'chartCourse', name: 'Chart Course', matched: true }] };
    const ev = ruleCommonTaskClaims(m); // Black claimed Swipe Card (common) — not on my list
    expect(ev.some(e => e.player === 'black' && e.weight === 2.5 && e.kind === 'common_task_claim')).toBe(true);
  });

  it('distinguishes a baseless accusation from a bandwagon', () => {
    const ev = ruleAccusations(fixture2);
    expect(ev.find(e => e.player === 'black')?.weight).toBeCloseTo(0.4);
    expect(ev.find(e => e.player === 'white')?.weight).toBeCloseTo(0.3);
  });
  it('re-weights after a confirmed ejection', () => {
    const m: MatchState = {
      ...fixture2,
      votes: [{ meeting: 0, voter: 'blue', target: 'red', known: true }, { meeting: 0, voter: 'green', target: 'skip', known: true }],
      claims: [...fixture2.claims, { id: 'c7', meeting: 0, stamp: { round: 0, t: 60, wall: 5 }, by: 'yellow', type: 'clear', about: 'red' }],
    };
    const ev = ruleEjectionFeedback(m);
    expect(ev.find(e => e.player === 'blue')?.weight).toBeCloseTo(-0.6);
    expect(ev.find(e => e.player === 'yellow')?.kind).toBe('pair_tell');
  });
  it('catches a story change between two incompatible location claims', () => {
    const m: MatchState = {
      ...fixture3,
      claims: [
        { id: 'a', meeting: 0, stamp: { round: 0, t: 55, wall: 1 }, by: 'blue', type: 'location', room: 'navigation', timeWindow: [40, 50] },
        { id: 'b', meeting: 1, stamp: { round: 0, t: 55, wall: 2 }, by: 'blue', type: 'location', room: 'electrical', timeWindow: [45, 52] },
      ],
    };
    expect(ruleStoryChanged(m).some(e => e.player === 'blue' && e.weight === 1.5)).toBe(true);
  });
});

describe('observation rules', () => {
  it('finds the last player seen with the victim', () => {
    const ev = ruleLastSeenWithVictim(fixture2);
    expect(ev).toHaveLength(1);
    expect(ev[0].player).toBe('green');
    expect(ev[0].kind).toBe('last_seen_with_victim');
  });
  it('flags players nobody vouched for in a round with a kill', () => {
    const ev = ruleUnaccounted(fixture2);
    expect(ev.map(e => e.player)).toEqual(['yellow']);
  });
  it('scores task-bar and duration mismatches only when they apply', () => {
    const m: MatchState = {
      ...fixture3,
      observations: [...fixture3.observations,
        { id: 't1', type: 'sawTask', stamp: { round: 0, t: 20, wall: 1 }, source: 'me', confidence: 0.95, player: 'blue', room: 'admin', taskId: 'swipeCard', visualConfirmed: false, durationSec: 15, taskBarMoved: false },
        { id: 't2', type: 'sawTask', stamp: { round: 0, t: 30, wall: 2 }, source: 'me', confidence: 0.95, player: 'white', room: 'weapons', taskId: 'clearAsteroids', visualConfirmed: false },
      ],
    };
    const ev = ruleTaskObservations(m);
    expect(ev.filter(e => e.player === 'blue').map(e => e.weight).sort()).toEqual([0.5, 1.0]);
    expect(ev.find(e => e.player === 'white')?.weight).toBe(3.0); // visual task with no animation
  });
  it('keeps the original proximity rule behaviour', () => {
    const ev = ruleProximityToKill(fixture);
    expect(ev.some(e => e.player === 'red')).toBe(true);
    expect(ev.some(e => e.player === 'purple')).toBe(false);
  });
});

describe('scoring end-to-end', () => {
  it('fixture 02: contradicted Green is the prime suspect, confirmed companions sink, Red is out', () => {
    const s = byId(fixture2);
    expect(s.red).toBeUndefined(); // ejected players are not scored
    const order = scoreAll(fixture2).map(x => x.player);
    expect(order[0]).toBe('green');
    expect(s.purple.logOdds).toBeLessThan(s.yellow.logOdds);
    expect(s.blue.logOdds).toBeLessThan(s.yellow.logOdds);
    for (const x of scoreAll(fixture2)) for (const e of x.evidence) expect(e.refs.length).toBeGreaterThan(0);
  });
  it('counting: when all remaining impostors are known, everyone else is certain crew', () => {
    const m: MatchState = { ...fixture2, observations: [...fixture2.observations, { id: 'v', type: 'sawVent', stamp: { round: 1, t: 30, wall: 1 }, source: 'me', confidence: 0.95, player: 'black', room: 'admin' }] };
    const s = byId(m);
    expect(s.black.verdict).toBe('certainImpostor');
    expect(s.green.verdict).toBe('certainCrew');
    expect(s.yellow.verdict).toBe('certainCrew');
  });
});

describe('meeting script v2', () => {
  it('fixture 02: asks Green about the contradiction and recommends voting Green', () => {
    const script = buildMeetingScript(fixture2, scoreAll(fixture2), 1);
    expect(script.ask[0].to).toBe('green');
    expect(script.ask[0].text).toMatch(/Admin|Navigation/);
    expect(script.vote.target).toBe('green');
    expect(script.insufficientInfo).toBe(false);
    for (const q of script.ask) expect(q.text.length).toBeLessThanOrEqual(140);
  });
  it('fixture 03: says insufficient info and skips', () => {
    const script = buildMeetingScript(fixture3, scoreAll(fixture3), 0);
    expect(script.insufficientInfo).toBe(true);
    expect(script.vote.target).toBe('skip');
    expect(script.say.some(s => /Skip and stack/.test(s.text))).toBe(true);
  });
  it('endgame: two left framing when crew ≤ impostors + 1', () => {
    const m: MatchState = {
      ...fixture3,
      players: { ...fixture3.players, white: { ...fixture3.players.white, status: 'dead' }, purple: { ...fixture3.players.purple, status: 'dead' } },
    }; // alive: cyan, blue, green (crew 2 vs 1 imp)
    const script = buildMeetingScript(m, scoreAll(m), 1);
    expect(script.say[0].text).toMatch(/Hard clears only|Count:/);
    expect(script.vote.target).not.toBe('skip');
  });
});
