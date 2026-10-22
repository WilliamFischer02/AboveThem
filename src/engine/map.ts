/**
 * Map geometry helpers. Pure functions over MapData.
 */
import type { MapData, MapId, RoomId } from '../types/game';

/**
 * Shortest walking time between rooms (seconds, speed 1.0). Dijkstra over adjacency.
 * A room the map does not know ('unknown', a stub map, a typo) returns 0 = "could be anywhere": callers
 * compare this against a time gap to accuse, so missing data must never look like "too far" (fail soft).
 * It used to throw for an unknown `from` and return Infinity (= contradiction) for an unknown `to`.
 */
export function walkSeconds(map: MapData, from: RoomId, to: RoomId, speed = 1): number {
  if (from === to) return 0;
  if (!map.rooms.some(r => r.id === from) || !map.rooms.some(r => r.id === to)) return 0;
  if (!(speed > 0) || !Number.isFinite(speed)) speed = 1;
  const dist = new Map<RoomId, number>();
  const done = new Set<RoomId>();
  for (const r of map.rooms) dist.set(r.id, Infinity);
  dist.set(from, 0);
  while (done.size < map.rooms.length) {
    let cur: RoomId | null = null;
    let best = Infinity;
    for (const [r, d] of dist) if (!done.has(r) && d < best) { best = d; cur = r; }
    if (cur === null || best === Infinity) break;
    done.add(cur);
    if (cur === to) break;
    const room = map.rooms.find(r => r.id === cur);
    if (!room) continue;
    for (const adj of room.adjacent) {
      const nd = best + adj.sec / speed;
      if (nd < (dist.get(adj.room) ?? Infinity)) dist.set(adj.room, nd);
    }
  }
  return dist.get(to) ?? Infinity;
}

/** True if a vent network connects the two rooms directly. */
export function ventConnected(map: MapData, a: RoomId, b: RoomId): boolean {
  return map.vents.some(v => v.rooms.includes(a) && v.rooms.includes(b));
}

/** Could a player seen in `from` at time t0 be in `to` by t1 on foot? */
export function reachableOnFoot(map: MapData, from: RoomId, to: RoomId, t0: number, t1: number, speed = 1): boolean {
  return walkSeconds(map, from, to, speed) <= Math.max(0, t1 - t0);
}

export function tasksInRoom(map: MapData, room: RoomId) {
  return map.tasks.filter(t => t.rooms.includes(room));
}

export function taskExistsInRoom(map: MapData, taskId: string, room: RoomId): boolean {
  const t = map.tasks.find(x => x.id === taskId);
  return !!t && t.rooms.includes(room);
}

export function isDeadEnd(map: MapData, room: RoomId): boolean {
  return map.rooms.find(r => r.id === room)?.deadEnd ?? false;
}

// ===========================================================================
// Added by the maps agent (2026-10-22). Pure, additive; see docs/notes/maps.md.
// ===========================================================================

/** True when the map has usable room data (a stub has none: room-based rules must stand down). */
export function hasMapData(map: MapData | null | undefined): map is MapData {
  return !!map && Array.isArray(map.rooms) && map.rooms.length > 0;
}

/** Rough seconds for one vent hop (jump in, move one vent, jump out). Unverified: the animations are ~1 s each. */
export const VENT_HOP_SEC = 2;

/** Single vent hops as room pairs: the network's `links` when known, else every pair inside the network. */
export function ventLinks(map: MapData): [RoomId, RoomId][] {
  const out: [RoomId, RoomId][] = [];
  for (const v of map.vents ?? []) {
    if (v.links && v.links.length) { for (const [a, b] of v.links) if (a !== b) out.push([a, b]); continue; }
    for (let i = 0; i < v.rooms.length; i++) for (let j = i + 1; j < v.rooms.length; j++) out.push([v.rooms[i], v.rooms[j]]);
  }
  return out;
}

/** Rooms one vent hop away from `room`. */
export function ventNeighbours(map: MapData, room: RoomId): RoomId[] {
  const s = new Set<RoomId>();
  for (const [a, b] of ventLinks(map)) { if (a === room) s.add(b); if (b === room) s.add(a); }
  s.delete(room);
  return [...s];
}

/** Every room an impostor can reach from `room` without walking (any number of vent hops). Excludes `room`. */
export function ventReachable(map: MapData, room: RoomId): RoomId[] {
  const seen = new Set<RoomId>([room]);
  const queue = [room];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of ventNeighbours(map, cur)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  seen.delete(room);
  return [...seen];
}

export interface TravelMatrix {
  ids: RoomId[];
  index: Record<RoomId, number>;
  /** sec[i][j] = fastest seconds from ids[i] to ids[j] (Infinity when unreachable). */
  sec: number[][];
}

const matrixCache = new WeakMap<MapData, Map<string, TravelMatrix>>();

/**
 * All-pairs fastest travel (Floyd–Warshall). `vents: true` adds vent hops at `ventHopSec` each (impostor movement);
 * walking edges are divided by `speed`. Cached per map object + options.
 */
export function travelMatrix(map: MapData, opts: { speed?: number; vents?: boolean; ventHopSec?: number } = {}): TravelMatrix {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const vents = !!opts.vents;
  const hop = opts.ventHopSec ?? VENT_HOP_SEC;
  const key = `${speed}|${vents}|${hop}`;
  let perMap = matrixCache.get(map);
  if (!perMap) { perMap = new Map(); matrixCache.set(map, perMap); }
  const hit = perMap.get(key);
  if (hit) return hit;
  const ids = map.rooms.map(r => r.id);
  const index: Record<RoomId, number> = {};
  ids.forEach((id, i) => { index[id] = i; });
  const n = ids.length;
  const sec = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const relax = (a: RoomId, b: RoomId, s: number) => {
    const i = index[a], j = index[b];
    if (i === undefined || j === undefined) return;
    if (s < sec[i][j]) sec[i][j] = s;
  };
  for (const r of map.rooms) for (const adj of r.adjacent) relax(r.id, adj.room, adj.sec / speed);
  if (vents) for (const [a, b] of ventLinks(map)) { relax(a, b, hop); relax(b, a, hop); }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const ik = sec[i][k];
    if (ik === Infinity) continue;
    for (let j = 0; j < n; j++) { const d = ik + sec[k][j]; if (d < sec[i][j]) sec[i][j] = d; }
  }
  const m = { ids, index, sec };
  perMap.set(key, m);
  return m;
}

/** Fastest seconds from one room to another (Infinity if unknown rooms / unreachable). */
export function fastestSeconds(map: MapData, from: RoomId, to: RoomId, opts: { speed?: number; vents?: boolean; ventHopSec?: number } = {}): number {
  if (from === to) return 0;
  const m = travelMatrix(map, opts);
  const i = m.index[from], j = m.index[to];
  if (i === undefined || j === undefined) return Infinity;
  return m.sec[i][j];
}

/**
 * Could someone seen in `from` be in `to` within `seconds`? With `vents: true` it answers for an impostor.
 * Unknown rooms / stub maps return true (fail soft: never accuse on missing data).
 */
export function couldReach(map: MapData, from: RoomId, to: RoomId, seconds: number, opts: { speed?: number; vents?: boolean; ventHopSec?: number; slackSec?: number } = {}): boolean {
  if (!hasMapData(map)) return true;
  if (Number.isNaN(seconds)) return true; // unknown time gap: never "couldn't have got there"
  const t = fastestSeconds(map, from, to, opts);
  if (t === Infinity) return !(from in travelMatrix(map, opts).index && to in travelMatrix(map, opts).index);
  return t <= Math.max(0, seconds) + (opts.slackSec ?? 0);
}

/**
 * Vent-based lie check: if someone claims `claimRoom` while the body was in `bodyRoom`, a vent path makes
 * "I was far away" weak. Returns a short human note (or null) — evidence text, never a verdict.
 */
export function ventShortcutNote(map: MapData, claimRoom: RoomId, bodyRoom: RoomId): string | null {
  if (!hasMapData(map) || claimRoom === bodyRoom) return null;
  const name = (id: RoomId) => map.rooms.find(r => r.id === id)?.name ?? id;
  const walk = fastestSeconds(map, claimRoom, bodyRoom);
  const vent = fastestSeconds(map, claimRoom, bodyRoom, { vents: true });
  if (vent === Infinity || vent >= walk - 1) return null;
  const direct = ventNeighbours(map, claimRoom).includes(bodyRoom);
  const walkTxt = walk === Infinity ? 'no walking path' : `~${Math.round(walk)} s on foot`;
  return `${name(claimRoom)} → ${name(bodyRoom)}: ${direct ? 'one vent hop' : 'vent path'} (~${Math.round(vent)} s) vs ${walkTxt}`;
}

/** Map-name OCR (lobby panel logo, chat, settings line) → MapId. Tolerates the usual OCR swaps (1/I, 0/O, Q/O). */
export function mapIdFromText(text: string | null | undefined): MapId | null {
  if (!text) return null;
  const t = text.toUpperCase()
    .replace(/[0]/g, 'O').replace(/[1|!]/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B')
    .replace(/ROOM\s*SETTINGS|ROOM\s*CODE|GAME\s*SETTINGS|CAPACITY|PRESET|PRIVACY/g, ' ')
    .replace(/[^A-Z]/g, '');
  if (!t) return null;
  // Exact keywords first (substring), most specific first.
  const exact: [string, MapId][] = [['SKELD', 'skeld'], ['MIRAHQ', 'mira'], ['MIRAHO', 'mira'], ['MIRA', 'mira'], ['POLUS', 'polus'], ['AIRSHIP', 'airship'], ['FUNGLE', 'fungle']];
  for (const [k, id] of exact) if (t.includes(k)) return id;
  // One OCR error allowed for the longer words (approximate substring match).
  const approx: [string, MapId][] = [['SKELD', 'skeld'], ['MIRAHQ', 'mira'], ['POLUS', 'polus'], ['AIRSHIP', 'airship'], ['FUNGLE', 'fungle']];
  let best: { id: MapId; d: number } | null = null;
  for (const [k, id] of approx) {
    const d = approxSubstringDistance(k, t);
    if (d <= 1 && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}

/** Minimum edit distance between `pattern` and any substring of `text` (Sellers). */
function approxSubstringDistance(pattern: string, text: string): number {
  let prev = Array.from({ length: pattern.length + 1 }, (_, i) => i);
  let best = prev[pattern.length];
  for (let j = 1; j <= text.length; j++) {
    const cur = [0];
    for (let i = 1; i <= pattern.length; i++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + cost);
    }
    best = Math.min(best, cur[pattern.length]);
    prev = cur;
  }
  return best;
}

const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function labelSimilarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

export interface MapGuess { map: MapId; score: number; runnerUp: number; hits: string[] }

/**
 * Guess the map from on-screen labels (room-name popups, task-list lines like "Laboratory: Fix Weather Node (0/2)").
 * Only names that exist on SOME maps but not all count; a name on k maps adds 1/k to each. Returns null unless
 * the leader is ahead by ≥ 1 point (so one ambiguous label never flips the map).
 */
export function inferMapFromLabels(labels: string[], maps: MapData[]): MapGuess | null {
  const usable = maps.filter(hasMapData);
  if (usable.length < 2) return null;
  const index = new Map<string, Set<MapId>>();
  const add = (name: string, id: MapId) => { const k = normLabel(name); if (k.length < 3) return; if (!index.has(k)) index.set(k, new Set()); index.get(k)!.add(id); };
  for (const m of usable) {
    for (const r of m.rooms) { add(r.name, m.id); for (const a of r.aliases ?? []) add(a, m.id); }
    for (const t of m.tasks) add(t.name, m.id);
  }
  const score: Partial<Record<MapId, number>> = {};
  const hits: string[] = [];
  for (const raw of labels) {
    const parts = raw.replace(/\(.*?\)/g, ' ').split(/[:;]/).map(normLabel).filter(p => p.length >= 3);
    for (const p of parts) {
      let best: { key: string; s: number } | null = null;
      for (const key of index.keys()) { const s = labelSimilarity(p, key); if (s >= 0.8 && (!best || s > best.s)) best = { key, s }; }
      if (!best) continue;
      const set = index.get(best.key)!;
      if (set.size >= usable.length) continue;
      for (const id of set) score[id] = (score[id] ?? 0) + 1 / set.size;
      hits.push(best.key);
    }
  }
  const ranked = (Object.entries(score) as [MapId, number][]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [top, s1] = ranked[0];
  const s2 = ranked[1]?.[1] ?? 0;
  if (s1 - s2 < 1) return null;
  return { map: top, score: s1, runnerUp: s2, hits };
}

/** Rooms on the fastest walking route from `from` to `to`, both ends included ([] if unknown / unreachable). */
export function walkPath(map: MapData, from: RoomId, to: RoomId): RoomId[] {
  const ids = new Set(map.rooms.map(r => r.id));
  if (!ids.has(from) || !ids.has(to)) return [];
  if (from === to) return [from];
  const dist = new Map<RoomId, number>([[from, 0]]);
  const prev = new Map<RoomId, RoomId>();
  const done = new Set<RoomId>();
  while (done.size < ids.size) {
    let cur: RoomId | null = null; let best = Infinity;
    for (const [r, d] of dist) if (!done.has(r) && d < best) { best = d; cur = r; }
    if (cur === null) break;
    done.add(cur);
    if (cur === to) break;
    for (const adj of map.rooms.find(r => r.id === cur)!.adjacent) {
      const nd = best + adj.sec;
      if (nd < (dist.get(adj.room) ?? Infinity)) { dist.set(adj.room, nd); prev.set(adj.room, cur); }
    }
  }
  if (!prev.has(to)) return [];
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

/** Structural problems in a map file (empty array = valid). Used by the data tests; cheap enough for a debug panel. */
export function validateMap(map: MapData): string[] {
  const errs: string[] = [];
  const ids = new Set<RoomId>();
  const keys = new Set<string>();
  const RESERVED = new Set(['v', 'k', 'z']);
  for (const r of map.rooms) {
    if (ids.has(r.id)) errs.push(`duplicate room id ${r.id}`);
    ids.add(r.id);
    if (r.key.length !== 1) errs.push(`room ${r.id}: key must be one character`);
    if (RESERVED.has(r.key.toLowerCase())) errs.push(`room ${r.id}: key ${r.key} is a reserved action key`);
    if (keys.has(r.key.toLowerCase())) errs.push(`duplicate room key ${r.key}`);
    keys.add(r.key.toLowerCase());
    if (typeof r.deadEnd !== 'boolean') errs.push(`room ${r.id}: deadEnd missing`);
  }
  for (const r of map.rooms) {
    for (const a of r.adjacent) {
      if (!ids.has(a.room)) { errs.push(`room ${r.id}: adjacent ${a.room} does not exist`); continue; }
      if (a.room === r.id) errs.push(`room ${r.id}: adjacent to itself`);
      if (!(a.sec > 0)) errs.push(`room ${r.id} -> ${a.room}: sec must be > 0`);
      const back = map.rooms.find(x => x.id === a.room)!.adjacent.find(x => x.room === r.id);
      if (!back) errs.push(`adjacency ${r.id} -> ${a.room} is not symmetric`);
      else if (back.sec !== a.sec) errs.push(`adjacency ${r.id} <-> ${a.room}: ${a.sec} s vs ${back.sec} s`);
    }
  }
  if (map.rooms.length) {
    const m = travelMatrix(map);
    for (let j = 1; j < m.ids.length; j++) if (m.sec[0][j] === Infinity) errs.push(`room ${m.ids[j]} unreachable on foot from ${m.ids[0]}`);
  }
  for (const v of map.vents) {
    for (const r of v.rooms) if (!ids.has(r)) errs.push(`vent ${v.id}: room ${r} does not exist`);
    for (const [a, b] of v.links ?? []) if (!v.rooms.includes(a) || !v.rooms.includes(b)) errs.push(`vent ${v.id}: link ${a}-${b} outside its rooms`);
  }
  const taskIds = new Set<string>();
  for (const t of map.tasks) {
    if (taskIds.has(t.id)) errs.push(`duplicate task id ${t.id}`);
    taskIds.add(t.id);
    if (typeof t.visual !== 'boolean') errs.push(`task ${t.id}: visual flag missing`);
    if (!['common', 'short', 'long'].includes(t.kind)) errs.push(`task ${t.id}: bad kind ${t.kind}`);
    if (!t.rooms.length) errs.push(`task ${t.id}: no rooms`);
    for (const r of t.rooms) if (!ids.has(r)) errs.push(`task ${t.id}: room ${r} does not exist`);
    if (!(t.stages >= 1)) errs.push(`task ${t.id}: stages must be >= 1`);
  }
  const info = map.info;
  if (info) {
    const check = (what: string, r: RoomId | null | undefined) => { if (r && !ids.has(r)) errs.push(`info.${what}: room ${r} does not exist`); };
    info.admin.forEach(r => check('admin', r));
    check('security', info.security?.room);
    info.security?.covers.forEach(r => check('security.covers', r));
    check('vitals', info.vitals);
    check('doorLog', info.doorLog?.room);
    check('emergencyButton', info.emergencyButton);
    for (const [k, rs] of Object.entries(info.sabotageRooms ?? {})) (rs ?? []).forEach(r => check(`sabotageRooms.${k}`, r));
    for (const s of info.shortcuts ?? []) { check('shortcuts', s.from); check('shortcuts', s.to); }
    info.spawn?.start.forEach(r => check('spawn.start', r));
    info.spawn?.afterMeeting.forEach(r => check('spawn.afterMeeting', r));
    for (const d of info.dummyPanels ?? []) check('dummyPanels', d.room);
  }
  return errs;
}
