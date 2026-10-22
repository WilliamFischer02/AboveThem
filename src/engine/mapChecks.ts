/**
 * Map-aware lie checks. Pure functions over MapData + what the local player saw on their own screen
 * (task list, Admin table, Vitals, Doorlog). Each result carries a human `text` for the evidence line and
 * `shaky` when it leans on unverified map data. None of them is a verdict: callers turn them into evidence.
 *
 * Fail soft everywhere: unknown map / unknown task / missing reads → `null` or `{ ok: true }`, never an accusation.
 */
import type { MapData, MapId, MapTask, MyTask, PlayerId, RoomId } from '../types/game';
import { hasMapData, walkPath } from './map';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function similarity(a: string, b: string): number {
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

/** Map task by id or (fuzzy) name; "Download Data" / "Upload Data" resolve to the Download / Upload task. */
export function findTask(map: MapData, nameOrId: string): MapTask | null {
  if (!nameOrId) return null;
  const byId = map.tasks.find(t => t.id === nameOrId);
  if (byId) return byId;
  const n = norm(nameOrId).replace(/^(download|upload)data$/, 'downloaduploaddata');
  let best: { t: MapTask; s: number } | null = null;
  for (const t of map.tasks) {
    const k = norm(t.name);
    const s = k === n ? 1 : k.includes(n) && n.length >= 6 ? 0.9 : similarity(n, k);
    if (!best || s > best.s) best = { t, s };
  }
  return best && best.s >= 0.75 ? best.t : null;
}

export const roomName = (map: MapData, id: RoomId) => map.rooms.find(r => r.id === id)?.name ?? id;

export interface TaskClaimCheck {
  ok: boolean;
  reason: 'ok' | 'unknownMap' | 'unknownTask' | 'notOnMap' | 'notInRoom' | 'dummyPanel';
  task?: MapTask;
  /** Rooms where the task can actually be done (for notInRoom). */
  rooms?: RoomId[];
  /** Other maps that do have this task (for notOnMap: "that's a Skeld task"). */
  otherMaps?: MapId[];
  text: string;
  shaky: boolean;
}

/**
 * "I did TASK in ROOM": does that task exist on this map, in that room, and is the panel real?
 * `otherMaps` (optional) lets a missing task be named as belonging to another map.
 */
export function claimedTaskExists(map: MapData, taskName: string, room?: RoomId | null, otherMaps: MapData[] = []): TaskClaimCheck {
  const shaky = !map._verified?.tasks;
  if (!hasMapData(map) || !map.tasks.length) return { ok: true, reason: 'unknownMap', text: 'No task data for this map', shaky: true };
  const task = findTask(map, taskName);
  if (!task) {
    const elsewhere = otherMaps.filter(m => m.id !== map.id && findTask(m, taskName)).map(m => m.id);
    if (elsewhere.length) {
      const other = otherMaps.find(m => m.id === elsewhere[0])!;
      return { ok: false, reason: 'notOnMap', otherMaps: elsewhere, text: `"${findTask(other, taskName)!.name}" is not a task on ${map.name} (it exists on ${elsewhere.map(id => otherMaps.find(m => m.id === id)!.name).join(', ')})`, shaky };
    }
    return { ok: true, reason: 'unknownTask', text: `Unrecognised task "${taskName}"`, shaky: true };
  }
  if (room) {
    const dummy = map.info?.dummyPanels?.find(d => d.room === room && d.taskId === task.id);
    if (dummy) return { ok: false, reason: 'dummyPanel', task, rooms: task.rooms, text: `The ${task.name} panel in ${roomName(map, room)} is a dummy — it can't be done`, shaky };
    if (!map.rooms.some(r => r.id === room)) return { ok: true, reason: 'ok', task, text: `${task.name}`, shaky: true };
    if (!task.rooms.includes(room)) return { ok: false, reason: 'notInRoom', task, rooms: task.rooms, text: `${task.name} is not in ${roomName(map, room)} on ${map.name} (it's in ${task.rooms.map(r => roomName(map, r)).join(', ')})`, shaky };
  }
  return { ok: true, reason: 'ok', task, text: `${task.name}${room ? ` in ${roomName(map, room)}` : ''} exists`, shaky };
}

export interface CommonTaskCheck {
  mismatch: boolean;
  task: MapTask;
  text: string;
  shaky: boolean;
}

/**
 * Common tasks are identical for everyone (impostor fake lists included). If someone claims a COMMON task that is
 * not on my own list, the claim is false. Needs my task list (read from the screen); returns null when it can't judge
 * (no list yet, task unknown / not common, or the list has unmatched lines that might be that task).
 */
export function commonTaskMismatch(map: MapData, myTasks: MyTask[] | undefined, claimedTask: string): CommonTaskCheck | null {
  if (!hasMapData(map) || !myTasks || myTasks.length === 0) return null;
  const task = findTask(map, claimedTask);
  if (!task || task.kind !== 'common') return null;
  const have = myTasks.some(t => t.id === task.id || (t.matched === false && similarity(norm(t.name), norm(task.name)) >= 0.6));
  if (have) return { mismatch: false, task, text: `${task.name} is common — I have it too`, shaky: false };
  // An unreadable line could hide the task: only judge when every line matched a map task.
  if (myTasks.some(t => !t.matched)) return null;
  return { mismatch: true, task, text: `${task.name} is a common task and it's not on my list — nobody has it this game`, shaky: !map._verified?.tasks };
}

// ---------------------------------------------------------------------------
// Monitor reads (Admin / Vitals / Doorlog) against claims
// ---------------------------------------------------------------------------

/** What the local player saw on the Admin table: icon counts per room at round time `t`. */
export interface AdminRead { kind: 'admin'; t: number; counts: Partial<Record<RoomId, number>> }
/** Vitals at round time `t`. */
export interface VitalsRead { kind: 'vitals'; t: number; status: Partial<Record<PlayerId, 'alive' | 'dead' | 'dc'>> }
/** MIRA Doorlog entries (who crossed which Hallway sensor, round time). Only living players are logged. */
export interface DoorLogRead { kind: 'doorLog'; from: number; to: number; entries: { player: PlayerId; t: number; sensor?: string }[] }
export type MonitorRead = AdminRead | VitalsRead | DoorLogRead;

/**
 * A claim to test: "player was in `room` around `t`", optionally "and walked there from `fromRoom`",
 * or "`about` was alive at `t`".
 */
export interface MonitorClaim { player: PlayerId; room?: RoomId; fromRoom?: RoomId; t: number; about?: PlayerId; aboutAlive?: boolean }

export interface MonitorCheck { contradiction: boolean; reason: string; text: string; shaky: boolean }

/**
 * Structural shapes of the features agent's monitor observations (typed here so this compiles without their branch):
 * `AdminReadObs {type:'adminRead', counts, bodies?}`, `VitalsReadObs {type:'vitalsRead', dead, alive, dc?}`,
 * `DoorLogReadObs {type:'doorLogRead', entries, from, to}`. Round time comes from `stamp.t`.
 */
export type MonitorObsLike =
  | { type: 'adminRead'; stamp?: { t: number }; counts: Partial<Record<RoomId, number>>; bodies?: RoomId[] }
  | { type: 'vitalsRead'; stamp?: { t: number }; dead: PlayerId[]; alive: PlayerId[]; dc?: PlayerId[] }
  | { type: 'doorLogRead'; stamp?: { t: number }; entries: { player: PlayerId; t: number; sensor?: string }[]; from: number; to: number };

/** Convert a logged monitor observation into the `read` shape `monitorContradiction` takes (null for anything else). */
export function monitorReadFromObs(o: { type: string } & Record<string, unknown>): MonitorRead | null {
  const ob = o as MonitorObsLike;
  // No round time = we can't line the read up with any claim (a 0 fallback compared it with the round start).
  const t = typeof ob.stamp?.t === 'number' && Number.isFinite(ob.stamp.t) ? ob.stamp.t : NaN;
  if (Number.isNaN(t) && (ob.type === 'adminRead' || ob.type === 'vitalsRead')) return null;
  if (ob.type === 'adminRead') return { kind: 'admin', t, counts: { ...(ob.counts ?? {}) } };
  if (ob.type === 'vitalsRead') {
    const status: Partial<Record<PlayerId, 'alive' | 'dead' | 'dc'>> = {};
    for (const p of ob.alive ?? []) status[p] = 'alive';
    for (const p of ob.dead ?? []) status[p] = 'dead';
    for (const p of ob.dc ?? []) status[p] = 'dc';
    return { kind: 'vitals', t, status };
  }
  if (ob.type === 'doorLogRead') return { kind: 'doorLog', from: ob.from, to: ob.to, entries: [...(ob.entries ?? [])] };
  return null;
}

/** Seconds either side of a read in which a location claim counts as "the same moment". */
export const MONITOR_WINDOW_SEC = 4;

export function monitorContradiction(map: MapData, read: MonitorRead, claim: MonitorClaim): MonitorCheck | null {
  if (!hasMapData(map)) return null;
  // NaN times slip through every window comparison (NaN > x is false) and would end in a contradiction.
  if (!Number.isFinite(claim.t)) return null;
  if (read.kind === 'doorLog' ? !(Number.isFinite(read.from) && Number.isFinite(read.to)) : !Number.isFinite(read.t)) return null;
  const info = map.info;
  if (read.kind === 'admin') {
    if (info && info.admin.length === 0) return { contradiction: false, reason: 'noAdminOnMap', text: `${map.name} has no Admin table — an "admin" read is not possible`, shaky: false };
    if (!claim.room || read.counts[claim.room] === undefined) return null;
    if (Math.abs(read.t - claim.t) > MONITOR_WINDOW_SEC) return null;
    if ((read.counts[claim.room] ?? 0) === 0) return { contradiction: true, reason: 'adminEmpty', text: `Admin showed nobody in ${roomName(map, claim.room)} at ${Math.round(read.t)} s`, shaky: false };
    return { contradiction: false, reason: 'adminOccupied', text: `Admin showed ${read.counts[claim.room]} in ${roomName(map, claim.room)}`, shaky: false };
  }
  if (read.kind === 'vitals') {
    if (info && info.vitals === null) return { contradiction: false, reason: 'noVitalsOnMap', text: `${map.name} has no Vitals (only a Scientist could know)`, shaky: false };
    if (claim.about && claim.aboutAlive) {
      const st = read.status[claim.about];
      if ((st === 'dead' || st === 'dc') && read.t <= claim.t) return { contradiction: true, reason: 'aliveAfterDeath', text: `Vitals showed them ${st === 'dead' ? 'DEAD' : 'D/C'} at ${Math.round(read.t)} s, before the claimed sighting at ${Math.round(claim.t)} s`, shaky: false };
    }
    const own = read.status[claim.player];
    if ((own === 'dead' || own === 'dc') && read.t <= claim.t) return { contradiction: true, reason: 'claimerDead', text: `Vitals showed the speaker ${own} at ${Math.round(read.t)} s`, shaky: false };
    return null;
  }
  // Doorlog (MIRA): walking between rooms on different sides of the Hallway passes a sensor.
  if (!info?.doorLog) return { contradiction: false, reason: 'noDoorLogOnMap', text: `${map.name} has no Doorlog`, shaky: false };
  if (!claim.room || !claim.fromRoom || claim.room === claim.fromRoom) return null;
  if (claim.t < read.from || claim.t > read.to) return null;
  const path = walkPath(map, claim.fromRoom, claim.room);
  if (!path.includes('hallway')) return null;
  const logged = read.entries.some(e => e.player === claim.player && e.t >= read.from && e.t <= read.to);
  if (logged) return { contradiction: false, reason: 'doorLogSeen', text: 'Doorlog shows them crossing the Hallway', shaky: true };
  // A vent path avoids the sensors, so this is evidence, not proof.
  return { contradiction: true, reason: 'doorLogMissing', text: `Walking ${roomName(map, claim.fromRoom)} → ${roomName(map, claim.room)} crosses the Hallway sensors, but the Doorlog has no entry for them (vents skip the sensors)`, shaky: true };
}
