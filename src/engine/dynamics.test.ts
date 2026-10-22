import { describe, it, expect } from 'vitest';
import { scoreAll, topReasons, decayFactor, countOffset } from './suspicion';
import { assertionsToEvidence, claimsToAssertions, speakerCredibility, ruleSilentInMeeting, type ChatEvidenceContext } from './chatEvidence';
import type { ChatAssertion } from './chatNluTypes';
import { killFeasibility, killWindow, ventAssistedSeconds } from './feasibility';
import { ruleRepeatedCrewEjections, ruleSkipWhenImpostorFound, ruleMinorityVoteBloc, ruleSkipOnCriticalVote } from './voting';
import { snapshotAtMeeting, completedMeetings, currentMeeting, aliveAtMeeting } from './history';
import { ruleUnaccounted } from './rules';
import { reduce } from '../state/events';
import { fixture } from './__fixtures__/skeld_match_01';
import { fixture2 } from './__fixtures__/skeld_match_02_two_imp';
import { fixture3 } from './__fixtures__/skeld_match_03_insufficient';
import { gameB } from './__fixtures__/sim';
import type { BodyFoundObs, MatchState, Observation } from '../types/game';

const by = (m: MatchState) => Object.fromEntries(scoreAll(m).map(s => [s.player, s]));

let k = 0;
const A = (speaker: string, kind: ChatAssertion['kind'], about: string[], o: Partial<ChatAssertion> = {}): ChatAssertion => ({
  id: `a${++k}`, line: `l${k}`, meeting: 0, speaker, kind, about, polarity: kind === 'accuse' || kind === 'sawVent' || kind === 'sawKill' || kind === 'voteCall' ? 1 : -1,
  strength: 1, confidence: 1, text: '', span: [0, 0], quote: '', resolvedVia: 'direct', refs: [`l${k}`], why: [], ...o,
});
const ctx = (over: Partial<ChatEvidenceContext> = {}): ChatEvidenceContext => ({
  credibility: () => ({ cred: 1, status: 'normal' }), certainCrew: new Set(), unknownImpostorsLeft: 1, ...over,
});

describe('chat evidence (ChatAssertion contract v1)', () => {
  it('stacks independent accusers with diminishing returns; one speaker counts once', () => {
    const ev = assertionsToEvidence(fixture3, [A('blue', 'accuse', ['green']), A('blue', 'accuse', ['green']), A('white', 'accuse', ['green']), A('purple', 'accuse', ['green'])], ctx());
    const w = ev.filter(e => e.player === 'green').map(e => e.weight).sort((a, b) => b - a);
    expect(w).toHaveLength(3);
    expect(w[1]).toBeLessThan(w[0]);
    const total = w.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(3 * w[0]); // diminishing
    expect(total).toBeGreaterThan(w[0]);  // but still converging
  });

  it("a suspected accuser counts less, a hard-cleared one more; a known impostor's accusation is a mild clear", () => {
    const cred = (p: string) => p === 'blue' ? speakerCredibility('certainCrew', 0, 0.25) : p === 'white' ? speakerCredibility('unknown', 0.9, 0.25) : speakerCredibility('certainImpostor', 1, 0.25);
    const ev = assertionsToEvidence(fixture3, [A('blue', 'accuse', ['green']), A('white', 'accuse', ['purple']), A('purple', 'accuse', ['white'])], ctx({ credibility: cred }));
    const g = ev.find(e => e.player === 'green')!, p = ev.find(e => e.player === 'purple')!, w = ev.find(e => e.player === 'white')!;
    expect(g.weight).toBeGreaterThan(p.weight * 2);
    expect(g.label).toMatch(/confirmed crew/);
    expect(w.weight).toBeLessThan(0);
  });

  it('stacked independent clears approach (but do not reach) a hard clear', () => {
    const ev = assertionsToEvidence(fixture3, ['blue', 'white', 'purple', 'green'].filter(p => p !== 'green').map(p => A(p, 'clear', ['green'], { reason: 'visual' })), ctx());
    const total = ev.filter(e => e.player === 'green').reduce((a, e) => a + e.weight, 0);
    expect(total).toBeLessThan(-2);
    expect(total).toBeGreaterThan(-4);
  });

  it('an eyewitness lie about confirmed crew implicates the speaker; a suspected voucher is a pair hint', () => {
    const ev = assertionsToEvidence(fixture3, [A('white', 'sawVent', ['blue'])], ctx({ certainCrew: new Set(['blue']) }));
    expect(ev).toHaveLength(1);
    expect(ev[0].player).toBe('white');
    expect(ev[0].kind).toBe('contradiction');
    const pair = assertionsToEvidence(fixture3, [A('white', 'clear', ['green'])], ctx({ unknownImpostorsLeft: 2, credibility: () => ({ cred: 0.3, status: 'suspect' }) }));
    expect(pair.some(e => e.player === 'green' && e.kind === 'pair_tell' && e.weight > 0)).toBe(true);
  });

  it('ignores superseded / info-only assertions, my own words and junk speakers', () => {
    const ev = assertionsToEvidence(fixture3, [
      A('blue', 'accuse', ['green'], { supersededBy: 'x' }), A('cyan', 'accuse', ['green']), A('ghostcard', 'accuse', ['green']),
      A('blue', 'location', ['blue'], { polarity: 0 }), A('blue', 'defense', ['blue']),
    ], ctx());
    expect(ev).toHaveLength(0);
  });

  it('claims adapter: chat lines the NLU already read are skipped (no double count)', () => {
    const m: MatchState = { ...fixture3, claims: [
      { id: 'c1', meeting: 0, stamp: { round: 0, t: 60, wall: 1 }, by: 'blue', type: 'accusation', about: 'green', chatLineId: 'L1' },
      { id: 'c2', meeting: 0, stamp: { round: 0, t: 60, wall: 2 }, by: 'white', type: 'accusation', about: 'green', text: 'green vented [vent]' },
    ] };
    expect(claimsToAssertions(m).map(a => a.id)).toEqual(['c1', 'c2']);
    expect(claimsToAssertions(m, new Set(['L1'])).map(a => a.id)).toEqual(['c2']);
    expect(claimsToAssertions(m)[1].reason).toBe('vent');
  });

  it('silence: only judged when chat was captured and others talked', () => {
    const chat = (senders: string[]) => senders.map((s, i) => ({ id: `ch${i}`, meeting: 0, stamp: { round: 0, t: 60, wall: i }, sender: s, original: 'x', source: 'ocr' as const }));
    const m: MatchState = { ...fixture3, chat: chat(['blue', 'white', 'green', 'white']), ejections: [{ meeting: 0, player: null, wasImpostor: null }] };
    const ev = ruleSilentInMeeting(m, (p, k2) => aliveAtMeeting(m, p, k2));
    expect(ev.map(e => e.player)).toEqual(['purple']); // the one quiet player among four
    // Half the lobby "silent" = the capture missed lines, not evidence (base-rate gate from real logs).
    const patchy: MatchState = { ...m, chat: chat(['blue', 'white', 'blue', 'white']) };
    expect(ruleSilentInMeeting(patchy, (p, k2) => aliveAtMeeting(patchy, p, k2))).toHaveLength(0);
    expect(ruleSilentInMeeting(fixture3, () => true)).toHaveLength(0); // no chat → fail soft
  });
});

describe('base-rate gates (from real logs)', () => {
  it('"nobody vouches" only when it is a minority of the lobby', () => {
    expect(ruleUnaccounted(fixture3).map(e => e.player)).toEqual(['purple']);
    const bare: MatchState = { ...fixture3, observations: [fixture3.observations[0], { ...fixture3.observations[1], reporter: 'cyan', present: [] } as Observation] };
    expect(ruleUnaccounted(bare)).toHaveLength(0); // I logged nothing: everyone "unaccounted" says nothing
  });
});

describe('kill feasibility', () => {
  const body = fixture.observations.find(o => o.type === 'bodyFound') as BodyFoundObs;
  it('kill window starts no earlier than the cooldown allows', () => {
    expect(killWindow(fixture, body)).toEqual([7, 50]);
    expect(killWindow({ ...fixture, settings: { ...fixture.settings, killCooldownSec: 45 } }, { ...body, stamp: { ...body.stamp, round: 2 } })[0]).toBe(42);
  });
  it('vents shorten travel', () => {
    expect(ventAssistedSeconds(fixture.map, 'medbay', 'electrical')).toBeLessThan(5);
  });
  it('a player seen far away right before the report could not have done it; unknown when unseen', () => {
    const m: MatchState = { ...fixture, observations: [...fixture.observations,
      // Watched in Navigation every ~10 s through the whole window: not even a vent run fits.
      ...[10, 20, 30, 40, 48].map((t, i) => ({ id: `s${i + 1}`, type: 'sighting', stamp: { round: 0, t, wall: i }, source: 'me', confidence: 0.95, player: 'orange', room: 'navigation', alone: true })),
    ] as Observation[] };
    const f = killFeasibility(m, 'orange', body);
    expect(f.feasible).toBe('no');
    expect(f.refs).toContain('s2');
    // Seen only every 18 s: a vent run (Nav→Shields→Cafeteria→MedBay→Electrical) fits between sightings.
    const sparse: MatchState = { ...m, observations: m.observations.filter(o => !['s2', 's4'].includes(o.id)) };
    expect(killFeasibility(sparse, 'orange', body).feasible).toBe('ventOnly');
    expect(killFeasibility(m, 'white', body).feasible).toBe('unknown');
    expect(killFeasibility(m, 'red', body).feasible).toBe('yes'); // Storage → Electrical is next door
    expect(by(m).orange.evidence.some(e => e.weight < 0 && /could not reach/.test(e.label))).toBe(true);
  });
});

describe('voting behaviour', () => {
  const base: MatchState = { ...fixture3, settings: { ...fixture3.settings, impostorCount: 2 } };
  it('repeatedly voting out crew, skipping when the impostor was found', () => {
    const m: MatchState = { ...base,
      votes: [
        { meeting: 0, voter: 'blue', target: 'white', known: true }, { meeting: 1, voter: 'blue', target: 'purple', known: true },
        { meeting: 2, voter: 'green', target: 'skip', known: true }, { meeting: 2, voter: 'blue', target: 'yellow', known: true },
      ],
      ejections: [{ meeting: 0, player: 'white', wasImpostor: false }, { meeting: 1, player: 'purple', wasImpostor: false }, { meeting: 2, player: 'yellow', wasImpostor: true }],
    };
    expect(ruleRepeatedCrewEjections(m).map(e => e.player)).toEqual(['blue']);
    expect(ruleSkipWhenImpostorFound(m).map(e => e.player)).toEqual(['green']);
  });
  it('a 2-player minority bloc twice is a pair tell; a majority vote is not', () => {
    const v = (meeting: number, ballots: Record<string, string>) => Object.entries(ballots).map(([voter, target]) => ({ meeting, voter, target, known: true }));
    const m: MatchState = { ...base, votes: [
      ...v(0, { blue: 'white', green: 'white', white: 'skip', purple: 'skip', cyan: 'skip' }),
      ...v(1, { blue: 'purple', green: 'purple', white: 'skip', purple: 'skip', cyan: 'skip' }),
    ] };
    expect(ruleMinorityVoteBloc(m).map(e => e.player).sort()).toEqual(['blue', 'green']);
    expect(ruleMinorityVoteBloc({ ...m, settings: fixture3.settings })).toHaveLength(0); // 1-impostor lobby
  });
  it('skip on a critical vote', () => {
    const m: MatchState = { ...fixture3, votes: [
      { meeting: 1, voter: 'blue', target: 'skip', known: true }, { meeting: 1, voter: 'green', target: 'blue', known: true }, { meeting: 1, voter: 'cyan', target: 'blue', known: true },
    ] };
    expect(ruleSkipOnCriticalVote(m).map(e => e.player)).toEqual(['blue']);
  });
});

describe('carry-over: decay, trend, delta', () => {
  it('soft evidence decays with age; hard facts and structural never do', () => {
    expect(decayFactor('movement', 0)).toBe(1);
    expect(decayFactor('movement', 2)).toBeCloseTo(0.5);
    expect(decayFactor('movement', 20)).toBe(0.25); // floor
    expect(decayFactor('hard', 10)).toBe(1);
    expect(decayFactor('structural', 10)).toBe(1);
  });
  it('count offset makes unresolved probabilities sum to the impostors left (and equals the prior with no evidence)', () => {
    expect(countOffset([0, 0, 0, 0, 0], 1)).toBeCloseTo(Math.log(1 / 4), 4);
    const L = [2, 0, -1, -1];
    const c = countOffset(L, 1);
    expect(L.reduce((a, l) => a + 1 / (1 + Math.exp(-(l + c))), 0)).toBeCloseTo(1, 5);
  });
  it('evidence from an old round weighs less than the same evidence fresh', () => {
    const old = by(fixture).red.evidence.find(e => /Alone near/.test(e.label))!;
    const later: MatchState = { ...fixture, phase: { ...fixture.phase, round: 3, meeting: 3 } };
    const aged = by(later).red.evidence.find(e => /Alone near/.test(e.label))!;
    expect(old.decay).toBe(1);
    expect(aged.decay!).toBeLessThan(1);
    expect(aged.baseWeight).toBe(old.baseWeight);
    expect(Math.abs(aged.weight)).toBeLessThan(Math.abs(old.weight));
  });
  it('trend has one point per completed meeting plus now; snapshots forget the future', () => {
    const g = gameB().state; // meeting 2 in progress; meetings 0 and 1 complete
    expect(completedMeetings(g)).toEqual([0, 1]);
    expect(currentMeeting(g)).toBe(2);
    const snap = snapshotAtMeeting(g, 0);
    expect(snap.players.black.status).toBe('alive');      // ejected in meeting 1
    expect(snap.players.black.knownRole).toBe('unknown'); // role revealed later
    expect(snap.players.yellow.status).toBe('alive');     // killed in round 1
    expect(snap.players.brown.status).toBe('dead');
    const pink = by(g).pink;
    expect(pink.trend!.map(t => t.meeting)).toEqual([0, 1, 2]);
    expect(pink.delta).toBeCloseTo(pink.probability - pink.trend![1].probability, 6);
    expect(pink.trend![2].probability).toBeGreaterThan(pink.trend![0].probability); // the case built up over the game
  });
  it('no completed meeting → trend is just now, delta 0', () => {
    const s = by(fixture3).green;
    expect(s.trend).toHaveLength(1);
    expect(s.delta).toBe(0);
  });
});

describe('explainability', () => {
  it('evidence is sorted by |weight|; topReasons and a one-line summary', () => {
    const s = by(fixture2).green;
    for (let i = 1; i < s.evidence.length; i++) expect(Math.abs(s.evidence[i - 1].weight)).toBeGreaterThanOrEqual(Math.abs(s.evidence[i].weight));
    expect(topReasons(s, 2)).toHaveLength(2);
    expect(s.summary).toMatch(/accusation|Admin|Navigation/);
    expect(by(fixture3).white.summary).toMatch(/No evidence yet/);
    expect(by(fixture3).purple.baseline?.label).toMatch(/1 impostor left among 4/);
  });
});

describe('roster merges keep the evidence', () => {
  it('scores for the surviving card are the same as if the alias never existed', () => {
    const alias = 'red2';
    const withAlias: MatchState = {
      ...fixture,
      players: { ...fixture.players, [alias]: { id: alias, name: 'Rcd', color: 'unknown', isMe: false, status: 'alive', knownRole: 'unknown' } },
      observations: [...fixture.observations,
        { id: 'x1', type: 'sighting', stamp: { round: 0, t: 44, wall: 9 }, source: 'me', confidence: 0.95, player: alias, room: 'storage', heading: 'electrical', alone: true },
        { id: 'x2', type: 'manualMark', stamp: { round: 0, t: 45, wall: 10 }, source: 'manual', confidence: 0.9, player: alias, mark: 'sus', reason: 'proximityToBody' },
      ] as Observation[],
      claims: [{ id: 'x3', meeting: 0, stamp: { round: 0, t: 55, wall: 11 }, by: alias, type: 'accusation', about: 'green' }],
      votes: [{ meeting: 0, voter: alias, target: 'green', known: true }],
    };
    const reference: MatchState = JSON.parse(JSON.stringify(withAlias).replaceAll(`"${alias}"`, '"red"'));
    delete reference.players[alias];
    const merged = reduce(withAlias, { kind: 'mergePlayers', wall: 1, payload: { from: alias, into: 'red' } });
    expect(merged.players[alias]).toBeUndefined();
    const a = by(merged), b = by(reference);
    expect(a.red.probability).toBeCloseTo(b.red.probability, 10);
    expect(a.red.verdict).toBe(b.red.verdict);
    expect(a.red.evidence.map(e => e.label).sort()).toEqual(b.red.evidence.map(e => e.label).sort());
    expect(a.green.probability).toBeCloseTo(b.green.probability, 10);
    expect(a.red.evidence.some(e => e.label === 'You saw them near the body')).toBe(true);
  });
  it('a removed junk card says nothing and is not scored', () => {
    const m: MatchState = { ...fixture3, claims: [{ id: 'j', meeting: 0, stamp: { round: 0, t: 55, wall: 1 }, by: 'junk', type: 'accusation', about: 'green' }] };
    const s = by(m);
    expect(s.junk).toBeUndefined();
    expect(s.green.evidence.some(e => e.category === 'social')).toBe(false);
  });
});
