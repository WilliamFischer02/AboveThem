/**
 * Chat → claims: thin compatibility layer over src/engine/chatNlu (the real parser).
 *
 * useGameEvents turns each new chat line into Claim records through parseChatClaims/toClaims,
 * and impostor.ts / MeetingPanel use pushTally. Those APIs are unchanged; the reading itself
 * (slang, misspellings, hedges, negation, pronouns, multi-target lines) now comes from the NLU.
 *
 * Claims are persistent records written once per line, so only context-free, reasonably
 * confident readings become claims here (no bare "red" mentions: those depend on the next
 * line and live only in the NLU's on-demand assertions).
 */
import type { ChatAssertion, Claim, ClaimType, MatchState, PlayerId, RoomId } from '../types/game';
import { parseLine, tagLine } from './chatNlu';

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export type ParsedKind = ClaimType | 'body' | 'dead' | 'myColor';
export interface ParsedClaim { type: ParsedKind; room?: RoomId; about?: PlayerId; about2?: PlayerId; taskId?: string; reason?: string; color?: string }

/** Resolve a word (colour, colour slang or name fragment) to a player. */
export function resolvePlayer(word: string, m: MatchState, exclude?: PlayerId): PlayerId | undefined {
  const w = norm(word);
  if (!w || ['me', 'i', 'you', 'u'].includes(w)) return undefined;
  const p = tagLine(w, m, exclude ?? '\u0000').find(u => u.k === 'P');
  return p?.ids?.[0];
}

export function resolveRoom(phrase: string, m: MatchState): RoomId | undefined {
  return tagLine(norm(phrase), m, '\u0000').find(u => u.room)?.room;
}

export function resolveTask(phrase: string, m: MatchState): string | undefined {
  return tagLine(norm(phrase), m, '\u0000').find(u => u.task)?.task;
}

const REASON: Partial<Record<NonNullable<ChatAssertion['reason']>, string>> = {
  vent: 'vent', kill: 'kill', selfReport: 'self report', followed: 'followed me', fakeTask: 'faked', lying: 'lying',
  nearBody: 'near body', leftBody: 'left body', stack: 'stack',
};
const RANK: Record<ParsedKind, number> = { body: 0, dead: 1, myColor: 2, accusation: 3, defense: 3, clear: 3, sighting: 4, companion: 5, task: 6, location: 7 };

/** Map NLU assertions to the old ParsedClaim shape. */
export function assertionsToParsed(list: ChatAssertion[], sender: PlayerId): ParsedClaim[] {
  const out: (ParsedClaim & { _s: number })[] = [];
  const add = (c: ParsedClaim, s: number) => {
    if (!out.some(o => o.type === c.type && o.room === c.room && o.about === c.about && o.taskId === c.taskId && o.color === c.color)) out.push({ ...c, _s: s });
  };
  for (const a of list) {
    if (a.confidence < 0.5) continue;
    const s = a.span[0];
    const others = a.about.filter(id => id !== sender);
    switch (a.kind) {
      case 'accuse': case 'voteCall': case 'sawVent': case 'selfReport':
        for (const id of others) add({ type: 'accusation', about: id, reason: a.reason ? REASON[a.reason] : undefined }, s);
        break;
      case 'sawKill':
        for (const id of others) add({ type: 'accusation', about: id, about2: a.victim, reason: 'kill' }, s);
        break;
      case 'defense':
        for (const id of others) add({ type: 'defense', about: id }, s);
        break;
      case 'clear': case 'sawTask':
        for (const id of others) add({ type: 'clear', about: id }, s);
        break;
      case 'withMe':
        for (const id of others) add({ type: 'companion', about: id }, s);
        break;
      case 'withOther':
        if (others.length >= 2) add({ type: 'companion', about: others[0], about2: others[1] }, s);
        break;
      case 'sighting':
        for (const id of others) add({ type: 'sighting', about: id, room: a.room }, s);
        break;
      case 'location': if (a.room) add({ type: 'location', room: a.room }, s); break;
      case 'task': if (a.taskId) add({ type: 'task', taskId: a.taskId, room: a.room }, s); break;
      case 'bodyLocation': if (a.room) add({ type: 'body', room: a.room }, s); break;
      case 'dead': for (const id of a.about) add({ type: 'dead', about: id }, s); break;
      case 'myColor': if (a.color) add({ type: 'myColor', color: a.color }, s); break;
      default: break;
    }
  }
  return out.sort((a, b) => RANK[a.type] - RANK[b.type] || a._s - b._s).map(({ _s, ...c }) => {
    void _s;
    for (const k of Object.keys(c) as (keyof ParsedClaim)[]) if (c[k] === undefined && k !== 'reason') delete c[k];
    return c;
  });
}

export function parseChatClaims(text: string, sender: PlayerId, m: MatchState): ParsedClaim[] {
  return assertionsToParsed(parseLine(text, sender, m), sender);
}

/** Turn parsed claims into Claim records (body locations are observations, handled by the caller). */
export function toClaims(parsed: ParsedClaim[], base: Omit<Claim, 'type' | 'room' | 'about' | 'text' | 'id'>, text: string, idGen: () => string): Claim[] {
  return parsed.filter(p => p.type !== 'body' && p.type !== 'dead' && p.type !== 'myColor').map(p => ({
    ...base, id: idGen(), type: p.type as ClaimType, room: p.room, about: p.about, taskId: p.taskId,
    text: p.reason ? `${text} [${p.reason}]` : p.about2 ? `${text} [+${p.about2}]` : undefined, verification: 'pending',
  }));
}

/** Who is being pushed this meeting, by whom. */
export function pushTally(m: MatchState, meeting: number): { target: PlayerId; accusers: PlayerId[]; defenders: PlayerId[] }[] {
  const map = new Map<PlayerId, { accusers: Set<PlayerId>; defenders: Set<PlayerId> }>();
  for (const c of m.claims) {
    if (c.meeting !== meeting || !c.about) continue;
    const e = map.get(c.about) ?? { accusers: new Set(), defenders: new Set() };
    if (c.type === 'accusation') e.accusers.add(c.by);
    if (c.type === 'defense' || c.type === 'clear') e.defenders.add(c.by);
    map.set(c.about, e);
  }
  return [...map.entries()].map(([target, e]) => ({ target, accusers: [...e.accusers], defenders: [...e.defenders] }))
    .filter(x => x.accusers.length + x.defenders.length > 0)
    .sort((a, b) => b.accusers.length - a.accusers.length);
}
