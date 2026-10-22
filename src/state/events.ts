/**
 * Append-only match event log + reducer.
 *
 * Pure TypeScript (no React, no Tauri) so it is unit-testable and so the NDJSON
 * on disk and the in-memory MatchState can never disagree: the state IS the
 * reduction of the log. Undo is itself an event (`undo`), so the file stays
 * append-only and a replay reproduces exactly what the user saw.
 */
import type {
  MatchState, Observation, Claim, Vote, Ejection, PhaseChange, ChatLine,
  LobbySettings, MapId, Player, PlayerId, Role, MyTask,
} from '../types/game';
import { MAPS } from '../data/maps';
import { nameQuality } from '../engine/rosterConsolidate';

export interface InitPayload {
  id: string;
  startedAt: number;
  settings: LobbySettings;
  map: MapId;
  me: PlayerId;
  myRole: Role;
  players: Player[];
  /** Lobby code, if the user entered one (used to remember presets). */
  lobbyCode?: string;
}

export type MatchEvent =
  | { kind: 'init'; wall: number; payload: InitPayload }
  | { kind: 'observation'; wall: number; payload: Observation }
  | { kind: 'claim'; wall: number; payload: Claim }
  | { kind: 'vote'; wall: number; payload: Vote }
  | { kind: 'ejection'; wall: number; payload: Ejection }
  | { kind: 'phase'; wall: number; payload: PhaseChange }
  | { kind: 'chat'; wall: number; payload: ChatLine }
  /** Patch a player (status, name, knownRole, isPartner). */
  | { kind: 'player'; wall: number; payload: Partial<Player> & { id: PlayerId } }
  | { kind: 'settings'; wall: number; payload: Partial<LobbySettings> }
  | { kind: 'myRole'; wall: number; payload: { role: Role; locked?: boolean; auto?: boolean } }
  /** Re-point "me" at another player (auto-roster could not tell which crewmate is the user). */
  | { kind: 'me'; wall: number; payload: { id: PlayerId } }
  /** Add a player discovered mid-match (auto-roster). */
  | { kind: 'addPlayer'; wall: number; payload: Player }
  /** Drop a junk entry (OCR picked up a UI word as a name). */
  | { kind: 'removePlayer'; wall: number; payload: { id: PlayerId } }
  /** Two cards are the same person: fold `from` into `into` (every observation / claim / vote / chat line follows). */
  | { kind: 'mergePlayers'; wall: number; payload: { from: PlayerId; into: PlayerId; why?: string } }
  /** How many players the screen says there are (vote grid = exact, lobby counter = ±1). */
  | { kind: 'rosterSize'; wall: number; payload: { size: number; source: 'grid' | 'lobby' | 'manual' } }
  /** My task list, read from the top-left of the screen. */
  | { kind: 'myTasks'; wall: number; payload: MyTask[] }
  /** Translation / language detected for a chat line (arrives after the line itself). */
  | { kind: 'chatPatch'; wall: number; payload: { id: string; translated?: string; lang?: string; langConfidence?: number; xlatGuess?: boolean } }
  /** Removes the most recent not-yet-undone undoable event. */
  | { kind: 'undo'; wall: number }
  /** Diagnostics only (why a chat bubble was dropped / unreadable, …): written to the NDJSON, no state change. */
  | { kind: 'diag'; wall: number; payload: { what: string; [k: string]: unknown } };

export type EventKind = MatchEvent['kind'];

/** `init` can't be undone; everything else can. */
export const isUndoable = (e: MatchEvent): boolean => e.kind !== 'init' && e.kind !== 'undo' && e.kind !== 'chatPatch' && e.kind !== 'mergePlayers' && e.kind !== 'rosterSize' && e.kind !== 'diag';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function initState(p: InitPayload): MatchState {
  const players: Record<PlayerId, Player> = {};
  for (const pl of p.players) players[pl.id] = { ...pl };
  return {
    id: p.id,
    startedAt: p.startedAt,
    settings: { ...p.settings },
    map: MAPS[p.map],
    me: p.me,
    myRole: p.myRole,
    lobbyCode: p.lobbyCode,
    players,
    phase: { phase: 'lobby', wall: p.startedAt, round: -1 },
    observations: [],
    chat: [],
    claims: [],
    votes: [],
    ejections: [],
    ledger: [],
  };
}

const PLAYER_KEYS = new Set(['player', 'killer', 'victim', 'reporter', 'sender', 'by', 'about', 'voter', 'target', 'calledBy', 'to', 'companion']);
const PLAYER_LIST_KEYS = new Set(['withPlayers', 'present', 'fixers', /* features: VitalsReadObs */ 'dead', 'alive', 'dc']);

/** Replace every PlayerId-typed reference to `from` with `into` (deep; returns the same object when nothing changed). */
export function repoint<T>(obj: T, from: PlayerId, into: PlayerId, depth = 0): T {
  // Event payloads are JSON (no cycles), but a cyclic or absurdly deep object must not hang a merge.
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 8) return obj;
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let changed = false;
  for (const [k, v] of Object.entries(out)) {
    if (PLAYER_KEYS.has(k) && v === from) { out[k] = into; changed = true; }
    else if (PLAYER_LIST_KEYS.has(k) && Array.isArray(v) && v.includes(from)) { out[k] = v.map(x => (x === from ? into : x)); changed = true; }
    else if (v && typeof v === 'object' && !Array.isArray(v)) { const r = repoint(v, from, into, depth + 1); if (r !== v) { out[k] = r; changed = true; } }
    // features: arrays of objects (DoorLogReadObs.entries[].player) follow merges too.
    else if (Array.isArray(v) && v.some(x => x && typeof x === 'object')) { const arr = v.map(x => repoint(x, from, into, depth + 1)); if (arr.some((x, i) => x !== v[i])) { out[k] = arr; changed = true; } }
  }
  return changed ? (out as T) : obj;
}

const KNOWN_COLOUR = (c: string) => c !== 'unknown' && c !== 'gray';

function patchPlayer(m: MatchState, id: PlayerId, patch: Partial<Player>): MatchState {
  const cur = m.players[id];
  if (!cur) return m;
  return { ...m, players: { ...m.players, [id]: { ...cur, ...patch, id } } };
}

/** Apply one (non-undo) event. Derived effects (body → victim dead, ejection → status) live here. */
export function reduce(m: MatchState, e: MatchEvent): MatchState {
  switch (e.kind) {
    case 'init': return initState(e.payload);
    case 'undo': return m; // handled by replay()
    case 'observation': {
      let next: MatchState = { ...m, observations: [...m.observations, e.payload] };
      const o = e.payload;
      if (o.type === 'bodyFound' && m.players[o.victim]?.status === 'alive') next = patchPlayer(next, o.victim, { status: 'dead' });
      if (o.type === 'sawKill' && m.players[o.victim]?.status === 'alive') next = patchPlayer(next, o.victim, { status: 'dead' });
      return next;
    }
    case 'claim': return { ...m, claims: [...m.claims, e.payload] };
    case 'vote': return { ...m, votes: [...m.votes, e.payload] };
    case 'ejection': {
      let next: MatchState = { ...m, ejections: [...m.ejections, e.payload] };
      const ej = e.payload;
      if (ej.player) {
        const patch: Partial<Player> = { status: 'ejected' };
        if (ej.wasImpostor === true) patch.knownRole = 'impostor';
        if (ej.wasImpostor === false) patch.knownRole = 'crew';
        next = patchPlayer(next, ej.player, patch);
      }
      return next;
    }
    case 'phase': return { ...m, phase: e.payload };
    case 'chat': return { ...m, chat: [...m.chat, e.payload] };
    case 'player': return patchPlayer(m, e.payload.id, e.payload);
    case 'settings': return { ...m, settings: { ...m.settings, ...e.payload }, map: e.payload.map ? MAPS[e.payload.map] : m.map };
    case 'myRole': {
      if (e.payload.auto && m.myRoleLocked) return m; // the user said otherwise
      const me = m.players[m.me];
      const players = me ? { ...m.players, [m.me]: { ...me, knownRole: e.payload.role } } : m.players;
      // Crew have no partner: a switch to crew drops partner flags (they came from a wrong red-name read).
      if (e.payload.role === 'crew') for (const p of Object.values(players)) if (p.isPartner) players[p.id] = { ...p, isPartner: false, knownRole: 'unknown' };
      return { ...m, myRole: e.payload.role, myRoleLocked: e.payload.locked ? true : m.myRoleLocked, players };
    }
    case 'me': {
      const players: Record<PlayerId, Player> = {};
      for (const p of Object.values(m.players)) players[p.id] = { ...p, isMe: p.id === e.payload.id, knownRole: p.id === e.payload.id ? m.myRole : p.id === m.me ? 'unknown' : p.knownRole };
      return { ...m, me: e.payload.id, players };
    }
    case 'addPlayer': return m.players[e.payload.id] ? m : { ...m, players: { ...m.players, [e.payload.id]: e.payload } };
    case 'myTasks': return { ...m, myTasks: e.payload };
    case 'chatPatch': return { ...m, chat: m.chat.map(c => c.id === e.payload.id ? { ...c, ...e.payload, id: c.id } : c) };
    case 'removePlayer': {
      if (!m.players[e.payload.id] || e.payload.id === m.me) return m;
      const players = { ...m.players };
      delete players[e.payload.id];
      return { ...m, players };
    }
    case 'mergePlayers': {
      const { from, into } = e.payload;
      const a = m.players[from], b = m.players[into];
      if (!a || !b || from === into) return m;
      const now = m.phase.meeting ?? 0;
      const merged: Player = {
        ...b,
        name: b.isMe ? b.name : a.isMe ? a.name : nameQuality(a.name) > nameQuality(b.name) ? a.name : b.name,   // my card keeps my name; otherwise the better-spelled name wins
        color: KNOWN_COLOUR(b.color) || !KNOWN_COLOUR(a.color) ? b.color : a.color,
        colorLocked: b.colorLocked || a.colorLocked,
        roleLocked: b.roleLocked || a.roleLocked,
        isMe: b.isMe || a.isMe,
        isPartner: b.isPartner || a.isPartner,
        knownRole: b.knownRole !== 'unknown' ? b.knownRole : a.knownRole,
        // The survivor's status stands when the grid read it this meeting; otherwise the dead never come back.
        status: b.status !== 'alive' || (b.slot !== undefined && b.slotMeeting === now) ? b.status : a.status,
        slot: b.slot ?? a.slot,
        slotMeeting: b.slot !== undefined ? b.slotMeeting : a.slotMeeting,
        aliveLockMeeting: b.aliveLockMeeting ?? a.aliveLockMeeting,
      };
      const players = { ...m.players, [into]: merged };
      delete players[from];
      const rp = <T,>(x: T): T => repoint(x, from, into);
      return { ...m, me: m.me === from ? into : m.me, players, observations: m.observations.map(rp), claims: m.claims.map(rp), votes: m.votes.map(rp), ejections: m.ejections.map(rp), chat: m.chat.map(rp), ledger: m.ledger.map(rp) };
    }
    case 'rosterSize': return { ...m, rosterSize: e.payload.size, rosterSizeSource: e.payload.source };
    case 'diag': return m;
    // A log line from a newer build (unknown kind) must not wipe the state on replay.
    default: return m;
  }
}

/**
 * Collapse `undo` events: each one removes the latest surviving undoable event.
 * Returns the effective event list (no undos, no undone events).
 */
export function effective(log: readonly MatchEvent[]): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (const e of log) {
    if (e.kind === 'undo') {
      for (let i = out.length - 1; i >= 0; i--) {
        if (isUndoable(out[i])) { out.splice(i, 1); break; }
      }
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Full replay from a raw log. Returns null if the log has no `init`. */
export function replay(log: readonly MatchEvent[]): MatchState | null {
  const eff = effective(log);
  const init = eff.find(e => e.kind === 'init');
  if (!init || init.kind !== 'init') return null;
  let m = initState(init.payload);
  for (const e of eff) if (e.kind !== 'init') m = reduce(m, e);
  return m;
}

/** The event an `undo` would remove right now (for the toast), or null. */
export function lastUndoable(log: readonly MatchEvent[]): MatchEvent | null {
  const eff = effective(log);
  for (let i = eff.length - 1; i >= 0; i--) if (isUndoable(eff[i])) return eff[i];
  return null;
}

// ---------------------------------------------------------------------------
// NDJSON
// ---------------------------------------------------------------------------

export const toLine = (e: MatchEvent): string => JSON.stringify(e);

export function parseLines(text: string): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line) as MatchEvent;
      if (e && typeof e === 'object' && typeof (e as { kind?: unknown }).kind === 'string') out.push(e); // `null`, numbers, half lines: skip
    } catch { /* skip corrupt line; fail soft */ }
  }
  return out;
}

/** Monotonic-ish id for observations/claims; readable in the log. */
let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}
