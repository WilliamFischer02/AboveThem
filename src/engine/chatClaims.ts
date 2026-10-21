/**
 * Chat → claims (pure, testable). Among Us chat is short and formulaic:
 *   "i was in elec"            → location claim by the sender
 *   "with red the whole time"  → companion claim (red = the red player)
 *   "blue is sus" / "vote blue" / "blue vented" / "blue killed" → accusation (with reason when a verb is given)
 *   "green is clear" / "i saw green scan"                        → clear claim
 *   "red was in nav"           → sighting claim (sender saw red in Navigation)
 * Players are referred to by colour far more often than by name, so colour words
 * resolve to the player wearing that colour.
 */
import type { Claim, ClaimType, MatchState, PlayerId, RoomId } from '../types/game';

const ROOM_ALIASES: Record<string, string[]> = {
  electrical: ['elec', 'electric', 'electrical', 'lights'],
  cafeteria: ['cafe', 'caf', 'cafeteria'],
  navigation: ['nav', 'navi', 'navigation'],
  medbay: ['med', 'medbay', 'medical', 'scan'],
  security: ['sec', 'security', 'cams', 'cameras'],
  communications: ['comms', 'coms', 'communications', 'com'],
  o2: ['o2', 'oxygen'],
  storage: ['storage', 'store'],
  shields: ['shields', 'shield'],
  weapons: ['weapons', 'weps', 'weapon'],
  admin: ['admin'],
  reactor: ['reactor', 'react'],
  upperEngine: ['upper', 'upper engine', 'up eng', 'ue'],
  lowerEngine: ['lower', 'lower engine', 'low eng', 'le'],
  laboratory: ['lab', 'laboratory'],
  specimen: ['specimen', 'spec'],
  office: ['office'],
  dropship: ['dropship', 'ship', 'drop'],
  boilerRoom: ['boiler', 'boiler room'],
  lava: ['lava'],
  outsideLeft: ['outside', 'left outside'],
  outsideRight: ['right outside'],
  upperDecon: ['decon', 'upper decon'],
  lowerDecon: ['lower decon'],
};

const COLOR_WORDS = ['red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black', 'white', 'purple', 'brown', 'cyan', 'lime', 'maroon', 'rose', 'banana', 'gray', 'grey', 'tan', 'coral'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let diag = prev[0]; prev[0] = i + 1;
    for (let j = 0; j < b.length; j++) { const tmp = prev[j + 1]; prev[j + 1] = Math.min(prev[j + 1] + 1, prev[j] + 1, diag + (a[i] === b[j] ? 0 : 1)); diag = tmp; }
  }
  return prev[b.length];
}

export interface ParsedClaim { type: ClaimType; room?: RoomId; about?: PlayerId; reason?: string }

/** Resolve a word (colour or name fragment) to a player. */
export function resolvePlayer(word: string, m: MatchState, exclude?: PlayerId): PlayerId | undefined {
  const w = norm(word);
  if (!w) return undefined;
  const players = Object.values(m.players).filter(p => p.id !== exclude);
  const cw = w === 'grey' ? 'gray' : w;
  if (COLOR_WORDS.includes(cw)) return players.find(p => p.color === cw)?.id;
  let best: { id: PlayerId; score: number } | null = null;
  for (const p of players) {
    const n = norm(p.name);
    const score = n === w ? 1 : n.startsWith(w) && w.length >= 3 ? 0.85 : 1 - levenshtein(w, n) / Math.max(w.length, n.length);
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.score >= 0.7 ? best.id : undefined;
}

export function resolveRoom(phrase: string, m: MatchState): RoomId | undefined {
  const p = norm(phrase);
  if (!p) return undefined;
  for (const r of m.map.rooms) {
    const aliases = [norm(r.name), ...(ROOM_ALIASES[r.id] ?? [])];
    for (const a of aliases) if (p === a || p.startsWith(a + ' ') || p.split(' ')[0] === a) return r.id;
  }
  // first word fuzzy against room names
  const first = p.split(' ')[0];
  let best: { id: RoomId; score: number } | null = null;
  for (const r of m.map.rooms) {
    const n = norm(r.name);
    const score = 1 - levenshtein(first, n) / Math.max(first.length, n.length);
    if (!best || score > best.score) best = { id: r.id, score };
  }
  return best && best.score >= 0.75 ? best.id : undefined;
}

const PLAYER_RE = '([a-z0-9_]+(?: [a-z0-9_]+)?)';

export function parseChatClaims(text: string, sender: PlayerId, m: MatchState): ParsedClaim[] {
  const t = norm(text);
  const out: ParsedClaim[] = [];
  const add = (c: ParsedClaim) => { if (!out.some(o => o.type === c.type && o.room === c.room && o.about === c.about)) out.push(c); };

  // Location: "i was in X", "im in X", "i was at X", "was in X" (sender), "X was in Y" (sighting)
  for (const mm of t.matchAll(/\b(i was|i m|im|i am|i'm|was|been|i went|went) (?:in|at|to|near) ([a-z0-9 ]{2,20})/g)) {
    const room = resolveRoom(mm[2], m);
    if (room) add({ type: 'location', room });
  }
  for (const mm of t.matchAll(new RegExp(`\\b${PLAYER_RE} (?:was|is|went|came|were) (?:in|at|to|from) ([a-z0-9 ]{2,20})`, 'g'))) {
    const about = resolvePlayer(mm[1], m, sender);
    const room = resolveRoom(mm[2], m);
    if (about && room) add({ type: 'sighting', about, room });
  }
  // Companion: "with X", "X was with me", "me and X"
  for (const mm of t.matchAll(new RegExp(`\\bwith ${PLAYER_RE}`, 'g'))) {
    const about = resolvePlayer(mm[1].split(' ')[0], m, sender);
    if (about) add({ type: 'companion', about });
  }
  for (const mm of t.matchAll(new RegExp(`\\b${PLAYER_RE} (?:was|is) with me`, 'g'))) {
    const about = resolvePlayer(mm[1].split(' ').pop() ?? '', m, sender);
    if (about) add({ type: 'companion', about });
  }
  // Clear: "X is clear/safe", "i saw X scan/do task", "X scanned"
  for (const mm of t.matchAll(new RegExp(`\\b${PLAYER_RE} (?:is |was )?(?:clear|safe|cleared|scanned|did (?:a )?visual)`, 'g'))) {
    const about = resolvePlayer(mm[1].split(' ').pop() ?? '', m, sender);
    if (about) add({ type: 'clear', about });
  }
  for (const mm of t.matchAll(new RegExp(`\\b(?:i )?(?:saw|watched) ${PLAYER_RE} (?:scan|do|did|doing) `, 'g'))) {
    const about = resolvePlayer(mm[1].split(' ').pop() ?? '', m, sender);
    if (about) add({ type: 'clear', about });
  }
  // Accusation: "X is sus", "X sus", "vote X", "it s X", "X vented/killed/faked", "X self report"
  for (const mm of t.matchAll(new RegExp(`\\b${PLAYER_RE} (?:is |was |100 |definitely )?(sus|the imp|the impostor|imp|impostor|vented|vent|killed|kill|faked|faking|self report|self reported)`, 'g'))) {
    const about = resolvePlayer(mm[1].split(' ').pop() ?? '', m, sender);
    const verb = mm[2];
    if (about) add({ type: 'accusation', about, reason: /vent|kill|fake|self/.test(verb) ? verb : undefined });
  }
  for (const mm of t.matchAll(new RegExp(`\\b(?:vote|its|it s|it is) ${PLAYER_RE}`, 'g'))) {
    const about = resolvePlayer(mm[1].split(' ')[0], m, sender);
    if (about) add({ type: 'accusation', about });
  }
  return out;
}

/** Turn parsed claims into Claim records. */
export function toClaims(parsed: ParsedClaim[], base: Omit<Claim, 'type' | 'room' | 'about' | 'text' | 'id'>, text: string, idGen: () => string): Claim[] {
  return parsed.map(p => ({ ...base, id: idGen(), type: p.type, room: p.room, about: p.about, text: p.reason ? `${text} [${p.reason}]` : undefined, verification: 'pending' }));
}
