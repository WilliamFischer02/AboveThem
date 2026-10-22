import { describe, expect, it } from 'vitest';
import type { MatchState, Player, SuspectScore } from '../types/game';
import { headline, headlineText } from './headline';
import { fixture } from './__fixtures__/skeld_match_01';
import { scoreAll } from './suspicion';
import { buildMeetingScript } from './meetingScript';

const ids = ['me', 'red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black'];

function match(over: Partial<MatchState> = {}, alive = ids, imps = 2): MatchState {
  const players: Record<string, Player> = {};
  for (const id of ids) players[id] = { id, name: id[0].toUpperCase() + id.slice(1), color: id === 'me' ? 'cyan' : (id as Player['color']), isMe: id === 'me', status: alive.includes(id) ? 'alive' : 'dead', knownRole: id === 'me' ? 'crew' : 'unknown' };
  return {
    ...fixture,
    me: 'me',
    myRole: 'crew',
    settings: { ...fixture.settings, impostorCount: imps },
    players,
    phase: { phase: 'meetingDiscussion', wall: 0, round: 0, meeting: 0 },
    observations: [], chat: [], claims: [], votes: [], ejections: [], ledger: [],
    ...over,
  };
}

function sc(player: string, probability: number, verdict: SuspectScore['verdict'] = 'unknown'): SuspectScore {
  const logOdds = Math.log(probability / Math.max(1e-9, 1 - probability));
  return { player, verdict, probability, logOdds, clearedForKills: [], evidence: [{ id: `e-${player}`, player, weight: 1, category: 'movement', label: `${player} was odd`, refs: [] }] };
}

describe('headline', () => {
  it('top < 0.45 → Not Enough Info | Skip Vote (calm), leads listed for the round bar', () => {
    const h = headline(match(), [sc('red', 0.3), sc('blue', 0.2), sc('green', 0.1)]);
    expect(h.kind).toBe('notEnoughInfo');
    expect(h.title).toBe('Not Enough Info | Skip Vote');
    expect(h.tone).toBe('calm');
    expect(h.players).toEqual(['red', 'blue']);
    expect(h.short).toBe('Watch: Red, Blue');
    expect(h.why).toContain('e-red');
  });

  it('one ≥ 0.6 and second < 0.4 → One Major Suspect', () => {
    const h = headline(match(), [sc('blue', 0.3), sc('red', 0.72), sc('green', 0.1)]);
    expect(h.kind).toBe('oneSuspect');
    expect(h.players).toEqual(['red']);
    expect(h.subtitle).toMatch(/Prime suspect: Red \(72%\)/);
    expect(h.tone).toBe('danger');
  });

  it('two within 0.15 → Two Major Suspects, ordered highest first', () => {
    const h = headline(match(), [sc('blue', 0.55), sc('red', 0.62), sc('green', 0.2)]);
    expect(h.kind).toBe('twoSuspects');
    expect(h.players).toEqual(['red', 'blue']);
    expect(h.short).toBe('Watch: Red, Blue');
  });

  it('three within 0.15 → Three Major Suspects (capped at 3)', () => {
    const h = headline(match(), [sc('blue', 0.55), sc('red', 0.6), sc('green', 0.5), sc('pink', 0.48)]);
    expect(h.kind).toBe('threeSuspects');
    expect(h.players).toEqual(['red', 'blue', 'green']);
  });

  it('edge: a clear leader whose #2 is ≥ 0.4 is only "Leaning"', () => {
    const h = headline(match(), [sc('red', 0.62), sc('blue', 0.42)]);
    expect(h.kind).toBe('leaning');
    expect(h.title).toBe('Leaning: Red');
    expect(h.subtitle).toMatch(/next: Blue \(42%\)/);
  });

  it('critical vote when crew alive − impostors ≤ 2; basis keeps the classification', () => {
    // alive: me, red, blue, green (4), 1 impostor left → crew 3 − imp 1 = 2
    const m = match({}, ['me', 'red', 'blue', 'green'], 1);
    const h = headline(m, [sc('red', 0.7), sc('blue', 0.2), sc('green', 0.1)]);
    expect(h.kind).toBe('criticalVote');
    expect(h.basis).toBe('oneSuspect');
    expect(h.critical).toBe(true);
    expect(h.tone).toBe('danger');
    expect(h.players).toEqual(['red']);
    expect(h.subtitle).toMatch(/Wrong vote \+ one kill loses/);
  });

  it('not critical with a comfortable margin; last-vote wording at margin 1', () => {
    expect(headline(match(), [sc('red', 0.7)]).critical).toBe(false);
    const m = match({}, ['me', 'red', 'blue'], 1); // crew 2 − imp 1 = 1
    expect(headline(m, [sc('red', 0.3), sc('blue', 0.2)]).subtitle).toMatch(/A wrong vote loses the game/);
  });

  it('confirmed impostor wins over everything (even critical), cleared players are excluded', () => {
    const m = match({}, ['me', 'red', 'blue', 'green'], 1);
    const h = headline(m, [sc('red', 0.9, 'hardClear'), sc('blue', 1, 'certainImpostor'), sc('green', 0.3)]);
    expect(h.kind).toBe('confirmedImpostor');
    expect(h.players).toEqual(['blue']);
    expect(h.short).toBe('Impostor: Blue');
  });

  it('dead players / me never appear; everyone cleared → skip', () => {
    const m = match({}, ['me', 'red', 'blue']);
    const h = headline(m, [sc('green', 0.9), sc('me', 0.9), sc('red', 0, 'certainCrew'), sc('blue', 0.1, 'hardClear')]);
    expect(h.kind).toBe('skipVote');
    expect(h.players).toEqual([]);
  });

  it('lobby short-circuits; a dead me becomes imDead with the same basis', () => {
    expect(headline(match({ phase: { phase: 'lobby', wall: 0, round: 0 } }), [sc('red', 0.9)]).kind).toBe('lobby');
    const m = match({}, ids.filter(i => i !== 'me'));
    const h = headline(m, [sc('red', 0.72), sc('blue', 0.1)]);
    expect(h.kind).toBe('imDead');
    expect(h.basis).toBe('oneSuspect');
    expect(h.players).toEqual(['red']);
  });

  it('meetingScript.headline is the same text (one source of truth)', () => {
    const scores = scoreAll(fixture);
    const script = buildMeetingScript(fixture, scores, 0);
    expect(script.headline).toBe(headlineText(headline(fixture, scores)));
  });
  it('vote follows the headline: 79% / 62% → Leaning, vote Red, Green as the follow-up', () => {
    const h = headline(match(), [sc('red', 0.79), sc('green', 0.62), sc('blue', 0.2)]);
    expect(h.kind).toBe('leaning');
    expect(h.subtitle).toMatch(/Red \(79%\) — vote · next: Green \(62%\)/);
    expect(h.vote.target).toBe('red');
    expect(h.vote.alternative).toBe('green');
    expect(h.vote.reason).toMatch(/Green next if Red was crew/);
  });

  it('vote: weak lean (0.5 / 0.3) skips with the lead as the alternative', () => {
    const h = headline(match(), [sc('red', 0.5), sc('blue', 0.3)]);
    expect(h.kind).toBe('leaning');
    expect(h.vote.target).toBe('skip');
    expect(h.vote.alternative).toBe('red');
  });

  it('vote: two close suspects split → skip; two strong ones → vote the top, #2 next', () => {
    const split = headline(match(), [sc('red', 0.55), sc('blue', 0.5)]);
    expect(split.kind).toBe('twoSuspects');
    expect(split.vote.target).toBe('skip');
    const strong = headline(match(), [sc('red', 0.75), sc('blue', 0.66)]);
    expect(strong.kind).toBe('twoSuspects');
    expect(strong.vote).toMatchObject({ target: 'red', alternative: 'blue' });
    expect(strong.subtitle).toMatch(/vote Red, then Blue/);
  });

  it('vote: one major suspect → vote; not enough info → skip; confirmed → vote at 100%', () => {
    expect(headline(match(), [sc('red', 0.72), sc('blue', 0.1)]).vote).toMatchObject({ target: 'red', alternative: 'skip' });
    expect(headline(match(), [sc('red', 0.3)]).vote.target).toBe('skip');
    expect(headline(match(), [sc('red', 0.3), sc('blue', 1, 'certainImpostor')]).vote).toMatchObject({ target: 'blue', confidence: 1 });
  });

  it('vote edge: a critical vote does not skip when the top suspect is above 0.3', () => {
    const m = match({}, ['me', 'red', 'blue'], 1); // crew 2 − imp 1 = 1
    const h = headline(m, [sc('red', 0.35), sc('blue', 0.2)]);
    expect(h.basis).toBe('notEnoughInfo');
    expect(h.vote.target).toBe('red');
    expect(headline(m, [sc('red', 0.25), sc('blue', 0.2)]).vote.target).toBe('skip');
  });

  it('meetingScript.vote is exactly the headline vote', () => {
    const scores = scoreAll(fixture);
    expect(buildMeetingScript(fixture, scores, 0).vote).toEqual(headline(fixture, scores).vote);
  });
});