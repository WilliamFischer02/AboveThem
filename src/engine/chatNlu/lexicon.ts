/**
 * Lexicon access for the chat NLU: static word classes from src/data/chatLexicon.json,
 * plus per-match indexes (colours → players, player names, map rooms, map tasks).
 * Pure: no DOM, no Tauri. Indexes are cached per MatchState object identity.
 */
import raw from '../../data/chatLexicon.json';
import type { MapData, MatchState, PlayerColor, PlayerId, RoomId } from '../../types/game';

export type WordClass =
  | 'sus' | 'vent' | 'kill' | 'selfReport' | 'followed' | 'fake' | 'lying' | 'stack' | 'clear' | 'scan' | 'visual'
  | 'see' | 'do' | 'taskWord' | 'vote' | 'out' | 'skip' | 'with' | 'together' | 'be' | 'move' | 'body' | 'dead' | 'its'
  | 'so' | 'or' | 'and' | 'neg' | 'agree' | 'bound' | 'prepIn' | 'prepNear' | 'prepFrom' | 'prepTo' | 'self' | 'selfBe'
  | 'you' | 'pronSingular' | 'pronPlural' | 'report' | 'filler' | 'hedge' | 'intens' | 'q' | 'noise';

export type QuestionType = 'where' | 'who' | 'why' | 'what' | 'proof' | 'how';

export interface StaticEntry { cls: WordClass; f?: number; q?: QuestionType }

interface RoomEntry { id: string; names: string[]; aliases: string[]; maps?: string[] }
interface TaskEntry { id: string; names: string[]; aliases: string[] }
interface Lexicon {
  fuzzyBlock: string[];
  colors: Record<string, string[]>;
  rooms: RoomEntry[];
  tasks: TaskEntry[];
  words: Record<string, string[]>;
  hedges: Record<string, number>;
  intensifiers: Record<string, number>;
  questions: Record<string, string[]>;
  noise: string[];
}
export const LEX = raw as unknown as Lexicon;

/** Lower-case, strip apostrophes, collapse spaces: the form every lexicon phrase is stored in. */
export const normPhrase = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}%&+ ]/gu, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Static phrase table
// ---------------------------------------------------------------------------

const STATIC = new Map<string, StaticEntry[]>();
const addStatic = (phrase: string, e: StaticEntry) => {
  const k = normPhrase(phrase);
  if (!k) return;
  const list = STATIC.get(k) ?? [];
  if (!list.some(x => x.cls === e.cls)) list.push(e);
  STATIC.set(k, list);
};
for (const [cls, list] of Object.entries(LEX.words)) for (const w of list) addStatic(w, { cls: cls as WordClass });
for (const [w, f] of Object.entries(LEX.hedges)) addStatic(w, { cls: 'hedge', f });
for (const [w, f] of Object.entries(LEX.intensifiers)) addStatic(w, { cls: 'intens', f });
for (const [q, list] of Object.entries(LEX.questions)) for (const w of list) addStatic(w, { cls: 'q', q: q as QuestionType });
for (const w of LEX.noise) addStatic(w, { cls: 'noise' });

export const staticLookup = (phrase: string): StaticEntry[] | undefined => STATIC.get(phrase);
export const MAX_PHRASE_WORDS = 4;

const FUZZY_BLOCK = new Set(LEX.fuzzyBlock.map(normPhrase));
/** Static single words long enough to fuzzy-match (verbs like "vented", "reported"); grouped by class. */
const FUZZY_STATIC: { w: string; e: StaticEntry[] }[] = [...STATIC.entries()]
  .filter(([w, e]) => !w.includes(' ') && w.length >= 6 && e.some(x => ['vent', 'kill', 'selfReport', 'followed', 'fake', 'lying', 'sus', 'clear', 'dead', 'vote', 'skip'].includes(x.cls)))
  .map(([w, e]) => ({ w, e }));

// ---------------------------------------------------------------------------
// Edit distance (optimal string alignment: adjacent transposition = 1 edit)
// ---------------------------------------------------------------------------

export function osa(a: string, b: string): number {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > 2) return 3;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}

/** How many edits a word of this length may be off by: <= 4 letters exact, 5–6 one, 7+ two. */
export const fuzzyCap = (len: number) => (len <= 4 ? 0 : len <= 6 ? 1 : 2);
export const fuzzyAllowed = (w: string) => !FUZZY_BLOCK.has(w) && /^[\p{L}]+$/u.test(w);

/** Best fuzzy hit among candidates within the cap for the probe's length; ties → undefined (ambiguous). */
export function fuzzyBest<T>(probe: string, cands: Iterable<[string, T]>): { key: string; val: T; dist: number } | undefined {
  if (!fuzzyAllowed(probe)) return undefined;
  const cap = fuzzyCap(probe.length);
  if (cap === 0) return undefined;
  let best: { key: string; val: T; dist: number } | undefined;
  let tie = false;
  for (const [key, val] of cands) {
    if (key.includes(' ') || fuzzyCap(key.length) === 0) continue;
    const dist = osa(probe, key);
    if (dist === 0 || dist > cap) continue;
    if (!best || dist < best.dist) { best = { key, val, dist }; tie = false; }
    else if (dist === best.dist && best.val !== val) tie = true;
  }
  return tie ? undefined : best;
}

export function fuzzyStatic(probe: string): StaticEntry[] | undefined {
  return fuzzyBest(probe, FUZZY_STATIC.map(x => [x.w, x.e] as [string, StaticEntry[]]))?.val;
}

/** "susss" → "suss" (try first), then "sus": letters repeated 3+ times. */
export const squash2 = (w: string) => w.replace(/(\p{L})\1{2,}/gu, '$1$1');
export const squash1 = (w: string) => w.replace(/(\p{L})\1+/gu, '$1');
/** OCR digit/letter confusions, applied only to tokens that mix letters and digits. */
export function ocrFix(w: string): string | undefined {
  if (!/\p{L}/u.test(w) || !/\d/.test(w)) return undefined;
  const fixed = w.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b');
  return fixed !== w ? fixed : undefined;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const COLOR_ALIAS = new Map<string, PlayerColor>();
for (const [c, list] of Object.entries(LEX.colors)) for (const a of list) COLOR_ALIAS.set(normPhrase(a), c as PlayerColor);
export const colorOf = (phrase: string): PlayerColor | undefined => COLOR_ALIAS.get(phrase);
export function fuzzyColor(probe: string): PlayerColor | undefined {
  return fuzzyBest(probe, COLOR_ALIAS.entries())?.val;
}
export const COLOR_NAMES = Object.keys(LEX.colors) as PlayerColor[];

// ---------------------------------------------------------------------------
// Per-match indexes
// ---------------------------------------------------------------------------

const splitCamel = (id: string) => id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();

export interface MapIndex { rooms: Map<string, RoomId>; tasks: Map<string, string> }
const mapCache = new WeakMap<MapData, MapIndex>();

/** Alias → room id / task id for this map. Lexicon entries attach to a map room by id OR by name. */
export function mapIndex(map: MapData): MapIndex {
  const hit = mapCache.get(map);
  if (hit) return hit;
  const rooms = new Map<string, RoomId>();
  const tasks = new Map<string, string>();
  const put = (idx: Map<string, string>, k: string, v: string) => { const n = normPhrase(k); if (n && !idx.has(n)) idx.set(n, v); };
  const mapRooms = map.rooms ?? [];
  if (mapRooms.length) {
    for (const r of mapRooms) {
      const rn = normPhrase(r.name);
      put(rooms, r.name, r.id); put(rooms, splitCamel(r.id), r.id);
      // "Lower Decontamination" → "lower decontamination", "Specimen Room" → also "specimen"
      put(rooms, rn.replace(/\broom\b/, '').trim(), r.id);
      put(rooms, rn.replace(/[()]/g, ''), r.id);
    }
    for (const r of mapRooms) {
      const rn = normPhrase(r.name);
      for (const e of LEX.rooms) {
        if (e.id !== r.id && !e.names.map(normPhrase).includes(rn)) continue;
        for (const a of [...e.names, ...e.aliases]) put(rooms, a, r.id);
      }
    }
  } else {
    // Stub map (rooms not filled yet): fall back to the lexicon's own ids for this map.
    for (const e of LEX.rooms) if (!e.maps || e.maps.includes(map.id)) for (const a of [e.id, ...e.names, ...e.aliases]) put(rooms, a, e.id);
  }
  const mapTasks = map.tasks ?? [];
  if (mapTasks.length) {
    for (const t of mapTasks) { put(tasks, t.name, t.id); put(tasks, splitCamel(t.id), t.id); }
    for (const t of mapTasks) {
      const tn = normPhrase(t.name);
      for (const e of LEX.tasks) {
        if (e.id !== t.id && !e.names.map(normPhrase).includes(tn)) continue;
        for (const a of [...e.names, ...e.aliases]) put(tasks, a, t.id);
      }
    }
  } else {
    for (const e of LEX.tasks) for (const a of [...e.names, ...e.aliases]) put(tasks, a, e.id);
  }
  const out = { rooms, tasks };
  mapCache.set(map, out);
  return out;
}

export interface PlayerIndex {
  /** colour → players wearing it */
  byColor: Map<PlayerColor, PlayerId[]>;
  /** normalised full name / unique name word → player */
  byName: Map<string, PlayerId>;
}
const playerCache = new WeakMap<object, PlayerIndex>();

export function playerIndex(m: MatchState): PlayerIndex {
  const hit = playerCache.get(m.players);
  if (hit) return hit;
  const byColor = new Map<PlayerColor, PlayerId[]>();
  const byName = new Map<string, PlayerId>();
  const wordCount = new Map<string, number>();
  const players = Object.values(m.players).filter(p => p.id !== 'unknown');
  for (const p of players) {
    if (p.color && p.color !== 'unknown') byColor.set(p.color, [...(byColor.get(p.color) ?? []), p.id]);
    for (const w of normPhrase(p.name).split(' ')) if (w.length >= 3) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  }
  for (const p of players) {
    const n = normPhrase(p.name);
    if (!n) continue;
    byName.set(n, p.id);
    byName.set(n.replace(/ /g, ''), p.id);
    for (const w of n.split(' ')) if (w.length >= 3 && wordCount.get(w) === 1 && !byName.has(w)) byName.set(w, p.id);
  }
  const out = { byColor, byName };
  playerCache.set(m.players, out);
  return out;
}

/**
 * A word that is not in the lexicon: does it name a player? Exact name / unique name word,
 * prefix (>= 3 letters of a >= 4-letter name, unique), or within the edit cap of a name.
 */
export function nameMatch(word: string, m: MatchState): { id: PlayerId; conf: number } | undefined {
  const idx = playerIndex(m);
  const exact = idx.byName.get(word);
  if (exact) return { id: exact, conf: 0.95 };
  if (word.length >= 3) {
    const pre = [...idx.byName.entries()].filter(([n]) => n.length >= 4 && n.startsWith(word)).map(([, id]) => id);
    const uniq = [...new Set(pre)];
    if (uniq.length === 1) return { id: uniq[0], conf: word.length >= 4 ? 0.8 : 0.7 };
  }
  if (word.length >= 4) {
    // "slayer" for "xXSlayerXx": a unique inner chunk of a longer name
    const inner = [...new Set([...idx.byName.entries()].filter(([n]) => n.length >= word.length + 2 && n.includes(word)).map(([, id]) => id))];
    if (inner.length === 1) return { id: inner[0], conf: 0.7 };
  }
  const f = fuzzyBest(word, idx.byName.entries());
  if (f) return { id: f.val, conf: f.dist === 1 ? 0.8 : 0.7 };
  return undefined;
}

export const isVisualTask = (map: MapData, taskId?: string) => !!taskId && !!map.tasks?.find(t => t.id === taskId)?.visual;
