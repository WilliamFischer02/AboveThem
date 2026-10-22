/**
 * Per-map meeting questions and common-lie notes, selected by situation from `src/data/maps/questions.json`.
 * Pure: the caller passes the parsed JSON and the MapData (no imports of data here, so tests can feed fixtures).
 */
import type { MapData, MapId, MapSabotage, RoomId } from '../types/game';

export type Monitor = 'admin' | 'cams' | 'vitals' | 'doorLog';

export interface QuestionWhen {
  bodyRoom?: RoomId | RoomId[];
  claimRoom?: RoomId | RoomId[];
  claimTask?: string | string[];
  sabotage?: MapSabotage | MapSabotage[];
  claimMonitor?: Monitor | Monitor[];
}

export interface QuestionEntry { id: string; when: QuestionWhen; text: string; why?: string; weight: number }
export interface MapQuestionSet { questions: QuestionEntry[]; lies: QuestionEntry[] }
export interface MapQuestionsFile { _note?: string; maps: Partial<Record<MapId, MapQuestionSet>> }

/** What is known about this meeting. Player strings are display names, already resolved by the caller. */
export interface QuestionSituation {
  bodyRoom?: RoomId;
  claimRoom?: RoomId;
  claimTask?: string;      // map task id
  sabotage?: MapSabotage;  // sabotage active / just fixed this round
  claimMonitor?: Monitor;  // someone claims info from this monitor
  player?: string;         // {P}
  victim?: string;         // {V}
}

export interface SelectedLine { id: string; kind: 'question' | 'lie'; text: string; why?: string; score: number; matched: (keyof QuestionWhen)[] }

export const PLACEHOLDERS = ['P', 'V', 'R', 'B', 'TASK'] as const;

const asList = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Which `when` keys match; null if any present key fails. */
function matchWhen(when: QuestionWhen, s: QuestionSituation): (keyof QuestionWhen)[] | null {
  const matched: (keyof QuestionWhen)[] = [];
  for (const key of Object.keys(when) as (keyof QuestionWhen)[]) {
    const allowed = asList(when[key] as string | string[] | undefined);
    if (!allowed.length) continue;
    const have = s[key];
    if (have === undefined || !allowed.includes(have)) return null;
    matched.push(key);
  }
  return matched;
}

/** Fill {P} {V} {R} {B} {TASK}; null when a used placeholder has no value. */
export function fillTemplate(text: string, map: MapData, s: QuestionSituation): string | null {
  const room = (id?: RoomId) => (id ? map.rooms.find(r => r.id === id)?.name ?? id : undefined);
  const task = s.claimTask ? map.tasks.find(t => t.id === s.claimTask)?.name ?? s.claimTask : undefined;
  const values: Record<string, string | undefined> = { P: s.player, V: s.victim, R: room(s.claimRoom), B: room(s.bodyRoom), TASK: task };
  let ok = true;
  const out = text.replace(/\{(P|V|R|B|TASK)\}/g, (_, k: string) => { const v = values[k]; if (!v) { ok = false; return ''; } return v; });
  return ok ? out : null;
}

/**
 * Pick the questions / lie notes that fit this situation, most specific and useful first.
 * score = weight + 0.25 per matched condition. Lies need at least one matched condition.
 */
export function selectMapQuestions(data: MapQuestionsFile, map: MapData, s: QuestionSituation, limit = 4): SelectedLine[] {
  const set = data.maps[map.id];
  if (!set) return [];
  const out: SelectedLine[] = [];
  const consider = (e: QuestionEntry, kind: 'question' | 'lie') => {
    const matched = matchWhen(e.when, s);
    if (!matched) return;
    if (kind === 'lie' && matched.length === 0) return;
    const text = fillTemplate(e.text, map, s);
    if (text === null) return;
    out.push({ id: e.id, kind, text, why: e.why, score: e.weight + 0.25 * matched.length, matched });
  };
  for (const e of set.questions) consider(e, 'question');
  for (const e of set.lies) consider(e, 'lie');
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Problems in the questions file against the map data (unknown ids, placeholders, empty-when lies). */
export function validateQuestions(data: MapQuestionsFile, maps: Partial<Record<MapId, MapData>>): string[] {
  const errs: string[] = [];
  const SAB: MapSabotage[] = ['lights', 'comms', 'reactor', 'o2', 'doors', 'seismic', 'crashCourse', 'mushroomMixup'];
  const MON: Monitor[] = ['admin', 'cams', 'vitals', 'doorLog'];
  const ids = new Set<string>();
  for (const [mapId, set] of Object.entries(data.maps) as [MapId, MapQuestionSet][]) {
    const map = maps[mapId];
    if (!map) { errs.push(`unknown map ${mapId}`); continue; }
    const rooms = new Set(map.rooms.map(r => r.id));
    const tasks = new Set(map.tasks.map(t => t.id));
    for (const [kind, list] of [['question', set.questions], ['lie', set.lies]] as const) {
      for (const e of list) {
        const where = `${mapId}/${e.id}`;
        if (ids.has(e.id)) errs.push(`${where}: duplicate id`);
        ids.add(e.id);
        if (!e.text) errs.push(`${where}: empty text`);
        if (!(e.weight >= 0 && e.weight <= 1)) errs.push(`${where}: weight must be 0..1`);
        for (const r of [...asList(e.when.bodyRoom), ...asList(e.when.claimRoom)]) if (!rooms.has(r)) errs.push(`${where}: room ${r} not on ${mapId}`);
        for (const t of asList(e.when.claimTask)) if (!tasks.has(t)) errs.push(`${where}: task ${t} not on ${mapId}`);
        for (const sb of asList(e.when.sabotage)) {
          if (!SAB.includes(sb)) errs.push(`${where}: unknown sabotage ${sb}`);
          else if (map.info && !map.info.sabotages.includes(sb)) errs.push(`${where}: sabotage ${sb} does not exist on ${mapId}`);
        }
        for (const m of asList(e.when.claimMonitor)) if (!MON.includes(m)) errs.push(`${where}: unknown monitor ${m}`);
        for (const ph of e.text.match(/\{([A-Z]+)\}/g) ?? []) if (!(PLACEHOLDERS as readonly string[]).includes(ph.slice(1, -1))) errs.push(`${where}: unknown placeholder ${ph}`);
        if (e.text.includes('{R}') && !e.when.claimRoom) errs.push(`${where}: {R} needs a claimRoom condition`);
        if (e.text.includes('{TASK}') && !e.when.claimTask) errs.push(`${where}: {TASK} needs a claimTask condition`);
        if (kind === 'lie' && Object.values(e.when).every(v => asList(v as string | string[]).length === 0)) errs.push(`${where}: a lie note needs a condition`);
      }
    }
  }
  return errs;
}
