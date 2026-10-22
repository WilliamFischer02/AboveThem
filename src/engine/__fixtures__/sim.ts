/**
 * Tiny scripted-game builder for calibration tests. Only screen-visible / typed facts go in:
 * what I saw, what people claimed, the vote screen, ejection text. `truth` is the answer key
 * and is NEVER read by the engine — only by the test that grades it.
 */
import type { Claim, ClaimType, LobbySettings, MapData, MatchState, Observation, Player, PlayerId, RoomId, Vote, Ejection, ChatLine } from '../../types/game';
import skeld from '../../data/maps/skeld.json';

export interface SimGame { name: string; state: MatchState; truth: { impostors: PlayerId[] } }

type ObsInput = Observation extends infer O ? O extends { id: string; stamp: unknown; source: unknown; confidence: unknown } ? Omit<O, 'id' | 'stamp' | 'source' | 'confidence'> : never : never;

export class Sim {
  private obs: Observation[] = [];
  private claims: Claim[] = [];
  private votes: Vote[] = [];
  private ejections: Ejection[] = [];
  private chat: ChatLine[] = [];
  private r = 0;
  private wall = 1_700_000_000_000;
  private n = 0;
  constructor(private id: string, private colors: PlayerId[], private me: PlayerId, private settings: Partial<LobbySettings> = {}) {}

  round(r: number) { this.r = r; return this; }
  private stamp(t: number) { this.wall += 1000; return { round: this.r, t, wall: this.wall }; }
  private add(t: number, o: ObsInput, source: Observation['source'] = 'me') {
    this.obs.push({ ...o, id: `${this.id}-o${++this.n}`, stamp: this.stamp(t), source, confidence: 0.95 } as Observation);
    return this;
  }
  myRoom(t: number, room: RoomId) { return this.add(t, { type: 'myRoom', room }); }
  withMe(t: number, player: PlayerId, room: RoomId, on: boolean) { return this.add(t, { type: 'withMe', player, room, on }); }
  see(t: number, player: PlayerId, room: RoomId, o: { heading?: RoomId; with?: PlayerId[] } = {}) {
    return this.add(t, { type: 'sighting', player, room, heading: o.heading, withPlayers: o.with, alone: !o.with?.length });
  }
  task(t: number, player: PlayerId, room: RoomId, taskId: string, visualConfirmed: boolean) { return this.add(t, { type: 'sawTask', player, room, taskId, visualConfirmed }); }
  body(t: number, victim: PlayerId, room: RoomId, reporter: PlayerId, present: PlayerId[] = [reporter]) { return this.add(t, { type: 'bodyFound', victim, room, reporter, present }); }
  mark(t: number, player: PlayerId, mark: 'sus' | 'clear' | 'hardClear', reason?: string) {
    return this.add(t, { type: 'manualMark', player, mark, ...(reason ? { reason } : {}) } as ObsInput, 'manual');
  }
  claim(meeting: number, by: PlayerId, type: ClaimType, o: { about?: PlayerId; room?: RoomId; timeWindow?: [number, number]; text?: string; taskId?: string } = {}) {
    this.claims.push({ id: `${this.id}-c${++this.n}`, meeting, stamp: this.stamp(60), by, type, ...o });
    return this;
  }
  say(meeting: number, sender: PlayerId, text: string) {
    this.chat.push({ id: `${this.id}-l${++this.n}`, meeting, stamp: this.stamp(61), sender, original: text, source: 'ocr' });
    return this;
  }
  vote(meeting: number, ballots: Record<PlayerId, PlayerId | 'skip'>) {
    for (const [voter, target] of Object.entries(ballots)) this.votes.push({ meeting, voter, target, known: true });
    return this;
  }
  eject(meeting: number, player: PlayerId | null, wasImpostor: boolean | null) { this.ejections.push({ meeting, player, wasImpostor }); return this; }

  build(phase: { meeting: number; round: number }): MatchState {
    const players: Record<PlayerId, Player> = {};
    for (const c of this.colors) players[c] = { id: c, name: c[0].toUpperCase() + c.slice(1), color: c as Player['color'], isMe: c === this.me, status: 'alive', knownRole: c === this.me ? 'crew' : 'unknown' };
    for (const o of this.obs) if (o.type === 'bodyFound' && players[o.victim]) players[o.victim].status = 'dead';
    for (const e of this.ejections) if (e.player && players[e.player]) {
      players[e.player].status = 'ejected';
      if (e.wasImpostor !== null) players[e.player].knownRole = e.wasImpostor ? 'impostor' : 'crew';
    }
    return {
      id: this.id, startedAt: 1_700_000_000_000,
      settings: {
        map: 'skeld', impostorCount: 1, killCooldownSec: 25, visualTasksOn: true, confirmEjectsOn: true, anonymousVotes: false,
        taskBarMode: 'always', crewVision: 1, impostorVision: 1.5, playerSpeed: 1, emergencyMeetings: 1, discussionTimeSec: 15,
        votingTimeSec: 120, commonTasks: 1, longTasks: 1, shortTasks: 2, ...this.settings,
      },
      map: skeld as unknown as MapData, me: this.me, myRole: 'crew', players,
      phase: { phase: 'meetingDiscussion', wall: this.wall, round: phase.round, meeting: phase.meeting, reason: 'body' },
      observations: this.obs, chat: this.chat, claims: this.claims, votes: this.votes, ejections: this.ejections, ledger: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Game A — 1 impostor (Red), 8 players. An innocent self-report-looking find in round 1 (White),
// the impostor makes the noise and only gives himself away slowly.
// ---------------------------------------------------------------------------
export function gameA(): SimGame {
  const s = new Sim('A', ['cyan', 'red', 'blue', 'green', 'yellow', 'white', 'purple', 'orange'], 'cyan');
  s.round(0)
    .myRoom(2, 'medbay').withMe(3, 'blue', 'medbay', true)
    .see(20, 'green', 'cafeteria', { with: ['purple'] })
    .see(30, 'red', 'storage', { heading: 'electrical' })
    .body(48, 'yellow', 'electrical', 'white')
    .withMe(50, 'blue', 'medbay', false)
    .claim(0, 'red', 'location', { room: 'admin' })
    .claim(0, 'green', 'companion', { about: 'purple' })
    .claim(0, 'purple', 'companion', { about: 'green' })
    .claim(0, 'red', 'accusation', { about: 'white', text: 'white self report [self report]' })
    .claim(0, 'orange', 'accusation', { about: 'white' })
    .claim(0, 'blue', 'accusation', { about: 'red', text: 'red went to elec [near body]' })
    .vote(0, { red: 'white', orange: 'white', green: 'skip', purple: 'skip', blue: 'red', white: 'red', cyan: 'skip' })
    .eject(0, null, null);
  s.round(1)
    .myRoom(3, 'navigation')
    .see(22, 'red', 'o2', { heading: 'shields' })
    .see(26, 'white', 'weapons', { with: ['green'] })
    .body(40, 'orange', 'shields', 'purple', ['purple', 'green'])
    .claim(1, 'red', 'location', { room: 'admin' })
    .claim(1, 'blue', 'accusation', { about: 'red', text: 'red again near the body [near body]' })
    .claim(1, 'purple', 'accusation', { about: 'red' })
    .claim(1, 'red', 'accusation', { about: 'blue' });
  return { name: 'A: single impostor, noisy first round', state: s.build({ meeting: 1, round: 1 }), truth: { impostors: ['red'] } };
}

// ---------------------------------------------------------------------------
// Game B — 2 impostors (Black, Pink), 10 players. Pink self-reports and lies about her location;
// the partners vouch for each other; Black is ejected in meeting 2; Pink kills again.
// ---------------------------------------------------------------------------
export function gameB(): SimGame {
  const s = new Sim('B', ['cyan', 'black', 'pink', 'lime', 'brown', 'white', 'yellow', 'red', 'blue', 'orange'], 'cyan', { impostorCount: 2 });
  s.round(0)
    .myRoom(2, 'admin').withMe(4, 'lime', 'admin', true)
    .see(30, 'black', 'storage', { heading: 'electrical' })
    .see(45, 'pink', 'cafeteria')
    .body(50, 'brown', 'electrical', 'pink')
    .withMe(52, 'lime', 'admin', false)
    .claim(0, 'pink', 'location', { room: 'storage', timeWindow: [40, 50] })
    .claim(0, 'black', 'clear', { about: 'pink' })
    .claim(0, 'pink', 'defense', { about: 'black' })
    .claim(0, 'blue', 'accusation', { about: 'black', text: 'black was going to elec [near body]' })
    .claim(0, 'pink', 'accusation', { about: 'blue' })
    .vote(0, { blue: 'black', cyan: 'black', pink: 'blue', black: 'blue', lime: 'skip', white: 'skip', yellow: 'skip', red: 'skip', orange: 'skip' })
    .eject(0, null, null);
  s.round(1)
    .myRoom(3, 'medbay').task(12, 'white', 'medbay', 'submitScan', true)
    .see(30, 'black', 'weapons', { heading: 'navigation' })
    .see(33, 'red', 'cafeteria', { with: ['orange'] })
    .body(45, 'yellow', 'navigation', 'white', ['white', 'lime'])
    .claim(1, 'white', 'accusation', { about: 'black', text: 'black came from nav [near body]' })
    .claim(1, 'pink', 'clear', { about: 'black' })
    .claim(1, 'black', 'accusation', { about: 'lime' })
    .claim(1, 'pink', 'accusation', { about: 'lime' })
    .vote(1, { white: 'black', lime: 'black', cyan: 'black', blue: 'black', red: 'black', pink: 'lime', black: 'lime', orange: 'skip' })
    .eject(1, 'black', true);
  s.round(2)
    .myRoom(2, 'upperEngine')
    .see(20, 'red', 'security', { with: ['blue'] })
    .body(40, 'orange', 'reactor', 'pink')
    .claim(2, 'pink', 'accusation', { about: 'red' })
    .claim(2, 'white', 'accusation', { about: 'pink', text: 'pink self reported again [self report]' });
  return { name: 'B: two impostors, partner vouching', state: s.build({ meeting: 2, round: 2 }), truth: { impostors: ['black', 'pink'] } };
}

// ---------------------------------------------------------------------------
// Game C — 1 impostor (Purple), 7 players. Purple fakes a task that is not in the room, the
// user marks him with a reason, and he deflects onto an innocent self-reporter (Green).
// ---------------------------------------------------------------------------
export function gameC(): SimGame {
  const s = new Sim('C', ['cyan', 'purple', 'green', 'white', 'blue', 'tan', 'coral'], 'cyan');
  s.round(0)
    .myRoom(2, 'cafeteria')
    .see(15, 'tan', 'weapons', { with: ['coral'] })
    .body(44, 'blue', 'admin', 'green')
    .claim(0, 'purple', 'task', { taskId: 'swipeCard', room: 'electrical' })
    .claim(0, 'purple', 'accusation', { about: 'green', text: 'green self report [self report]' })
    .claim(0, 'white', 'accusation', { about: 'green' })
    .vote(0, { purple: 'green', white: 'green', green: 'purple', tan: 'skip', coral: 'skip', cyan: 'skip' })
    .eject(0, null, null);
  s.round(1)
    .myRoom(2, 'medbay')
    .see(20, 'purple', 'cafeteria', { heading: 'medbay' })
    .mark(21, 'purple', 'sus', 'followedMe')
    .see(25, 'green', 'storage', { with: ['white'] })
    .body(38, 'coral', 'upperEngine', 'tan')
    .claim(1, 'green', 'accusation', { about: 'purple', text: 'purple followed cyan [followed]' })
    .claim(1, 'purple', 'accusation', { about: 'green' })
    .claim(1, 'white', 'companion', { about: 'green' })
    .claim(1, 'green', 'companion', { about: 'white' });
  return { name: 'C: fake task + deflection', state: s.build({ meeting: 1, round: 1 }), truth: { impostors: ['purple'] } };
}

// ---------------------------------------------------------------------------
// Game D — 1 impostor (Lime), 9 players, 4 rounds. Brown (crew) looks terrible in round 1
// (self-report, two accusations); Lime is a little suspicious in three separate later rounds.
// Carry-over must let the old, one-off case fade and the repeated pattern win.
// ---------------------------------------------------------------------------
export function gameD(): SimGame {
  const s = new Sim('D', ['cyan', 'lime', 'brown', 'rose', 'banana', 'gray', 'maroon', 'coral', 'tan'], 'cyan', { killCooldownSec: 20 });
  s.round(0)
    .myRoom(2, 'cafeteria')
    .body(40, 'tan', 'electrical', 'brown')
    .claim(0, 'rose', 'accusation', { about: 'brown', text: 'brown self report [self report]' })
    .claim(0, 'gray', 'accusation', { about: 'brown' })
    .claim(0, 'brown', 'location', { room: 'storage' })
    .vote(0, { rose: 'brown', gray: 'brown', brown: 'skip', lime: 'skip', banana: 'skip', maroon: 'skip', coral: 'skip', cyan: 'skip' })
    .eject(0, null, null);
  s.round(1)
    .myRoom(2, 'admin')
    .see(18, 'lime', 'storage', { heading: 'communications' })
    .see(22, 'brown', 'admin', { with: ['banana'] })
    .body(35, 'coral', 'communications', 'maroon', ['maroon', 'rose'])
    .claim(1, 'lime', 'location', { room: 'shields' })
    .vote(1, { lime: 'skip', brown: 'skip', rose: 'skip', banana: 'skip', gray: 'skip', maroon: 'skip', cyan: 'skip' })
    .eject(1, null, null);
  s.round(2)
    .myRoom(2, 'weapons')
    .see(25, 'lime', 'o2', { heading: 'navigation' })
    .see(26, 'brown', 'cafeteria', { with: ['gray', 'rose'] })
    .body(38, 'banana', 'navigation', 'gray', ['gray', 'rose'])
    .claim(2, 'maroon', 'accusation', { about: 'lime', text: 'lime near nav [near body]' })
    .vote(2, { maroon: 'lime', lime: 'maroon', brown: 'skip', rose: 'skip', gray: 'skip', cyan: 'skip' })
    .eject(2, null, null);
  s.round(3)
    .myRoom(2, 'medbay')
    .see(20, 'lime', 'upperEngine', { heading: 'reactor' })
    .body(36, 'maroon', 'reactor', 'rose', ['rose', 'brown'])
    .claim(3, 'rose', 'accusation', { about: 'lime' });
  return { name: 'D: an early red herring fades, the repeated pattern wins', state: s.build({ meeting: 3, round: 3 }), truth: { impostors: ['lime'] } };
}

export const SIM_GAMES = [gameA, gameB, gameC, gameD];
