/**
 * Name book (pure): what the app has learned about player names across games.
 *
 * Three kinds of knowledge, all fed by what the screen confirmed or the user fixed:
 *  - names:   confirmed spellings ("BigBingus"), with how often and how strongly they were
 *             confirmed (user-typed > vote grid > lobby) and which room codes they were seen in;
 *  - aliases: OCR readings that turned out to be a known name ("BigBihgis" → "BigBingus"),
 *             recorded when the user renames a card or two cards merge;
 *  - junk:    strings that were never a player ("(Red)", "told u 4 times"), recorded when the
 *             user removes a card or the consolidator drops one that never reached the grid.
 *
 * `resolve()` turns a raw OCR string into the canonical spelling; `snapList()` gives the Rust
 * OCR its snap candidates (canonical names + aliases) so the raw read is already right more
 * often; `isJunk()` keeps rejected strings from ever becoming players again.
 */
import { nameScore, norm } from './rosterMatch';
import { isPlaceholderName, nameQuality } from './rosterConsolidate';

export interface NameRecord {
  name: string;                       // canonical spelling (as the user typed it / the grid read it)
  seen: number;                       // confirmations, weighted (user 3, grid 1, merge 1)
  user: boolean;                      // the user typed this spelling at least once
  aliases: Record<string, number>;    // raw OCR reading → times it resolved to this name
  lastSeen: number;                   // wall ms
  lobbies: string[];                  // room codes (most recent last, capped)
}

export interface JunkRecord { text: string; strikes: number; user: boolean; lastSeen: number }

export interface NameBook {
  version: 1;
  names: Record<string, NameRecord>;  // key: norm(name)
  junk: Record<string, JunkRecord>;   // key: norm(text)
}

export type NameSource = 'user' | 'grid' | 'merge' | 'lobby';

export const emptyBook = (): NameBook => ({ version: 1, names: {}, junk: {} });

const WEIGHT: Record<NameSource, number> = { user: 3, grid: 1, merge: 1, lobby: 0.5 };
const MAX_NAMES = 600;
const MAX_LOBBIES = 6;
/** Names unseen for this long are forgotten (public lobbies churn). */
const FORGET_MS = 30 * 24 * 3600_000;

/** Record a confirmed spelling. Returns a new book (the input is not mutated). */
export function learnName(book: NameBook, name: string, source: NameSource, now: number, lobby?: string): NameBook {
  const t = name.trim();
  if (isPlaceholderName(t) || nameQuality(t) < 0.5) return book;
  const key = norm(t);
  if (!key) return book;
  const cur = book.names[key];
  const rec: NameRecord = cur
    ? { ...cur, seen: cur.seen + WEIGHT[source], user: cur.user || source === 'user', lastSeen: now, name: source === 'user' ? t : cur.name }
    : { name: t, seen: WEIGHT[source], user: source === 'user', aliases: {}, lastSeen: now, lobbies: [] };
  if (lobby && !rec.lobbies.includes(lobby)) rec.lobbies = [...rec.lobbies, lobby].slice(-MAX_LOBBIES);
  const junk = { ...book.junk };
  delete junk[key];                     // a confirmed name is never junk
  let names: Record<string, NameRecord> = { ...book.names, [key]: rec };
  // A user-typed name is never a misread of someone else: drop it from every other record's aliases
  // (an automatic merge once filed "BigBingus" under another player and hid the owner for good).
  if (source === 'user') names = stripAlias(names, key, t);
  return { ...book, names, junk };
}

/** Remove every alias of `name` (by normalised key) from records other than `name`'s own. */
function stripAlias(names: Record<string, NameRecord>, key: string, name: string): Record<string, NameRecord> {
  const out: Record<string, NameRecord> = {};
  for (const [k, rec] of Object.entries(names)) {
    if (k === key || !Object.keys(rec.aliases).some(a => norm(a) === key || nameScore(a, name) >= 0.9)) { out[k] = rec; continue; }
    const aliases = Object.fromEntries(Object.entries(rec.aliases).filter(([a]) => norm(a) !== key && nameScore(a, name) < 0.9));
    out[k] = { ...rec, aliases };
  }
  return out;
}

/** Mark a name the user owns (their own in-game name): confirmed, and never an alias of anyone else. */
export function protectName(book: NameBook, name: string, now: number): NameBook {
  return learnName(book, name, 'user', now);
}

/** An OCR reading that turned out to be `canonical` (user rename, merge). */
export function learnAlias(book: NameBook, alias: string, canonical: string, now: number, source: NameSource = 'merge'): NameBook {
  const a = alias.trim(), c = canonical.trim();
  const ka = norm(a), kc = norm(c);
  if (!ka || !kc || ka === kc || isPlaceholderName(a)) return learnName(book, c, source, now);
  // A user-confirmed spelling (the owner's own name above all) is a person, not a misread of another one.
  if (book.names[ka]?.user && source !== 'user') return learnName(book, c, source, now);
  let next = learnName(book, c, source, now);
  const rec = next.names[kc];
  if (!rec) return next;
  const aliases = { ...rec.aliases, [a]: (rec.aliases[a] ?? 0) + 1 };
  // The alias cannot also be a name of its own (it was a misread of this one).
  const names = { ...next.names, [kc]: { ...rec, aliases } };
  if (names[ka] && !names[ka].user) delete names[ka];
  next = { ...next, names };
  return next;
}

/** A string that was never a player. User strikes are final; automatic ones need two. */
export function learnJunk(book: NameBook, text: string, now: number, byUser: boolean): NameBook {
  const t = text.trim();
  const key = norm(t);
  if (!key || book.names[key]?.user) return book;
  const cur = book.junk[key];
  const rec: JunkRecord = { text: t, strikes: (cur?.strikes ?? 0) + 1, user: (cur?.user ?? false) || byUser, lastSeen: now };
  const names = { ...book.names };
  if (byUser) delete names[key];
  return { ...book, names, junk: { ...book.junk, [key]: rec } };
}

export function isJunk(book: NameBook, text: string): boolean {
  const j = book.junk[norm(text)];
  return !!j && (j.user || j.strikes >= 2);
}

export interface Resolution { name: string; via: 'exact' | 'alias' | 'fuzzy' | 'none'; score: number }

/**
 * Canonical spelling for a raw OCR string. Exact and alias hits are certain; a fuzzy hit needs
 * a well-confirmed name and a high score, and never fires on very short strings (Tim / Tom).
 */
export function resolve(book: NameBook, raw: string): Resolution {
  const t = raw.trim();
  const key = norm(t);
  if (!key || isPlaceholderName(t)) return { name: t, via: 'none', score: 0 };
  const exact = book.names[key];
  if (exact) return { name: exact.name, via: 'exact', score: 1 };
  // A close reading of a user-confirmed name is that name, whatever aliases other records collected.
  if (key.length >= 4) {
    let bestUser: { rec: NameRecord; score: number } | null = null;
    for (const rec of Object.values(book.names)) {
      if (!rec.user) continue;
      const s = nameScore(t, rec.name);
      if (!bestUser || s > bestUser.score) bestUser = { rec, score: s };
    }
    if (bestUser && bestUser.score >= 0.75) {
      const known = Object.keys(bestUser.rec.aliases).some(a => norm(a) === key);
      return { name: bestUser.rec.name, via: known ? 'alias' : 'fuzzy', score: known ? 1 : bestUser.score };
    }
  }
  for (const rec of Object.values(book.names)) {
    for (const a of Object.keys(rec.aliases)) if (norm(a) === key) return { name: rec.name, via: 'alias', score: 1 };
  }
  if (key.length < 4) return { name: t, via: 'none', score: 0 };
  let best: { rec: NameRecord; score: number } | null = null;
  for (const rec of Object.values(book.names)) {
    const s = nameScore(t, rec.name);
    if (!best || s > best.score) best = { rec, score: s };
  }
  if (best) {
    const need = best.rec.user || best.rec.seen >= 3 ? 0.75 : 0.85;
    if (best.score >= need) return { name: best.rec.name, via: 'fuzzy', score: best.score };
  }
  return { name: t, via: 'none', score: best?.score ?? 0 };
}

/**
 * Snap candidates for the Rust OCR: the roster's names first, then this lobby's known names,
 * then the most recently seen names and their aliases. Capped so the fuzzy pass stays cheap.
 */
export function snapList(book: NameBook, rosterNames: string[], lobby: string | null, cap = 80): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (n: string) => { const k = norm(n); if (k && !seen.has(k) && !isPlaceholderName(n)) { seen.add(k); out.push(n); } };
  for (const n of rosterNames) push(n);
  const recs = Object.values(book.names).sort((a, b) => b.lastSeen - a.lastSeen);
  if (lobby) for (const r of recs) if (r.lobbies.includes(lobby)) { push(r.name); for (const a of Object.keys(r.aliases)) push(a); }
  for (const r of recs) { if (out.length >= cap) break; push(r.name); }
  for (const r of recs) { if (out.length >= cap) break; for (const a of Object.keys(r.aliases)) push(a); }
  return out.slice(0, cap);
}

/** Forget stale names and keep the book bounded. */
export function prune(book: NameBook, now: number): NameBook {
  const names = Object.fromEntries(Object.entries(book.names).filter(([, r]) => r.user || now - r.lastSeen < FORGET_MS));
  const keys = Object.keys(names);
  if (keys.length > MAX_NAMES) {
    const drop = keys.sort((a, b) => names[a].lastSeen - names[b].lastSeen).slice(0, keys.length - MAX_NAMES);
    for (const k of drop) if (!names[k].user) delete names[k];
  }
  const junk = Object.fromEntries(Object.entries(book.junk).filter(([, j]) => j.user || now - j.lastSeen < FORGET_MS));
  return { ...book, names, junk };
}

/**
 * Pick a card's display name from repeated grid readings: the reading with the most weight
 * (count × quality) wins once it has been seen twice, unless the user typed the name.
 */
export function bestReading(votes: Record<string, number>, current: string, locked: boolean | undefined): string {
  if (locked) return current;
  let best: { name: string; w: number } | null = null;
  for (const [name, n] of Object.entries(votes)) {
    const w = n * nameQuality(name);
    if (!best || w > best.w) best = { name, w };
  }
  if (!best || best.name === current) return current;
  const curW = (votes[current] ?? 0) * nameQuality(current);
  return votes[best.name] >= 2 && best.w > curW ? best.name : current;
}
