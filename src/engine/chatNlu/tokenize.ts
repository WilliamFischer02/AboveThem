/**
 * Text → tagged units. Every unit keeps its character span in the original text so
 * assertions can quote exactly what they were read from.
 *
 * Steps: split into words / punctuation (offsets kept) → longest phrase match (<= 4 words)
 * against colours, player names, map rooms, map tasks and the static lexicon → fall back to
 * squashed spellings ("susss"), OCR digit fixes ("b1ue") and capped fuzzy matches ("purpel").
 */
import type { MatchState, PlayerColor, PlayerId, RoomId } from '../../types/game';
import {
  MAX_PHRASE_WORDS, colorOf, fuzzyColor, fuzzyStatic, mapIndex, nameMatch, ocrFix, playerIndex, squash1, squash2,
  staticLookup, fuzzyBest, type QuestionType, type StaticEntry, type WordClass,
} from './lexicon';

export interface RawTok { w: string; s: number; e: number; punct?: string; caps?: boolean }

/** Split into lower-case word tokens and punctuation tokens, with offsets into `text`. */
export function rawTokens(text: string): RawTok[] {
  const out: RawTok[] = [];
  // "red's" → "red" + "s" (be / possessive); other apostrophes vanish ("wasn't" → "wasnt").
  const re = /[\p{L}\p{N}%]+(?:['’][\p{L}]+)*|[?!.,;&+/|]/gu;
  for (const m of text.matchAll(re)) {
    const s = m.index ?? 0;
    const tok = m[0];
    if (/^[?!.,;]$/.test(tok)) { out.push({ w: tok, s, e: s + 1, punct: tok }); continue; }
    if (tok === '/' || tok === '|') continue;
    if (tok === '&' || tok === '+') { out.push({ w: tok, s, e: s + 1 }); continue; }
    const caps = tok.length >= 3 && /\p{Lu}/u.test(tok) && tok === tok.toUpperCase() && /\p{L}/u.test(tok);
    const sq = tok.match(/^(.*?)['’]s$/u);
    if (sq && sq[1]) {
      out.push({ w: sq[1].toLowerCase().replace(/['’]/g, ''), s, e: s + sq[1].length, caps });
      out.push({ w: 's', s: s + sq[1].length, e: s + tok.length });
      continue;
    }
    out.push({ w: tok.toLowerCase().replace(/['’]/g, ''), s, e: s + tok.length, caps });
  }
  // "w/" (with) is written with a slash: the slash is dropped above, "w" stays.
  return out;
}

export type UnitKind =
  | 'P' | 'ROOM' | 'TASK' | 'PRON' | 'YOU' | 'Q' | 'PUNCT' | 'W' | WordClass;

export interface Unit {
  k: UnitKind;
  s: number;
  e: number;
  /** Surface text (normalised). */
  w: string;
  /** Other readings of the same words (e.g. "shields" = room + task, "scan" = task + verb). */
  cls: Set<WordClass>;
  room?: RoomId;
  task?: string;
  /** P: players referred to. */
  ids?: PlayerId[];
  /** P: the speaker is among them. */
  self?: boolean;
  /** P from a colour word. */
  color?: PlayerColor;
  /** PRON: plural ("them") or singular ("him"). */
  plural?: boolean;
  q?: QuestionType;
  /** hedge factor / intensifier bonus */
  f?: number;
  /** 0..1 match confidence (exact 1, squashed .95, fuzzy .75–.8, OCR fix .7). */
  conf: number;
  via?: 'direct' | 'fuzzy' | 'pronoun' | 'addressee';
  /** Line ids this unit's reading depends on (pronoun antecedents). */
  refs?: string[];
  caps?: boolean;
  /** The colour word named a player not in the roster. */
  unresolved?: string;
}

/** Classes that make a word "taken" for the purpose of player-name matching. */
const FUNCTION_CLASSES = new Set<WordClass>(['be', 'move', 'do', 'see', 'with', 'and', 'or', 'neg', 'prepIn', 'prepNear', 'prepFrom', 'prepTo', 'self', 'selfBe', 'you', 'pronSingular', 'pronPlural', 'filler', 'noise', 'q', 'its', 'so', 'bound']);

const PRIMARY_ORDER: WordClass[] = [
  'q', 'selfBe', 'self', 'you', 'pronPlural', 'pronSingular', 'neg', 'its', 'so', 'or', 'and', 'with', 'together',
  'body', 'dead', 'selfReport', 'vent', 'kill', 'followed', 'fake', 'lying', 'stack', 'vote', 'skip', 'out', 'sus', 'clear',
  'scan', 'visual', 'see', 'do', 'taskWord', 'report', 'be', 'move', 'prepNear', 'prepFrom', 'prepTo', 'prepIn', 'bound',
  'agree', 'hedge', 'intens', 'filler', 'noise',
];

function playersForColor(c: PlayerColor, m: MatchState, speaker: PlayerId): { ids: PlayerId[]; self: boolean } {
  const ids = playerIndex(m).byColor.get(c) ?? [];
  return { ids: ids.filter(id => id !== speaker), self: ids.includes(speaker) };
}

interface Hit { len: number; unit: Omit<Unit, 's' | 'e' | 'w'> }

function lookupPhrase(ph: string, m: MatchState, speaker: PlayerId, single: boolean, conf: number): Hit['unit'] | undefined {
  const color = colorOf(ph);
  const stat: StaticEntry[] = staticLookup(ph) ?? [];
  const idx = mapIndex(m.map);
  const room = idx.rooms.get(ph);
  const task = idx.tasks.get(ph);
  const cls = new Set<WordClass>(stat.map(e => e.cls));
  if (color) {
    const r = playersForColor(color, m, speaker);
    return { k: 'P', cls, ids: r.ids, self: r.self, color, conf, via: conf < 1 ? 'fuzzy' : 'direct', unresolved: !r.ids.length && !r.self ? ph : undefined };
  }
  // Player names: exact name beats function words only when the word is not a common function word.
  const nameExact = playerIndex(m).byName.get(ph);
  if (nameExact && ![...cls].some(c => FUNCTION_CLASSES.has(c))) {
    return nameExact === speaker ? { k: 'P', cls, ids: [], self: true, conf } : { k: 'P', cls, ids: [nameExact], self: false, conf, via: 'direct' };
  }
  if (!stat.length && !room && !task) return undefined;
  const primary = PRIMARY_ORDER.find(c => cls.has(c));
  const e = stat.find(x => x.cls === primary);
  // Room/task readings win over weak static readings (filler/noise/be), lose to verbs.
  const weak = !primary || ['filler', 'noise', 'agree', 'be', 'bound', 'intens', 'hedge'].includes(primary);
  if ((room || task) && weak) {
    return { k: room ? 'ROOM' : 'TASK', cls, room, task, conf };
  }
  if (!primary) return undefined;
  const k: UnitKind = primary === 'q' ? 'Q' : primary === 'you' ? 'YOU' : primary === 'pronPlural' || primary === 'pronSingular' ? 'PRON' : primary;
  void single;
  return { k, cls, room, task, q: e?.q, f: e?.f, plural: primary === 'pronPlural' ? true : primary === 'pronSingular' ? false : undefined, conf };
}

/** Tag one line. `speaker` turns colour/name mentions of the speaker into self references. */
export function tagLine(text: string, m: MatchState, speaker: PlayerId): Unit[] {
  const toks = rawTokens(text);
  const units: Unit[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t.punct) { units.push({ k: 'PUNCT', s: t.s, e: t.e, w: t.w, cls: new Set(), conf: 1 }); i++; continue; }
    let hit: Hit | undefined;
    for (let len = Math.min(MAX_PHRASE_WORDS, toks.length - i); len >= 1 && !hit; len--) {
      const span = toks.slice(i, i + len);
      if (span.some(x => x.punct)) continue;
      const ph = span.map(x => x.w).join(' ');
      const u = lookupPhrase(ph, m, speaker, len === 1, 1);
      if (u) hit = { len, unit: u };
    }
    if (!hit) {
      // Single-word fallbacks: stretched letters, OCR digit confusions, capped fuzzy, player names.
      const w = t.w;
      for (const [cand, conf] of [[squash2(w), 0.95], [squash1(w), 0.95], [ocrFix(w), 0.7]] as [string | undefined, number][]) {
        if (!cand || cand === w) continue;
        const u = lookupPhrase(cand, m, speaker, true, conf);
        if (u) { hit = { len: 1, unit: u }; break; }
      }
      if (!hit) {
        const probe = ocrFix(w) ?? squash2(w);
        const fc = fuzzyColor(probe);
        if (fc) {
          const r = playersForColor(fc, m, speaker);
          hit = { len: 1, unit: { k: 'P', cls: new Set(), ids: r.ids, self: r.self, color: fc, conf: 0.75, via: 'fuzzy', unresolved: !r.ids.length && !r.self ? w : undefined } };
        }
      }
      if (!hit) {
        const nm = nameMatch(ocrFix(w) ?? w, m);
        if (nm) hit = { len: 1, unit: nm.id === speaker ? { k: 'P', cls: new Set(), ids: [], self: true, conf: nm.conf } : { k: 'P', cls: new Set(), ids: [nm.id], self: false, conf: nm.conf, via: nm.conf < 0.95 ? 'fuzzy' : 'direct' } };
      }
      if (!hit) {
        const idx = mapIndex(m.map);
        const fr = fuzzyBest(squash2(w), idx.rooms.entries());
        if (fr) hit = { len: 1, unit: { k: 'ROOM', cls: new Set(), room: fr.val, conf: 0.75 } };
      }
      if (!hit) {
        const fs = fuzzyStatic(squash2(w));
        if (fs) {
          const u = lookupPhrase(fuzzyKey(fs), m, speaker, true, 0.75);
          if (u) hit = { len: 1, unit: u };
        }
      }
    }
    const span = toks.slice(i, i + (hit?.len ?? 1));
    const s = span[0].s, e = span[span.length - 1].e, w = span.map(x => x.w).join(' ');
    const caps = span.some(x => x.caps);
    if (hit) {
      const u: Unit = { ...hit.unit, s, e, w, caps };
      // "im" / "i am" / "i was" = me + be
      if (u.k === 'selfBe') {
        units.push({ k: 'P', s, e, w, cls: new Set(['self']), ids: [], self: true, conf: 1, via: 'direct' });
        units.push({ k: 'be', s, e, w, cls: new Set(['be']), conf: 1 });
      } else if (u.k === 'self') {
        units.push({ k: 'P', s, e, w, cls: u.cls, ids: [], self: true, conf: 1, via: 'direct' });
      } else units.push(u);
      i += hit.len;
    } else {
      units.push({ k: 'W', s, e, w, cls: new Set(), conf: 1, caps });
      i++;
    }
  }
  return units;
}

/** The fuzzy static hit returns entries; recover a phrase that maps to the same primary class. */
function fuzzyKey(entries: StaticEntry[]): string {
  const cls = entries[0].cls;
  const canon: Partial<Record<WordClass, string>> = {
    vent: 'vented', kill: 'killed', selfReport: 'self reported', followed: 'followed', fake: 'faking', lying: 'lying',
    sus: 'sus', clear: 'clear', dead: 'dead', vote: 'vote', skip: 'skip',
  };
  return canon[cls] ?? cls;
}
