/**
 * Every feature card's engine call on degenerate matches (bugs-rust review): a stub map with no rooms / info,
 * nobody else alive, me dead, nothing logged. FeatureSlots mounts these per phase; none may throw or leak NaN.
 */
import { describe, expect, it } from 'vitest';
import type { MapData, MatchState, Player } from '../../types/game';
import { fixture } from '../__fixtures__/skeld_match_01';
import { killClock, killWindows, doubleKills } from './killWindow';
import { lastSeenBoard, unplacedThisRound, byRoom } from './lastSeen';
import { meetingMath } from './meetingMath';
import { meetingTimer, prepChecklist } from './meetingPrep';
import { roundPlan } from './roundPlan';
import { securityFor, adminChecks, monitorChecks } from './security';
import { taskClaimChecks, watchedPlayer } from './taskCheck';
import { bandwagons, votingPairs, voteMatrix, meetingVoters } from './voteAnalysis';

const stubMap: MapData = { ...fixture.map, rooms: [], vents: [], tasks: [], info: undefined } as MapData;

function match(alive: string[], all: string[], map: MapData = fixture.map, phase: MatchState['phase']['phase'] = 'meetingDiscussion'): MatchState {
  const players: Record<string, Player> = {};
  for (const id of all) players[id] = { id, name: id, color: id === 'me' ? 'cyan' : (id as Player['color']), isMe: id === 'me', status: alive.includes(id) ? 'alive' : 'dead', knownRole: 'unknown' };
  return { ...fixture, map, me: 'me', players, phase: { phase, wall: 1000, round: 0, meeting: 0 }, observations: [], chat: [], claims: [], votes: [], ejections: [], ledger: [] };
}

function runAll(m: MatchState) {
  const now = { round: 0, t: 12, wall: 2000 };
  const board = lastSeenBoard(m, now);
  const w = killWindows(m);
  return {
    clock: killClock(m, now), w, dk: doubleKills(m, w), board, un: unplacedThisRound(board, 0), rooms: byRoom(board, 0),
    math: meetingMath(m), timer: meetingTimer(m, 5000), prep: prepChecklist(m, { full: true }), plan: roundPlan(m, 0),
    sec: securityFor(m), admin: adminChecks(m), mon: monitorChecks(m), tasks: taskClaimChecks(m), watched: watchedPlayer(m, now),
    band: bandwagons(m), pairs: votingPairs(m), votes: voteMatrix(m, 0),
  };
}

describe('feature engines on degenerate matches', () => {
  const cases: [string, MatchState][] = [
    ['stub map, nothing logged', match(['me', 'red', 'blue'], ['me', 'red', 'blue'], stubMap)],
    ['nobody else alive', match(['me'], ['me', 'red', 'blue'])],
    ['me dead, round phase', match(['red', 'blue', 'green'], ['me', 'red', 'blue', 'green'], fixture.map, 'round')],
    ['only me in the roster', match(['me'], ['me'], stubMap, 'round')],
  ];
  for (const [label, m] of cases) {
    it(`${label}: no throw, no NaN`, () => {
      let out: unknown;
      expect(() => { out = runAll(m); }).not.toThrow();
      expect(JSON.stringify(out)).not.toMatch(/NaN/);
    });
  }

  it('the ejected player still counts as a voter of the meeting that ejected them', () => {
    const m = match(['me', 'red', 'blue'], ['me', 'red', 'blue', 'green']);
    m.players.green.status = 'ejected';
    m.ejections = [{ meeting: 0, player: 'green', wasImpostor: false }];
    expect(meetingVoters(m, 0).sort()).toEqual(['blue', 'green', 'me', 'red']);
    expect(meetingVoters(m, 1).sort()).toEqual(['blue', 'me', 'red']);
  });
});
