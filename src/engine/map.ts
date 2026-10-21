/**
 * Map geometry helpers. Pure functions over MapData.
 */
import type { MapData, RoomId } from '../types/game';

/** Shortest walking time between rooms (seconds, speed 1.0). Dijkstra over adjacency. */
export function walkSeconds(map: MapData, from: RoomId, to: RoomId, speed = 1): number {
  if (from === to) return 0;
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
    const room = map.rooms.find(r => r.id === cur)!;
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
