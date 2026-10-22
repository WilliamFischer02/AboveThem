/** Rules encoded from relay/game-knowledge.md §1.2 and the lie catalogue (§2). */
import { describe, it, expect } from 'vitest';
import { ruleLastSeenWithVictim } from './rules';
import { ruleTaskClaims, ruleLocationClaims } from './contradictions';
import { assertionsToEvidence, chatPlaced, ruleDeadAccuser, ruleProfileTells, visualClearValid } from './chatEvidence';
import type { ChatAssertion, SpeakerProfile } from './chatNluTypes';
import { ruleMutualAlibiPair, impostorPairs } from './pairs';
import { killFeasibility, killWindow, travelLowerBound } from './feasibility';
import { scoreAll, suspectPairs } from './suspicion';
import { fixture } from './__fixtures__/skeld_match_01';
import { fixture2 } from './__fixtures__/skeld_match_02_two_imp';
import { fixture3 } from './__fixtures__/skeld_match_03_insufficient';
import type { BodyFoundObs, Claim, MapData, MatchState, Observation } from '../types/game';

const A = (speaker: string, kind: ChatAssertion['kind'], about: string[], o: Partial<ChatAssertion> = {}): ChatAssertion => ({
  id: `${speaker}-${kind}-${about.join()}`, line: `L-${speaker}-${about.join()}`, meeting: 0, speaker, kind, about, polarity: kind === 'accuse' ? 1 : -1,
  strength: 1, confidence: 1, text: '', span: [0, 0], quote: '', resolvedVia: 'direct', refs: [`L-${speaker}`], why: [], ...o,
});
const st = (round: number, t: number, wall = t) => ({ round, t, wall });

describe('two_together_one_dies', () => {
  it('alone with the victim inside the kill window is much stronger than "last seen with"', () => {
    const m: MatchState = { ...fixture3, observations: [...fixture3.observations,
      { id: 'p1', type: 'sighting', stamp: st(0, 40), source: 'me', confidence: 0.95, player: 'purple', room: 'storage', withPlayers: ['yellow'] },
    ] as Observation[] };
    const e = ruleLastSeenWithVictim(m).find(x => x.player === 'purple')!;
    expect(e.weight).toBeCloseTo(1.6);
    expect(e.label).toMatch(/^Alone with Yellow/);
    // In a group of three, or before the window: the old, mild version.
    const group: MatchState = { ...m, observations: m.observations.map(o => o.id === 'p1' ? { ...o, withPlayers: ['yellow', 'white'] } as Observation : o) };
    expect(ruleLastSeenWithVictim(group).find(x => x.player === 'purple')?.weight).toBeCloseTo(0.7);
  });
});

describe('visual clears must be valid on this map / lobby', () => {
  it('visual_off_clear and visual_wrong_map', () => {
    const scan = A('blue', 'clear', ['green'], { reason: 'scan', taskId: 'submitScan' });
    expect(visualClearValid(fixture3, scan)).toBe(true);
    expect(visualClearValid({ ...fixture3, settings: { ...fixture3.settings, visualTasksOn: false } }, scan)).toBe(false);
    expect(visualClearValid(fixture3, { ...scan, taskId: 'fixWiring' })).toBe(false); // not visual
    const ctx = { credibility: () => ({ cred: 1, status: 'normal' as const }), certainCrew: new Set<string>(), unknownImpostorsLeft: 1 };
    const on = assertionsToEvidence(fixture3, [scan], ctx)[0].weight;
    const off = assertionsToEvidence({ ...fixture3, settings: { ...fixture3.settings, visualTasksOn: false } }, [scan], ctx)[0].weight;
    expect(on).toBeLessThan(off); // both clears, the invalid one weaker
    expect(off).toBeLessThan(0);
  });
});

describe('task_not_on_map', () => {
  it('a task id that does not exist on this map is flagged (not hard)', () => {
    const m: MatchState = { ...fixture3, claims: [{ id: 'tc', meeting: 0, stamp: st(0, 55), by: 'blue', type: 'task', taskId: 'repairDrill' }] };
    const e = ruleTaskClaims(m);
    expect(e).toHaveLength(1);
    expect(e[0].label).toMatch(/no such task/);
    expect(e[0].weight).toBeLessThan(2);
  });
});

describe('travel slack (eyeballed map seconds)', () => {
  it('impossible-travel verdicts need 30 % / 3 s slack; unknown rooms never convict', () => {
    expect(travelLowerBound(20)).toBeCloseTo(14);
    expect(travelLowerBound(5)).toBe(2);
    expect(travelLowerBound(Infinity)).toBe(0);
    const m: MatchState = { ...fixture2, claims: [{ id: 'u', meeting: 1, stamp: st(1, 40), by: 'green', type: 'location', room: 'notARoom', timeWindow: [35, 45] }] };
    expect(ruleLocationClaims(m)).toHaveLength(0);
  });
  it('a stub map makes feasibility stand down', () => {
    const stub: MatchState = { ...fixture, map: { ...fixture.map, rooms: [], vents: [] } as MapData };
    const body = fixture.observations.find(o => o.type === 'bodyFound') as BodyFoundObs;
    expect(killFeasibility(stub, 'red', body).feasible).toBe('unknown');
  });
});

describe('pairs (2+ impostors)', () => {
  const two: MatchState = { ...fixture3, settings: { ...fixture3.settings, impostorCount: 2 } };
  const comp = (id: string, round: number, by: string, about: string): Claim => ({ id, meeting: round, stamp: st(round, 50, round * 100 + id.length), by, type: 'companion', about });
  it('mutual_pair: alibi only each other in 2 rounds, nobody else saw them', () => {
    const m: MatchState = { ...two, claims: [comp('a1', 0, 'blue', 'white'), comp('a2', 0, 'white', 'blue'), comp('a3', 1, 'blue', 'white'), comp('a4', 1, 'white', 'blue')] };
    expect(ruleMutualAlibiPair(m).map(e => e.player).sort()).toEqual(['blue', 'white']);
    expect(ruleMutualAlibiPair({ ...m, claims: m.claims.slice(0, 2) })).toHaveLength(0);
    expect(ruleMutualAlibiPair({ ...m, settings: fixture3.settings })).toHaveLength(0);
    // I saw Blue with someone else in round 1 → that round is not "only each other".
    const seen: MatchState = { ...m, observations: [...m.observations, { id: 'w', type: 'withMe', stamp: st(1, 10), source: 'me', confidence: 0.95, player: 'blue', room: 'cafeteria', on: true }] as Observation[] };
    expect(ruleMutualAlibiPair(seen)).toHaveLength(0);
  });
  it('impostorPairs ranks a pair that vouches both ways and alibis only each other', () => {
    const m: MatchState = { ...two, claims: [comp('a1', 0, 'blue', 'white'), comp('a2', 0, 'white', 'blue')] };
    const pairs = impostorPairs(m, [A('blue', 'clear', ['white']), A('white', 'defense', ['blue'])]);
    expect(pairs[0]).toMatchObject({ a: 'blue', b: 'white' });
    expect(pairs[0].reasons.join()).toMatch(/vouch for each other/);
    expect(impostorPairs({ ...m, settings: fixture3.settings })).toHaveLength(0);
    expect(Array.isArray(suspectPairs(m))).toBe(true);
  });
});

describe('dead_accuser and chat-nlu profile tells', () => {
  it('the accuser dying the next round is a small mark on the accused', () => {
    const e = ruleDeadAccuser(fixture3, [A('white', 'accuse', ['green'])], p => (p === 'white' ? 1 : undefined));
    expect(e).toHaveLength(1);
    expect(e[0].player).toBe('green');
    expect(e[0].weight).toBeCloseTo(0.25);
    expect(ruleDeadAccuser(fixture3, [A('white', 'accuse', ['green'])], () => 3)).toHaveLength(0);
  });
  it('location changes and same-meeting flips from SpeakerProfile', () => {
    const prof: SpeakerProfile = {
      player: 'blue', lines: 4, assertions: 4, accusations: 1, accused: ['green'], clears: 1, cleared: ['green'], selfDefenses: 0, questions: 0,
      voteCalls: 0, skipCalls: 0, accusedBy: [], clearedBy: [], firstAccusations: 1, bandwagons: 0,
      flips: [{ target: 'green', from: 1, to: -1, fromAssertion: 'x1', toAssertion: 'x2', fromMeeting: 0, toMeeting: 0, sameMeeting: true }],
      locationChanges: [{ meeting: 0, rooms: ['admin', 'electrical'], assertions: ['y1', 'y2'] }], consistency: 0.5, refs: [],
    };
    const e = ruleProfileTells(fixture3, { blue: prof, ghost: { ...prof, player: 'ghost' } });
    expect(e.map(x => x.label)).toEqual(['Said Admin, then Electrical in meeting 1', 'Flipped on Green within meeting 1']);
  });
});

describe('vitals_timing', () => {
  it('a vitals read with the victim still OK narrows the kill window, so a later companion clears', () => {
    const withMe: Observation = { id: 'wm', type: 'withMe', stamp: st(0, 35), source: 'me', confidence: 0.95, player: 'purple', room: 'cafeteria', on: true };
    const before: MatchState = { ...fixture3, observations: [...fixture3.observations, withMe] };
    const body = fixture3.observations.find(o => o.type === 'bodyFound') as BodyFoundObs; // Yellow, Storage, 0:55
    expect(scoreAll(before).find(s => s.player === 'purple')!.verdict).not.toBe('certainCrew');
    const vitals = { id: 'vit', type: 'vitalsRead', stamp: st(0, 40), source: 'me', confidence: 1, alive: ['yellow', 'purple'], dead: [] } as unknown as Observation;
    const after: MatchState = { ...before, observations: [...before.observations, vitals] };
    expect(killWindow(after, body)).toEqual([40, 55]);
    const p = scoreAll(after).find(s => s.player === 'purple')!;
    expect(p.verdict).toBe('certainCrew'); // 1-impostor lobby, with me through [0:40, 0:55]
    expect(p.evidence[0].refs).toContain('vit');
    const ded = { ...vitals, id: 'v2', stamp: st(0, 50), alive: [], dead: ['yellow'] } as unknown as Observation;
    expect(killWindow({ ...after, observations: [...after.observations, ded] }, body)).toEqual([40, 50]);
  });
});

describe('chat facts checked against what I logged', () => {
  const ctx = { credibility: () => ({ cred: 1, status: 'normal' as const }), certainCrew: new Set<string>(), unknownImpostorsLeft: 1 };
  it('"X was near <body room>" is a reasoned accusation, merged with the same speaker\'s "X sus"', () => {
    const ev = assertionsToEvidence(fixture3, [
      A('white', 'accuse', ['purple'], { reason: 'sus', strength: 0.5 }),
      A('white', 'sighting', ['purple'], { polarity: 0, room: 'storage' }), // fixture3 body: Storage
    ], ctx);
    expect(ev).toHaveLength(1);
    expect(ev[0].label).toMatch(/saw them near the body/);
    expect(ev[0].weight).toBeCloseTo(0.8);
    expect(assertionsToEvidence(fixture3, [A('white', 'sighting', ['purple'], { polarity: 0, room: 'admin' })], ctx)).toHaveLength(0);
  });
  it('calling a group find a "self-report" implicates the caller, not the reporter', () => {
    const ev = assertionsToEvidence(fixture3, [A('purple', 'selfReport', ['green'], { polarity: 1 })], ctx); // Green found it with Blue and White
    expect(ev).toHaveLength(1);
    expect(ev[0].player).toBe('purple');
    expect(ev[0].label).toMatch(/Blue and White were there/);
  });
  it('chat placements count for the unaccounted rules', () => {
    expect([...chatPlaced([A('purple', 'location', ['purple'], { polarity: 0 }), A('white', 'withMe', ['blue'])], 0)].sort()).toEqual(['blue', 'purple', 'white']);
  });
});

describe('end to end still sane', () => {
  it('fixture 01 keeps Blue certain crew (visual task)', () => {
    const s = Object.fromEntries(scoreAll(fixture).map(x => [x.player, x]));
    expect(s.blue.verdict).toBe('certainCrew'); // visual task
  });
});
