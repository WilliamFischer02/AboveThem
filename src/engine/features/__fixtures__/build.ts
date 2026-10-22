/** Tiny MatchState builder for feature tests (Skeld, me = cyan, crew). */
import type { MatchState, MapData, Observation, Player, PlayerId, LobbySettings } from '../../../types/game';
import skeld from '../../../data/maps/skeld.json';

export const st = (t: number, round = 0) => ({ round, t, wall: 1_700_000_000_000 + round * 1e6 + t * 1000 });

let n = 0;
/** Observation with id/stamp/source/confidence filled in. */
export function o<T extends Omit<Observation, 'id' | 'stamp' | 'source' | 'confidence'>>(t: number, x: T, round = 0): Observation {
  return { id: `x${++n}`, stamp: st(t, round), source: 'me', confidence: 0.95, ...x } as unknown as Observation;
}

const COLORS = ['cyan', 'blue', 'red', 'green', 'purple', 'yellow', 'white', 'orange', 'pink', 'lime'] as const;

export function build(opts: { players?: number; settings?: Partial<LobbySettings>; obs?: Observation[]; dead?: PlayerId[] } = {}): MatchState {
  const count = opts.players ?? 8;
  const players: Record<PlayerId, Player> = {};
  for (const c of COLORS.slice(0, count)) {
    players[c] = { id: c, name: c[0].toUpperCase() + c.slice(1), color: c, isMe: c === 'cyan', status: opts.dead?.includes(c) ? 'dead' : 'alive', knownRole: c === 'cyan' ? 'crew' : 'unknown' };
  }
  return {
    id: 'feat', startedAt: 1_700_000_000_000,
    settings: {
      map: 'skeld', impostorCount: 2, killCooldownSec: 30, visualTasksOn: true, confirmEjectsOn: true, anonymousVotes: false,
      taskBarMode: 'always', crewVision: 1, impostorVision: 1.5, playerSpeed: 1, emergencyMeetings: 1, discussionTimeSec: 15,
      votingTimeSec: 120, commonTasks: 1, longTasks: 1, shortTasks: 2, ...opts.settings,
    },
    map: skeld as unknown as MapData,
    me: 'cyan', myRole: 'crew', players,
    phase: { phase: 'round', wall: 1_700_000_000_000, round: 0 },
    observations: opts.obs ?? [], chat: [], claims: [], votes: [], ejections: [], ledger: [],
  };
}
