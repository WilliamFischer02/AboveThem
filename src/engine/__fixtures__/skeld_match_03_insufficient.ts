/**
 * Fixture 03: first meeting, nothing useful logged. Me = cyan. 6 players, 1 impostor.
 * I was alone in Cafeteria; Yellow's body was found in Storage by Green with
 * Blue and White present (a group find, not a self-report). No sightings.
 * Expected: the script says "insufficient info", recommends skip, asks everyone
 * for room + companion.
 */
import type { MatchState, MapData } from '../../types/game';
import skeld from '../../data/maps/skeld.json';

const st = (t: number) => ({ round: 0, t, wall: 1_700_000_000_000 + t * 1000 });

export const fixture3: MatchState = {
  id: 'skeld_match_03',
  startedAt: 1_700_000_000_000,
  settings: {
    map: 'skeld', impostorCount: 1, killCooldownSec: 30, visualTasksOn: true,
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
    green:  { id: 'green',  name: 'Green',  color: 'green',  isMe: false, status: 'alive', knownRole: 'unknown' },
    white:  { id: 'white',  name: 'White',  color: 'white',  isMe: false, status: 'alive', knownRole: 'unknown' },
    purple: { id: 'purple', name: 'Purple', color: 'purple', isMe: false, status: 'alive', knownRole: 'unknown' },
    yellow: { id: 'yellow', name: 'Yellow', color: 'yellow', isMe: false, status: 'dead',  knownRole: 'unknown' },
  },
  phase: { phase: 'meetingDiscussion', wall: 1_700_000_060_000, round: 0, meeting: 0, calledBy: 'green', reason: 'body' },
  observations: [
    { id: 'o1', type: 'myRoom',    stamp: st(2),  source: 'me', confidence: 1,    room: 'cafeteria' },
    { id: 'o2', type: 'bodyFound', stamp: st(55), source: 'me', confidence: 0.95, victim: 'yellow', room: 'storage', reporter: 'green', present: ['green', 'blue', 'white'] },
  ],
  chat: [],
  claims: [],
  votes: [],
  ejections: [],
  ledger: [],
};
