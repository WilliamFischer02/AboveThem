/**
 * Fixture: a hand-logged Skeld round. Me = cyan (crew). 2 impostors in lobby.
 * Story: Cyan is in MedBay with Blue all round (Blue scans → hard clear).
 * Red seen alone heading to Electrical at 0:35. Green self-reports Yellow's body
 * in Electrical at 0:50, alone. Purple was seen in Navigation at 0:40 (can't
 * reach Electrical on foot in 10 s; no vent between them).
 */
import type { MatchState, MapData } from '../../types/game';
import skeld from '../../data/maps/skeld.json';

const stamp = (t: number) => ({ round: 0, t, wall: 1_700_000_000_000 + t * 1000 });

export const fixture: MatchState = {
  id: 'skeld_match_01',
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
    cyan:   { id: 'cyan',   name: 'Goob',   color: 'cyan',   isMe: true,  status: 'alive', knownRole: 'crew' },
    blue:   { id: 'blue',   name: 'Blue',   color: 'blue',   isMe: false, status: 'alive', knownRole: 'unknown' },
    red:    { id: 'red',    name: 'Red',    color: 'red',    isMe: false, status: 'alive', knownRole: 'unknown' },
    green:  { id: 'green',  name: 'Green',  color: 'green',  isMe: false, status: 'alive', knownRole: 'unknown' },
    purple: { id: 'purple', name: 'Purple', color: 'purple', isMe: false, status: 'alive', knownRole: 'unknown' },
    yellow: { id: 'yellow', name: 'Yellow', color: 'yellow', isMe: false, status: 'dead',  knownRole: 'unknown' },
    white:  { id: 'white',  name: 'White',  color: 'white',  isMe: false, status: 'alive', knownRole: 'unknown' },
    orange: { id: 'orange', name: 'Orange', color: 'orange', isMe: false, status: 'alive', knownRole: 'unknown' },
  },
  phase: { phase: 'meetingDiscussion', wall: 1_700_000_050_000, round: 0, meeting: 0, calledBy: 'green', reason: 'body' },
  observations: [
    { id: 'o1', type: 'myRoom',   stamp: stamp(2),  source: 'me', confidence: 1,    room: 'medbay' },
    { id: 'o2', type: 'withMe',   stamp: stamp(3),  source: 'me', confidence: 0.95, player: 'blue', room: 'medbay', on: true },
    { id: 'o3', type: 'sawTask',  stamp: stamp(12), source: 'me', confidence: 0.95, player: 'blue', room: 'medbay', taskId: 'submitScan', visualConfirmed: true },
    { id: 'o4', type: 'sighting', stamp: stamp(35), source: 'me', confidence: 0.95, player: 'red', room: 'storage', heading: 'electrical', alone: true },
    { id: 'o5', type: 'sighting', stamp: stamp(40), source: 'me', confidence: 0.95, player: 'purple', room: 'navigation', alone: true },
    { id: 'o6', type: 'bodyFound', stamp: stamp(50), source: 'me', confidence: 0.95, victim: 'yellow', room: 'electrical', reporter: 'green', present: ['green'] },
  ],
  chat: [],
  claims: [],
  votes: [],
  ejections: [],
  ledger: [],
};
