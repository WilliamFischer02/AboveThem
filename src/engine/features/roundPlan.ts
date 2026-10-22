/**
 * Round plan (stretch #1): my tasks as a walking route, with the dangerous ones first.
 *
 * Tactic (relay/game-knowledge.md §3.1, grounded in the §1.2 cooldown fact): right after a meeting
 * — and in the first 10 s of the game — no impostor can kill until the cooldown runs out, so do
 * tasks in DEAD-END rooms (the classic kill spots) inside that window, then the rest by nearest
 * neighbour. Visual tasks are flagged "with witnesses"; with task bar = Always, finishing a
 * single-stage task in front of others is a free soft clear.
 *
 * Travel uses map.ts walking times (eyeballed, `_verified.durations` false) scaled by player speed.
 */
import type { MatchState, RoomId, MapTask, MyTask } from '../../types/game';
import { walkSeconds, isDeadEnd } from '../map';
import { cooldownForRound } from './killWindow';
import { roomName, mapInfo } from './util';

export interface PlanStop {
  taskId: string;
  name: string;
  room: RoomId;
  /** Round seconds when I arrive / finish (from the start room at t = startT). */
  arrive: number;
  finish: number;
  deadEnd: boolean;
  /** Finished before any impostor can kill. */
  safe: boolean;
  visual: boolean;
  note?: string;
}

export interface RoundPlan {
  start: RoomId | null;
  safeUntil: number;
  stops: PlanStop[];
  /** Tasks I could not place (multi-room task with no stage room read from the screen). */
  unplaced: string[];
  tips: string[];
}

/** Where a round starts: my last logged room, else the meeting room (Skeld/MIRA Cafeteria, Polus Office, Fungle Meeting Room). */
export function startRoom(m: MatchState, round: number): RoomId | null {
  for (let i = m.observations.length - 1; i >= 0; i--) {
    const o = m.observations[i];
    if (o.type === 'myRoom' && o.stamp.round === round) return o.room;
  }
  // Map data (maps agent): spawn rooms / emergency button. One candidate = certain; several = the player picks.
  const info = mapInfo(m.map);
  if (info) {
    const list = round === 0 ? info.spawn?.start : info.spawn?.afterMeeting ?? (info.emergencyButton ? [info.emergencyButton] : undefined);
    if (list && list.length === 1) return list[0];
    if (list && list.length > 1) return null;
  }
  const want = m.map.id === 'polus' ? 'office' : m.map.id === 'fungle' ? 'meeting' : m.map.id === 'airship' ? null : 'cafeteria';
  if (!want) return null; // Airship: you pick a spawn — log your room
  return m.map.rooms.find(r => r.id.toLowerCase().includes(want) || r.name.toLowerCase().includes(want))?.id ?? null;
}

const done = (t: MyTask) => { const mm = t.progress?.match(/(\d+)\s*\/\s*(\d+)/); return !!mm && mm[1] === mm[2]; };

export function roundPlan(m: MatchState, round: number, startT = 0): RoundPlan {
  const safeUntil = cooldownForRound(m, round);
  const start = startRoom(m, round);
  const speed = m.settings.playerSpeed || 1;
  const tips: string[] = [];
  const unplaced: string[] = [];
  const todo: { task: MapTask; room: RoomId }[] = [];
  const known = new Set(m.map.rooms.map(r => r.id));
  for (const t of m.myTasks ?? []) {
    if (!t.matched || done(t)) continue;
    const task = m.map.tasks.find(x => x.id === t.id);
    if (!task) continue;
    const room = t.room && task.rooms.includes(t.room) ? t.room : task.rooms.length === 1 ? task.rooms[0] : null;
    if (!room || !known.has(room)) { unplaced.push(task.name); continue; }
    todo.push({ task, room });
  }
  if (!start) return { start, safeUntil, stops: [], unplaced: [...todo.map(x => x.task.name), ...unplaced], tips: ['Log your room (my-room hotkey) to get a route'] };

  const stops: PlanStop[] = [];
  let at = start, t = startT;
  const take = (i: number) => {
    const { task, room } = todo.splice(i, 1)[0];
    const walk = walkSeconds(m.map, at, room, speed);
    const arrive = t + (Number.isFinite(walk) ? walk : 0);
    const finish = arrive + task.stageDurationSec;
    const deadEnd = isDeadEnd(m.map, room);
    stops.push({ taskId: task.id, name: task.name, room, arrive, finish, deadEnd, safe: finish <= safeUntil, visual: task.visual && m.settings.visualTasksOn });
    at = room; t = finish;
  };
  const nearest = (pred: (x: { task: MapTask; room: RoomId }) => boolean) => {
    let best = -1, bd = Infinity;
    todo.forEach((x, i) => { if (!pred(x)) return; const d = walkSeconds(m.map, at, x.room, speed); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  // Phase 1: dead-end tasks that can be finished inside the safe window.
  for (;;) {
    const i = nearest(x => isDeadEnd(m.map, x.room) && t + walkSeconds(m.map, at, x.room, speed) + x.task.stageDurationSec <= safeUntil);
    if (i < 0) break;
    take(i);
  }
  // Phase 2: everything else, nearest first.
  while (todo.length) { const i = nearest(() => true); take(i < 0 ? 0 : i); }

  for (const s of stops) {
    if (s.visual) s.note = 'visual: do it with someone watching';
    else if (s.deadEnd && !s.safe) s.note = 'dead end after the cooldown: go with someone or skip it for now';
  }
  if (m.settings.taskBarMode === 'always') {
    const first = stops.find(s => (m.map.tasks.find(x => x.id === s.taskId)?.stages ?? 2) === 1);
    if (first) tips.push(`Bar = Always: finish ${first.name} in front of someone early — the bar jump is a soft clear`);
  }
  if (stops.some(s => s.safe && s.deadEnd)) tips.push(`Kills impossible until ${Math.round(safeUntil)} s: dead-end tasks first`);
  if (!m.map._verified.durations) tips.push('ETAs use eyeballed walk/task times');
  return { start, safeUntil, stops, unplaced, tips };
}

export const describeStop = (m: MatchState, s: PlanStop) => `${s.name} (${roomName(m, s.room)})`;
