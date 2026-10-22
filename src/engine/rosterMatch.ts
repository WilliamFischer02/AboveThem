/**
 * Vote-grid → roster matching (pure).
 *
 * The meeting grid re-sorts every meeting (alive cards first, dead cards last), so a
 * slot only identifies a player *within* one meeting. Across meetings a card is matched
 * by its name (OCR, fuzzy), its icon hash (the headshot as rendered, stable across slots
 * and dimming), its colour (weak: cosmetics), and the slot only when it was read in the
 * same meeting. Greedy best-pair assignment; low scores become "new player" candidates.
 */

export interface GridEntry {
  index: number;            // 0-based cell index
  name: string;             // OCR'd, '#N' when unreadable
  color: string;
  dead: boolean;
  iconHash?: string;        // 64-bit dHash as hex
}

export interface RosterPlayer {
  id: string;
  name: string;
  color: string;
  status: 'alive' | 'dead' | 'ejected' | 'disconnected';
  slot?: number;            // 1-based
  slotMeeting?: number;
  iconHash?: string;
  isMe?: boolean;
  /** Cell index in the first complete grid this match (all cards matched, read in one meeting). */
  gridOrder?: number;
}

export interface Assignment { index: number; playerId: string | null; score: number; reasons: string[] }

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let diag = prev[0]; prev[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const tmp = prev[j + 1];
      prev[j + 1] = Math.min(prev[j + 1] + 1, prev[j] + 1, diag + (a[i] === b[j] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Name score: exact 1, containment 0.85, else Levenshtein similarity; placeholders score 0. */
export function nameScore(a: string, b: string): number {
  if (a.startsWith('#') || b.startsWith('#')) return 0;
  const n = norm(a), m = norm(b);
  if (n.length < 2 || m.length < 2) return 0;
  if (n === m) return 1;
  if (n.includes(m) || m.includes(n)) return 0.85;
  return similarity(n, m);
}

/** Hamming distance between two hex-encoded 64-bit hashes (64 = unrelated / missing). */
export function hashDistance(a?: string, b?: string): number {
  if (!a || !b || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return 64;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

const KNOWN = (c: string) => c !== 'unknown' && c !== 'gray';

/**
 * Grid-order consistency (handoff #9). UNVERIFIED game fact: the grid lists players by player index with the
 * dead moved to the end, so the relative order of ALIVE cards never changes. A card's rank among alive cards
 * then equals its player's rank among alive players ordered by `gridOrder`. Only usable when every alive
 * card has a candidate with a `gridOrder` (otherwise the ranks are shifted); null = don't use.
 */
export interface OrderContext { entryRank: Map<number, number>; playerRank: Map<string, number> }

export function orderContext(players: RosterPlayer[], entries: GridEntry[]): OrderContext | null {
  const aliveE = entries.filter(e => !e.dead).sort((a, b) => a.index - b.index);
  const aliveP = players.filter(p => p.status === 'alive' && p.gridOrder !== undefined).sort((a, b) => a.gridOrder! - b.gridOrder!);
  const aliveAll = players.filter(p => p.status === 'alive');
  if (aliveE.length < 3 || aliveP.length !== aliveE.length || aliveAll.length !== aliveP.length) return null;
  if (new Set(aliveP.map(p => p.gridOrder)).size !== aliveP.length) return null; // duplicate orders: corrupt
  return { entryRank: new Map(aliveE.map((e, i) => [e.index, i])), playerRank: new Map(aliveP.map((p, i) => [p.id, i])) };
}

/** Enough to pair on its own (≥ MIN_ASSIGN) when nothing contradicts it; name (3) and icon (2.5) still win. */
export const ORDER_BONUS = 1.5;

export function pairScore(p: RosterPlayer, e: GridEntry, meeting: number, order?: OrderContext | null): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const ns = nameScore(p.name, e.name);
  if (ns >= 0.85) { score += 3; reasons.push('name'); } else if (ns >= 0.6) { score += 1.5; reasons.push('name~'); }
  const hd = hashDistance(p.iconHash, e.iconHash);
  if (hd <= 8) { score += 2.5; reasons.push('icon'); } else if (hd <= 14) { score += 1; reasons.push('icon~'); } else if (hd <= 40 && p.iconHash && e.iconHash) { score -= 1; }
  if (KNOWN(p.color) && KNOWN(e.color)) { if (p.color === e.color) { score += 0.7; reasons.push('colour'); } else score -= 0.3; }
  if (p.slot === e.index + 1) {
    if (p.slotMeeting === meeting) { score += 3; reasons.push('slot'); } else { score += 0.5; reasons.push('slot?'); }
  }
  if (!e.dead && p.status !== 'alive') score -= 2;   // the dead never come back
  if (order && !e.dead) {
    const er = order.entryRank.get(e.index), pr = order.playerRank.get(p.id);
    if (er !== undefined && er === pr) { score += ORDER_BONUS; reasons.push('order'); }
  }
  return { score, reasons };
}

/** Minimum score to accept a pairing. Name alone (1.5–3) or icon alone (2.5) is enough; colour alone is not. */
export const MIN_ASSIGN = 1.4;

export function matchGrid(players: RosterPlayer[], entries: GridEntry[], meeting: number): Assignment[] {
  const pairs: { p: RosterPlayer; e: GridEntry; score: number; reasons: string[] }[] = [];
  const order = orderContext(players, entries);
  for (const p of players) for (const e of entries) { const r = pairScore(p, e, meeting, order); pairs.push({ p, e, ...r }); }
  pairs.sort((a, b) => b.score - a.score);
  const usedP = new Set<string>(); const usedE = new Set<number>();
  const out = new Map<number, Assignment>();
  for (const x of pairs) {
    if (x.score < MIN_ASSIGN || usedP.has(x.p.id) || usedE.has(x.e.index)) continue;
    usedP.add(x.p.id); usedE.add(x.e.index);
    out.set(x.e.index, { index: x.e.index, playerId: x.p.id, score: x.score, reasons: x.reasons });
  }
  // Elimination: once most cards are matched and the roster is at least as big as the grid, every
  // leftover card is one of the leftover players (OCR mangled the name, cosmetics changed, a fresh
  // X on the icon). Pair them best-first; never invent a player for a card. A card of a disconnected
  // player cannot exist, so those never take part.
  const freeP = players.filter(p => !usedP.has(p.id) && !p.isMe && p.status !== 'disconnected');
  const freeE = entries.filter(e => !usedE.has(e.index));
  if (out.size >= 3 && freeE.length > 0 && freeP.length >= freeE.length && players.length >= entries.length) {
    const rest = pairs.filter(x => !usedP.has(x.p.id) && !usedE.has(x.e.index) && !x.p.isMe && x.p.status !== 'disconnected');
    for (const x of rest) {
      if (usedP.has(x.p.id) || usedE.has(x.e.index)) continue;
      usedP.add(x.p.id); usedE.add(x.e.index);
      out.set(x.e.index, { index: x.e.index, playerId: x.p.id, score: Math.max(0.5, x.score), reasons: [...x.reasons, 'elimination'] });
    }
  }
  return entries.map(e => out.get(e.index) ?? { index: e.index, playerId: null, score: 0, reasons: [] });
}

/** 0..1: how sure we are the roster mirrors the screen (names read, cards matched, nothing invented). */
export function rosterConfidence(assignments: Assignment[], entries: GridEntry[]): number {
  if (entries.length === 0) return 0;
  let sum = 0;
  for (const a of assignments) {
    const e = entries[a.index] ?? entries.find(x => x.index === a.index);
    const readable = e && !e.name.startsWith('#') ? 1 : 0.4;
    const matched = a.playerId ? Math.min(1, a.score / 3) : 0.3;
    sum += readable * 0.5 + matched * 0.5;
  }
  return sum / entries.length;
}
