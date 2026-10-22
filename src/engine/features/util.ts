/**
 * Shared helpers for src/engine/features/*. Pure TS (no DOM / React / Tauri).
 */
import type { MapData, MatchState, Observation, PlayerId, RoomId } from '../../types/game';

export const pname = (m: MatchState, p: PlayerId): string => m.players[p]?.name ?? p;
export const roomName = (m: MatchState, r: RoomId): string => m.map.rooms.find(x => x.id === r)?.name ?? r;

/**
 * Seconds an impostor needs to get from one vent room to another inside the same network
 * (enter animation + hop + exit). UNVERIFIED: eyeballed; deliberately small so that
 * "could not have reached" stays honest (errs toward "could have").
 */
export const VENT_HOP_SEC = 2;

/**
 * Fastest possible travel time for an IMPOSTOR between two rooms: walking edges at the lobby
 * speed plus every vent network treated as fully connected at VENT_HOP_SEC.
 * Returns null when either room is unknown to the map (no constraint can be derived).
 *
 * MERGE: replace the body with the maps agent's
 *   `const s = fastestSeconds(map, from, to, { speed, vents: true }); return Number.isFinite(s) ? s : null;`
 * from engine/map.ts (same model: walk + vent hops at 2 s). Keep the null-for-unknown contract —
 * killWindow treats null as "no constraint", never as "unreachable".
 */
export function impostorTravelSec(map: MapData, from: RoomId, to: RoomId, speed = 1): number | null {
  if (from === to) return 0;
  const ids = new Set(map.rooms.map(r => r.id));
  if (!ids.has(from) || !ids.has(to)) return null;
  const edges = new Map<RoomId, { room: RoomId; sec: number }[]>();
  const add = (a: RoomId, b: RoomId, sec: number) => { if (!edges.has(a)) edges.set(a, []); edges.get(a)!.push({ room: b, sec }); };
  const sp = speed > 0 ? speed : 1;
  for (const r of map.rooms) for (const a of r.adjacent) add(r.id, a.room, a.sec / sp);
  for (const v of map.vents) for (const a of v.rooms) for (const b of v.rooms) if (a !== b) add(a, b, VENT_HOP_SEC);
  const dist = new Map<RoomId, number>([[from, 0]]);
  const done = new Set<RoomId>();
  for (;;) {
    let cur: RoomId | null = null; let best = Infinity;
    for (const [r, d] of dist) if (!done.has(r) && d < best) { best = d; cur = r; }
    if (cur === null) break;
    if (cur === to) return best;
    done.add(cur);
    for (const e of edges.get(cur) ?? []) {
      const nd = best + e.sec;
      if (nd < (dist.get(e.room) ?? Infinity)) dist.set(e.room, nd);
    }
  }
  return null; // disconnected graph: no constraint
}

// ---------------------------------------------------------------------------
// Interval sets over [lo, hi] (closed intervals, sorted, non-overlapping)
// ---------------------------------------------------------------------------

export type Interval = [number, number];

/** Remove the OPEN interval (a, b) from a set of closed intervals. */
export function subtract(set: Interval[], a: number, b: number): Interval[] {
  if (b <= a) return set;
  const out: Interval[] = [];
  for (const [x, y] of set) {
    if (b <= x || a >= y) { out.push([x, y]); continue; }
    if (a > x) out.push([x, a]);
    if (b < y) out.push([b, y]);
  }
  return out.filter(([x, y]) => y - x > 0.5); // ignore sub-second slivers (the clock is not that precise)
}

export const totalLength = (set: Interval[]) => set.reduce((s, [x, y]) => s + (y - x), 0);

/** Players mentioned by an observation as physically present somewhere (not the victim of a kill). */
export function playersPlacedBy(o: Observation): PlayerId[] {
  switch (o.type) {
    case 'sighting': return [o.player, ...(o.withPlayers ?? [])];
    case 'withMe': case 'sawTask': case 'sawVent': return [o.player];
    case 'sawKill': return [o.killer];
    case 'bodyFound': return [...(o.reporter ? [o.reporter] : []), ...(o.present ?? [])];
    default: return [];
  }
}

/**
 * Subset of the maps agent's `MapInfo` (MapData.info) that the features read. Declared locally
 * because that type lives on the maps branch.
 * MERGE: replace with `import type { MapInfo } from '../../types/game'` and read `m.map.info` directly.
 */
export interface MapInfoLite {
  admin?: RoomId[];
  security?: { room: RoomId; kind: 'cameras' | 'binoculars'; covers: RoomId[] } | null;
  vitals?: RoomId | null;
  doorLog?: { room: RoomId; sensors: string[] } | null;
  emergencyButton?: RoomId;
  features?: string[];
  spawn?: { start: RoomId[]; afterMeeting: RoomId[] };
  dummyPanels?: { room: RoomId; taskId: string }[];
}

export const mapInfo = (map: MapData): MapInfoLite | undefined => (map as unknown as { info?: MapInfoLite }).info;

/** Index of the meeting that ended `round` (meeting k closes round k when every round ends in a meeting). */
export const meetingOfRound = (round: number) => round;
