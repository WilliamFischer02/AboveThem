/**
 * "Could X have done this kill?" — pure geometry over what I SAW.
 *
 * The kill happened somewhere in the kill window [w0, w1] (w1 = when the body was
 * found; w0 = max(w1 − defaultSec, earliest the cooldown allows)). X had to be in the
 * body room at some instant tk inside that window. Every sighting of X (room S at
 * time t) rules out the instants X could not have walked between S and the body room:
 * |tk − t| < walk(S, body). If every instant is ruled out on foot, X could not have
 * walked there; if a vent network makes it possible, the kill was "vent-only" for X.
 *
 * Only my own sightings (source 'me' / 'mod') count — chat claims can be lies.
 */
import type { BodyFoundObs, MapData, MatchState, PlayerId, RoomId, SightingObs, EvidenceItem } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { walkSeconds, ventConnected } from './map';
import { ev, fmt } from './evidence';

const W = weightsJson;

/**
 * Earliest instant a kill is possible in a round: every impostor's cooldown restarts at the
 * start of a round. Round 0 uses a short opening cooldown.
 * UNVERIFIED: the stock client's opening cooldown is ~10 s regardless of the lobby setting;
 * rounds after a meeting restart at the full setting. 3 s slack for our round-start clock.
 */
export const OPENING_COOLDOWN_SEC = 10;
const CLOCK_SLACK = 3;

export function killWindow(m: MatchState, b: BodyFoundObs): [number, number] {
  const cd = b.stamp.round === 0 ? Math.min(OPENING_COOLDOWN_SEC, m.settings.killCooldownSec) : m.settings.killCooldownSec;
  const earliest = Math.max(0, cd - CLOCK_SLACK);
  const w0 = Math.max(0, b.stamp.t - W.killWindow.defaultSec, Math.min(earliest, b.stamp.t));
  return [w0, b.stamp.t];
}

/** Travel time with vents allowed (a vent hop costs ~2 s): Dijkstra over walk + vent edges. */
export function ventAssistedSeconds(map: MapData, from: RoomId, to: RoomId, speed = 1): number {
  if (from === to) return 0;
  const VENT_HOP = 2;
  const dist = new Map<RoomId, number>(map.rooms.map(r => [r.id, Infinity]));
  dist.set(from, 0);
  const done = new Set<RoomId>();
  while (done.size < map.rooms.length) {
    let cur: RoomId | null = null, best = Infinity;
    for (const [r, d] of dist) if (!done.has(r) && d < best) { best = d; cur = r; }
    if (cur === null) break;
    done.add(cur);
    if (cur === to) break;
    const room = map.rooms.find(r => r.id === cur);
    const next: [RoomId, number][] = (room?.adjacent ?? []).map(a => [a.room, a.sec / speed]);
    for (const v of map.vents) if (v.rooms.includes(cur)) for (const r of v.rooms) if (r !== cur) next.push([r, VENT_HOP]);
    for (const [r, s] of next) if (best + s < (dist.get(r) ?? Infinity)) dist.set(r, best + s);
  }
  return dist.get(to) ?? Infinity;
}

/** Instants in [w0, w1] not excluded by any (t ± travel) interval. */
function freeTime(w0: number, w1: number, blocks: [number, number][]): number {
  const sorted = blocks.map(([a, b]) => [Math.max(w0, a), Math.min(w1, b)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let covered = 0, cur = w0;
  for (const [a, b] of sorted) {
    if (b <= cur) continue;
    covered += b - Math.max(a, cur);
    cur = b;
  }
  return Math.max(0, w1 - w0 - covered);
}

export interface Feasibility {
  feasible: 'yes' | 'ventOnly' | 'no' | 'unknown';
  reason: string;
  refs: string[];
  /** Depends on map data marked unverified. */
  shaky: boolean;
  /** Seconds the on-foot route misses by (0 when walkable; 0.5 = a hair, 30 = way off). */
  margin?: number;
}

/** Could `player` have been in the body's room at some instant of its kill window? */
export function killFeasibility(m: MatchState, player: PlayerId, body: BodyFoundObs): Feasibility {
  const [w0, w1] = killWindow(m, body);
  const sights = m.observations.filter((o): o is SightingObs =>
    o.type === 'sighting' && o.stamp.round === body.stamp.round && (o.source === 'me' || o.source === 'mod')
    && (o.player === player || !!o.withPlayers?.includes(player)));
  const roomName = (r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
  if (sights.length === 0) return { feasible: 'unknown', reason: 'Not seen during the round', refs: [], shaky: false };
  const speed = m.settings.playerSpeed || 1;
  // Relevant: sightings close enough in time to the window to constrain it.
  const relevant = sights.filter(s => s.stamp.t >= w0 - 40 && s.stamp.t <= w1 + 5);
  if (relevant.length === 0) return { feasible: 'unknown', reason: 'No sighting near the kill window', refs: [], shaky: false };
  // Travel times in the map table are rough (±3 s): only call it impossible / vent-only when it is
  // impossible by more than that. A hair-thin verdict accused crewmates in the calibration games.
  const GRACE = 3;
  const block = (secs: (s: SightingObs) => number) => relevant.map(s => [s.stamp.t - secs(s) + GRACE, s.stamp.t + secs(s) - GRACE] as [number, number]);
  const walk = (s: SightingObs) => walkSeconds(m.map, s.room, body.room, speed);
  const vent = (s: SightingObs) => ventAssistedSeconds(m.map, s.room, body.room, speed);
  const refs = [...relevant.map(s => s.id), body.id];
  const where = relevant.map(s => `${roomName(s.room)} ${fmt(s.stamp.t)}`).join(', ');
  const shakyRooms = !m.map._verified.rooms;
  if (freeTime(w0, w1, block(walk)) > 0) return { feasible: 'yes', reason: `Could have walked to ${roomName(body.room)} in the window`, refs, shaky: shakyRooms, margin: 0 };
  // How many more seconds of slack the walk would need: 0.5 → a hair (weak), ≥ 6 → clear-cut.
  let margin = 0;
  while (margin < 30 && freeTime(w0, w1, block(s => Math.max(0, walk(s) - margin))) <= 0) margin += 0.5;
  if (freeTime(w0, w1, block(vent)) > 0) return { feasible: 'ventOnly', reason: `Seen ${where}: could reach ${roomName(body.room)} in time only by vent`, refs, shaky: shakyRooms || !m.map._verified.vents, margin };
  return { feasible: 'no', reason: `Seen ${where}: could not reach ${roomName(body.room)} during the kill window (${fmt(w0)}–${fmt(w1)})`, refs, shaky: shakyRooms || !m.map._verified.vents, margin };
}

/** 0.25..1: how much to trust an "impossible on foot" verdict, from the seconds it missed by. */
export const marginTrust = (margin: number) => Math.max(0.25, Math.min(1, margin / 6));

/** Evidence from killFeasibility for every alive (at the time) non-victim player I saw that round. */
export function ruleKillFeasibility(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const pname = (p: string) => m.players[p]?.name ?? p;
  const roomName = (r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
  for (const b of m.observations) {
    if (b.type !== 'bodyFound') continue;
    const seen = new Set<PlayerId>();
    for (const o of m.observations) if (o.type === 'sighting' && o.stamp.round === b.stamp.round) { seen.add(o.player); o.withPlayers?.forEach(p => seen.add(p)); }
    for (const p of seen) {
      if (p === b.victim || p === m.me || !m.players[p]) continue;
      const f = killFeasibility(m, p, b);
      const trust = marginTrust(f.margin ?? 0);
      const hair = trust < 1 ? ` (by ${f.margin} s)` : '';
      if (f.feasible === 'no') {
        const e = ev(p, W.movement.couldNotReachBody * trust, 'movement', f.reason + hair, f.refs, f.shaky);
        e.round = b.stamp.round; out.push(e);
      } else if (f.feasible === 'ventOnly') {
        const e = ev(p, W.movement.ventOnlyReachable * trust, 'movement', f.reason + hair, f.refs, f.shaky, 'body_in_dead_end',
          { P: pname(p), R: roomName(b.room), V: pname(b.victim), T: fmt(b.stamp.t) });
        e.round = b.stamp.round; out.push(e);
      }
    }
  }
  return out;
}
