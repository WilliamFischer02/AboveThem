/**
 * Shared helpers for src/engine/features/*. Pure TS (no DOM / React / Tauri).
 */
import type { MapData, MapInfo, MatchState, Observation, PlayerId, RoomId } from '../../types/game';
import { fastestSeconds } from '../map';

export const pname = (m: MatchState, p: PlayerId): string => m.players[p]?.name ?? p;
export const roomName = (m: MatchState, r: RoomId): string => m.map.rooms.find(x => x.id === r)?.name ?? r;

/**
 * Map walk times are eyeballed (`_verified.durations` false on every map); the research relay
 * says "impossible travel" verdicts need ≥ 30 % slack. Every feature exclusion multiplies travel
 * by this factor, so a "could not" only stands when they would have needed to be 30 % faster.
 */
export const TRAVEL_SLACK = 0.7;

/**
 * Fastest possible travel time for an IMPOSTOR between two rooms (walking + vent hops), from the
 * maps agent's engine/map.ts `fastestSeconds(..., { vents: true })`.
 * Returns null when either room is unknown to the map: callers treat null as "no constraint",
 * never as "unreachable".
 */
export function impostorTravelSec(map: MapData, from: RoomId, to: RoomId, speed = 1): number | null {
  if (from === to) return 0;
  const s = fastestSeconds(map, from, to, { speed: speed > 0 ? speed : 1, vents: true });
  return Number.isFinite(s) ? s : null;
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

/** The maps agent's MapData.info (stations, spawn, dummy panels), when the map file has it. */
export const mapInfo = (map: MapData): Partial<MapInfo> | undefined => map.info;

/** Index of the meeting that ended `round` (meeting k closes round k when every round ends in a meeting). */
export const meetingOfRound = (round: number) => round;
