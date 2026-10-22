/** Edge cases found in the bugs-rust review: an unfilled roster, everyone dead, me dead, odd scores. */
import { describe, expect, it } from 'vitest';
import type { MatchState, Player, SuspectScore } from '../types/game';
import { headline } from './headline';
import { buildMeetingScript } from './meetingScript';
import { scoreAll } from './suspicion';
import { fixture } from './__fixtures__/skeld_match_01';

function match(ids: string[], alive: string[], imps = 2): MatchState {
  const players: Record<string, Player> = {};
  for (const id of ids) players[id] = { id, name: id, color: id === 'me' ? 'cyan' : (id as Player['color']), isMe: id === 'me', status: alive.includes(id) ? 'alive' : 'dead', knownRole: id === 'me' ? 'crew' : 'unknown' };
  return {
    ...fixture, me: 'me', myRole: 'crew', settings: { ...fixture.settings, impostorCount: imps }, players,
    phase: { phase: 'meetingDiscussion', wall: 0, round: 0, meeting: 0 },
    observations: [], chat: [], claims: [], votes: [], ejections: [], ledger: [],
  };
}

describe('headline / meeting script on degenerate states', () => {
  it('a provisional match with only me is not a "critical vote"', () => {
    const m = match(['me'], ['me']);
    const h = headline(m, scoreAll(m));
    expect(h.critical).toBe(false);
    expect(h.kind).not.toBe('criticalVote');
    const script = buildMeetingScript(m, scoreAll(m), 0);
    expect(JSON.stringify(script)).not.toMatch(/NaN|undefined/);
  });

  it('everyone else dead: no crash, nothing to vote, not critical', () => {
    const m = match(['me', 'red', 'blue'], ['me']);
    const h = headline(m, scoreAll(m));
    expect(h.players).toEqual([]);
    expect(h.critical).toBe(false);
  });

  it('me dead still yields a ghost headline over the real classification', () => {
    const m = match(['me', 'red', 'blue', 'green', 'pink'], ['red', 'blue', 'green', 'pink'], 1);
    const h = headline(m, scoreAll(m));
    expect(h.kind).toBe('imDead');
    expect(h.title).toMatch(/Ghost/);
  });

  it('a genuine 3-alive / 1-impostor meeting is still critical', () => {
    const m = match(['me', 'red', 'blue', 'green'], ['me', 'red', 'blue'], 1);
    expect(headline(m, scoreAll(m)).critical).toBe(true);
  });

  it('a NaN probability is ignored instead of sorting garbage / printing NaN%', () => {
    const m = match(['me', 'red', 'blue', 'green', 'pink', 'orange'], ['me', 'red', 'blue', 'green', 'pink', 'orange'], 1);
    const bad: SuspectScore = { player: 'red', verdict: 'unknown', probability: Number.NaN, logOdds: Number.NaN, clearedForKills: [], evidence: [{ id: 'x', player: 'red', weight: 1, category: 'movement', label: 'x', refs: [] }] };
    const h = headline(m, [bad]);
    expect(JSON.stringify(h)).not.toMatch(/NaN/);
  });
});
