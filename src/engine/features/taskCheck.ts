/**
 * Task-bar tracker + task-claim verifier (features #6, plus lie checks from
 * relay/game-knowledge.md §2a: common_not_dealt, task_not_in_room, visual_unseen,
 * visual_off_clear / visual_wrong_map, bar_no_move / bar_moved_alone).
 *
 * Display-only: the suspicion engine already scores task_not_in_room / common claims
 * (contradictions.ts); this module answers "which claimed tasks are plausibly real?" per claim,
 * with the evidence ids, so the player can see it at a glance and ask the right question.
 *
 * Facts used (wiki via research): common tasks are identical for every crewmate (and an impostor's
 * fake list shows the same commons); multi-stage tasks move the bar only on the FINAL stage; the
 * bar moves on completion only when task bar = Always; a visual task proves crew only with visuals
 * ON and only on maps where that task is visual (map JSON `visual`).
 */
import type { Claim, MatchState, PlayerId, RoomId, SawTaskObs, Stamp, MapTask } from '../../types/game';
import { pname, roomName } from './util';

// ---------------------------------------------------------------------------
// Task-bar tracker
// ---------------------------------------------------------------------------

/** Who I am most plausibly watching right now: an open with-me, else the latest placement ≤ 20 s old. */
export function watchedPlayer(m: MatchState, now: Stamp): { player: PlayerId; room: RoomId } | null {
  const round = now.round;
  const on = new Map<PlayerId, RoomId>();
  for (const o of m.observations) if (o.type === 'withMe' && o.stamp.round === round) { if (o.on) on.set(o.player, o.room); else on.delete(o.player); }
  let best: { player: PlayerId; room: RoomId; t: number } | null = null;
  for (const o of m.observations) {
    if (o.stamp.round !== round || now.t - o.stamp.t > 20) continue;
    if ((o.type === 'sighting' || o.type === 'sawTask') && o.player !== m.me && (!best || o.stamp.t >= best.t)) best = { player: o.player, room: o.room, t: o.stamp.t };
  }
  if (best) return { player: best.player, room: best.room };
  const last = [...on.entries()].pop();
  return last ? { player: last[0], room: last[1] } : null;
}

/** One tap: "the bar moved / did not move as they finished" → a sawTask observation. */
export function taskBarObservation(player: PlayerId, room: RoomId, moved: boolean, taskId?: string): Pick<SawTaskObs, 'type' | 'player' | 'room' | 'visualConfirmed' | 'taskBarMoved' | 'taskId'> {
  return taskId ? { type: 'sawTask', player, room, visualConfirmed: false, taskBarMoved: moved, taskId } : { type: 'sawTask', player, room, visualConfirmed: false, taskBarMoved: moved };
}

// ---------------------------------------------------------------------------
// Claim verifier
// ---------------------------------------------------------------------------

export type TaskVerdict = 'fake' | 'clearInvalid' | 'suspect' | 'confirmed' | 'checkable' | 'plausible';

export interface TaskClaimCheck {
  claimId: string;
  by: PlayerId;
  about?: PlayerId;
  taskId: string;
  taskName: string;
  room?: RoomId;
  verdict: TaskVerdict;
  /** Lie-check id from data/tactics/lieChecks.json (research catalogue), when one applies. */
  check?: string;
  line: string;
  /** A ≤ 70-char question to paste in chat. */
  ask?: string;
  refs: string[];
}

/** My dealt common tasks, or null when my list is unknown / unreliable. */
export function myCommons(m: MatchState): Set<string> | null {
  if (!m.myTasks?.length) return null;
  const mine = new Set(m.myTasks.filter(t => t.matched).map(t => t.id));
  const commons = m.map.tasks.filter(t => t.kind === 'common' && mine.has(t.id)).map(t => t.id);
  if (commons.length === 0 && m.settings.commonTasks > 0) return null; // the read missed my commons
  return new Set(commons);
}

export function taskClaimChecks(m: MatchState): TaskClaimCheck[] {
  const out: TaskClaimCheck[] = [];
  const commons = myCommons(m);
  const visualsOn = m.settings.visualTasksOn;
  for (const c of m.claims) {
    if (!c.taskId || (c.type !== 'task' && c.type !== 'clear')) continue;
    const task = m.map.tasks.find(t => t.id === c.taskId);
    const base = { claimId: c.id, by: c.by, about: c.about, taskId: c.taskId, taskName: task?.name ?? c.taskId, room: c.room };
    if (c.type === 'clear') { const r = checkVisualClear(m, c, task, visualsOn); if (r) out.push({ ...base, ...r }); continue; }
    out.push({ ...base, ...checkTask(m, c, task, commons, visualsOn) });
  }
  const rank: Record<TaskVerdict, number> = { fake: 0, clearInvalid: 1, suspect: 2, checkable: 3, confirmed: 4, plausible: 5 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}

type Partial_ = Pick<TaskClaimCheck, 'verdict' | 'check' | 'line' | 'ask' | 'refs'>;

function checkTask(m: MatchState, c: Claim, task: MapTask | undefined, commons: Set<string> | null, visualsOn: boolean): Partial_ {
  const P = pname(m, c.by);
  if (!task) return { verdict: 'fake', check: 'task_not_on_map', line: `${P}: "${c.taskId}" is not a task on ${m.map.name}`, ask: `There is no ${c.taskId} on this map ${P}.`, refs: [c.id] };
  if (c.room && !task.rooms.includes(c.room)) {
    return { verdict: 'fake', check: 'task_not_in_room', line: `${P}: ${task.name} has no stage in ${roomName(m, c.room)}`, ask: `${task.name} is not in ${roomName(m, c.room)}. Which panel ${P}?`.slice(0, 70), refs: [c.id] };
  }
  if (task.kind === 'common' && commons && !commons.has(task.id)) {
    return { verdict: 'fake', check: 'common_not_dealt', line: `${P}: ${task.name} is a common task and I don't have it — nobody does`, ask: `${task.name} is common. I dont have it. Nobody does.`, refs: [c.id] };
  }
  // Things I watched this round: visual animation, task bar.
  const seen = m.observations.filter((o): o is SawTaskObs => o.type === 'sawTask' && o.player === c.by && o.stamp.round === c.stamp.round);
  const visualOk = seen.find(o => o.visualConfirmed);
  if (task.visual && visualsOn) {
    if (visualOk) return { verdict: 'confirmed', check: 'visual_unseen', line: `${P}: ${task.name} — I saw the visual`, refs: [c.id, visualOk.id] };
    const watched = seen.find(o => o.taskId === task.id || (!o.taskId && task.rooms.includes(o.room)));
    if (watched) return { verdict: 'suspect', check: 'visual_unseen', line: `${P}: ${task.name} is visual and I watched them there without the animation`, ask: `${P} ${task.name} is visual. I watched and saw nothing.`.slice(0, 70), refs: [c.id, watched.id] };
    return { verdict: 'checkable', check: 'visual_unseen', line: `${P}: ${task.name} is visual — did anyone watch it?`, ask: `Who saw ${P} do ${task.name}?`.slice(0, 70), refs: [c.id] };
  }
  if (m.settings.taskBarMode === 'always') {
    const bar = seen.filter(o => o.taskBarMoved !== undefined && (o.taskId === task.id || !o.taskId)).pop();
    if (bar?.taskBarMoved === true) return { verdict: 'confirmed', check: 'bar_moved_alone', line: `${P}: bar moved when they finished in front of me (soft clear)`, refs: [c.id, bar.id] };
    if (bar?.taskBarMoved === false) {
      const multi = task.stages > 1;
      return {
        verdict: multi ? 'plausible' : 'suspect', check: 'bar_no_move',
        line: multi ? `${P}: bar didn't move, but ${task.name} has ${task.stages} stages (bar moves on the last one only)` : `${P}: said done ${task.name}; the bar did not move`,
        ask: multi ? undefined : `${P} you said done ${task.name}. The bar did not move.`.slice(0, 70), refs: [c.id, bar.id],
      };
    }
  }
  return { verdict: 'plausible', line: `${P}: ${task.name}${c.room ? ` in ${roomName(m, c.room)}` : ''} — exists, nothing against it`, refs: [c.id] };
}

/** "Y is clear, did <visual>" — only valid with visuals ON and only for a task that is visual on THIS map. */
function checkVisualClear(m: MatchState, c: Claim, task: MapTask | undefined, visualsOn: boolean): Partial_ | null {
  if (!task) return null;
  const who = c.about ? pname(m, c.about) : 'them';
  if (!task.visual) return { verdict: 'clearInvalid', check: 'visual_wrong_map', line: `${pname(m, c.by)} clears ${who} by ${task.name}, which is not visual on ${m.map.name}`, ask: `${task.name} is not visual on this map. That clears nobody.`.slice(0, 70), refs: [c.id] };
  if (!visualsOn && task.id !== 'submitScan') return { verdict: 'clearInvalid', check: 'visual_off_clear', line: `${pname(m, c.by)} clears ${who} by ${task.name}, but visuals are OFF`, ask: 'Visuals are off. Only scan waiting proves it.', refs: [c.id] };
  return null;
}
