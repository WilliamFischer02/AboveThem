/**
 * Fixture 02: 2-impostor lobby, second meeting. Me = cyan (crew).
 *
 * Meeting 1 ejected Red — confirmed impostor (confirm ejects ON). One impostor left.
 * Round 2 (index 1): body of Orange found in Navigation at 0:40 by White with
 * Blue present (not a self-report). Claims in meeting 2:
 *   - Green: "I was in Admin 0:35–0:45" — but I saw Green in Navigation at 0:38 → contradiction.
 *   - Purple: "with Blue"; Blue: "with Purple" → confirmed companion alibi.
 *   - Black accuses Green with no evidence; White then bandwagons.
 *   - Yellow was never seen or mentioned in round 2 → unaccounted.
 *   - Black also claimed Swipe Card in Electrical → task not in that room.
 */
import type { MatchState, MapData } from '../../types/game';
import skeld from '../../data/maps/skeld.json';

const st = (round: number, t: number) => ({ round, t, wall: 1_700_000_000_000 + round * 200_000 + t * 1000 });

export const fixture2: MatchState = {
  id: 'skeld_match_02',
  startedAt: 1_700_000_000_000,
  settings: {
    map: 'skeld', impostorCount: 2, killCooldownSec: 30, visualTasksOn: true,
    confirmEjectsOn: true, anonymousVotes: false, taskBarMode: 'always',
    crewVision: 1, impostorVision: 1.5, playerSpeed: 1, emergencyMeetings: 1,
    discussionTimeSec: 15, votingTimeSec: 120, commonTasks: 1, longTasks: 1, shortTasks: 2,
  },
  map: skeld as unknown as MapData,
  me: 'cyan',
  myRole: 'crew',
  players: {
    cyan:   { id: 'cyan',   name: 'Goob',   color: 'cyan',   isMe: true,  status: 'alive',   knownRole: 'crew' },
    red:    { id: 'red',    name: 'Red',    color: 'red',    isMe: false, status: 'ejected', knownRole: 'impostor' },
    blue:   { id: 'blue',   name: 'Blue',   color: 'blue',   isMe: false, status: 'alive',   knownRole: 'unknown' },
    green:  { id: 'green',  name: 'Green',  color: 'green',  isMe: false, status: 'alive',   knownRole: 'unknown' },
    purple: { id: 'purple', name: 'Purple', color: 'purple', isMe: false, status: 'alive',   knownRole: 'unknown' },
    yellow: { id: 'yellow', name: 'Yellow', color: 'yellow', isMe: false, status: 'alive',   knownRole: 'unknown' },
    white:  { id: 'white',  name: 'White',  color: 'white',  isMe: false, status: 'alive',   knownRole: 'unknown' },
    orange: { id: 'orange', name: 'Orange', color: 'orange', isMe: false, status: 'dead',    knownRole: 'unknown' },
    black:  { id: 'black',  name: 'Black',  color: 'black',  isMe: false, status: 'alive',   knownRole: 'unknown' },
  },
  phase: { phase: 'meetingDiscussion', wall: 1_700_000_240_000, round: 1, meeting: 1, calledBy: 'white', reason: 'body' },
  observations: [
    { id: 'o1', type: 'myRoom',    stamp: st(1, 2),  source: 'me', confidence: 1,    room: 'cafeteria' },
    { id: 'o2', type: 'sighting',  stamp: st(1, 20), source: 'me', confidence: 0.95, player: 'orange', room: 'weapons', withPlayers: ['green'] },
    { id: 'o3', type: 'sighting',  stamp: st(1, 38), source: 'me', confidence: 0.95, player: 'green', room: 'navigation', alone: true },
    { id: 'o4', type: 'bodyFound', stamp: st(1, 40), source: 'me', confidence: 0.95, victim: 'orange', room: 'navigation', reporter: 'white', present: ['white', 'blue'] },
  ],
  chat: [],
  claims: [
    { id: 'c1', meeting: 1, stamp: st(1, 40), by: 'green',  type: 'location',  room: 'admin', timeWindow: [35, 45] },
    { id: 'c2', meeting: 1, stamp: st(1, 40), by: 'purple', type: 'companion', about: 'blue', timeWindow: [0, 40] },
    { id: 'c3', meeting: 1, stamp: st(1, 40), by: 'blue',   type: 'companion', about: 'purple', timeWindow: [0, 40] },
    { id: 'c4', meeting: 1, stamp: st(1, 40), by: 'black',  type: 'accusation', about: 'green' },
    { id: 'c5', meeting: 1, stamp: { ...st(1, 40), wall: st(1, 40).wall + 1 }, by: 'white', type: 'accusation', about: 'green' },
    { id: 'c6', meeting: 1, stamp: st(1, 40), by: 'black',  type: 'task', taskId: 'swipeCard', room: 'electrical' },
  ],
  votes: [],
  ejections: [{ meeting: 0, player: 'red', wasImpostor: true }],
  ledger: [],
};
