/**
 * Match store (Zustand).
 *
 * The store holds the raw event log and the MatchState derived from it. Every
 * mutation is an event: it is appended to the log, applied to the state, and
 * written to `%APPDATA%/AboveThem/matches/<id>.ndjson` through `persist`.
 * Undo appends an `undo` event and replays, so disk and memory never diverge.
 */
import { create } from 'zustand';
import type { MatchState, Observation, Phase, PhaseChange, Stamp } from '../types/game';
import {
  type MatchEvent, type InitPayload, reduce, replay, effective, lastUndoable, newId,
} from './events';
import { type ClockState, initialClock, clockOnPhase, stampAt } from './clock';
import { persist } from './persist';

export interface Toast { id: number; text: string; undoable: boolean; at: number }

type Dispatchable = Exclude<MatchEvent, { kind: 'init' } | { kind: 'undo' }>;
type WithoutWall<E> = E extends { wall: number } ? Omit<E, 'wall'> : never;

/** Fields the caller supplies for an observation; id/stamp/source/confidence are filled in. */
export type ObservationInput = {
  [K in Observation['type']]: Omit<Extract<Observation, { type: K }>, 'id' | 'stamp' | 'source' | 'confidence'> &
    { source?: Observation['source']; confidence?: number; stamp?: Stamp };
}[Observation['type']];

interface Store {
  matchId: string | null;
  log: MatchEvent[];
  match: MatchState | null;
  clock: ClockState;
  toast: Toast | null;
  /** First key of a chord in progress (set by the hotkey layer). */
  pending: string | null;
  /** Last persist error, if any (shown in the status bar; the app keeps working). */
  diskError: string | null;
  /** In-game headshots per player (data URLs). Not part of the event log. */
  avatars: Record<string, string>;
  setAvatar: (id: string, dataUrl: string) => void;
  /** Last measured body RGB per player from the vote grid (for colour calibration). */
  bodySamples: Record<string, [number, number, number]>;
  setBodySample: (id: string, rgb: [number, number, number]) => void;
  /** Perceptual hash of each player's vote-grid icon (hex). Lets re-sorted grids keep identities. */
  iconHashes: Record<string, string>;
  setIconHash: (id: string, hash: string) => void;
  /** 0..1 from the last vote-grid read: how well the roster mirrors the screen (null = no read yet). */
  rosterConfidence: number | null;
  setRosterConfidence: (c: number | null) => void;

  newMatch: (init: Omit<InitPayload, 'id' | 'startedAt'>) => string;
  loadMatch: (id: string) => Promise<boolean>;
  closeMatch: () => void;
  dispatch: (e: WithoutWall<Dispatchable>) => void;
  observe: (o: ObservationInput, toastText?: string) => Observation;
  setPhase: (phase: Phase, extra?: Partial<Omit<PhaseChange, 'phase' | 'wall'>>) => void;
  undo: () => void;
  stamp: () => Stamp;
  showToast: (text: string, undoable?: boolean) => void;
  clearToast: () => void;
  setPending: (code: string | null) => void;
}

const SOURCE_CONFIDENCE: Record<Observation['source'], number> = { me: 0.95, ocr: 0.8, mod: 1, manual: 0.9 };

function clockFromLog(log: readonly MatchEvent[]): ClockState {
  let c = initialClock;
  for (const e of effective(log)) if (e.kind === 'phase') c = clockOnPhase(c, e.payload);
  return c;
}

let toastSeq = 0;

/** Headshots / icon hashes / body samples live outside the event log; cache them per match on disk
 *  (`avatars_<matchId>.json`) so an app restart (every Rust rebuild) does not lose the faces. */
let avatarTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAvatarSave(get: () => { matchId: string | null; avatars: Record<string, string>; iconHashes: Record<string, string>; bodySamples: Record<string, [number, number, number]> }) {
  if (avatarTimer) clearTimeout(avatarTimer);
  avatarTimer = setTimeout(() => {
    const s = get();
    if (!s.matchId) return;
    persist.writeJson(`avatars_${s.matchId}.json`, { avatars: s.avatars, iconHashes: s.iconHashes, bodySamples: s.bodySamples }).catch(() => {});
  }, 1500);
}

export const useMatch = create<Store>((set, get) => {
  const append = (e: MatchEvent) => {
    const id = get().matchId;
    if (!id) return;
    persist.appendEvent(id, e).catch(err => set({ diskError: String(err) }));
  };

  return {
    matchId: null,
    log: [],
    match: null,
    clock: initialClock,
    toast: null,
    pending: null,
    diskError: null,
    avatars: {},
    setAvatar: (id, dataUrl) => { set(s => ({ avatars: { ...s.avatars, [id]: dataUrl } })); scheduleAvatarSave(get); },
    bodySamples: {},
    setBodySample: (id, rgb) => { set(s => ({ bodySamples: { ...s.bodySamples, [id]: rgb } })); scheduleAvatarSave(get); },
    iconHashes: {},
    setIconHash: (id, hash) => { set(s => ({ iconHashes: { ...s.iconHashes, [id]: hash } })); scheduleAvatarSave(get); },
    rosterConfidence: null,
    setRosterConfidence: (c) => set({ rosterConfidence: c }),

    newMatch: (init) => {
      const startedAt = Date.now();
      const id = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const e: MatchEvent = { kind: 'init', wall: startedAt, payload: { ...init, id, startedAt } };
      set({ matchId: id, log: [e], match: reduce(null as unknown as MatchState, e), clock: initialClock, toast: null, diskError: null, rosterConfidence: null });
      append(e);
      return id;
    },

    loadMatch: async (id) => {
      const log = await persist.readMatch(id);
      const match = replay(log);
      if (!match) return false;
      const cache = await persist.readJson<{ avatars?: Record<string, string>; iconHashes?: Record<string, string>; bodySamples?: Record<string, [number, number, number]> }>(`avatars_${id}.json`).catch(() => null);
      set({ matchId: id, log, match, clock: clockFromLog(log), toast: null, avatars: cache?.avatars ?? {}, iconHashes: cache?.iconHashes ?? {}, bodySamples: cache?.bodySamples ?? {}, rosterConfidence: null });
      return true;
    },

    closeMatch: () => set({ matchId: null, log: [], match: null, clock: initialClock, toast: null }),

    dispatch: (partial) => {
      const s = get();
      if (!s.match) return;
      const e = { ...partial, wall: Date.now() } as MatchEvent;
      const match = reduce(s.match, e);
      const clock = e.kind === 'phase' ? clockOnPhase(s.clock, e.payload) : s.clock;
      set({ log: [...s.log, e], match, clock });
      append(e);
    },

    observe: (input, toastText) => {
      const s = get();
      const source = input.source ?? 'me';
      const obs = {
        ...input,
        id: newId('o'),
        stamp: input.stamp ?? s.stamp(),
        source,
        confidence: input.confidence ?? SOURCE_CONFIDENCE[source],
      } as Observation;
      s.dispatch({ kind: 'observation', payload: obs });
      if (toastText) s.showToast(toastText, true);
      return obs;
    },

    setPhase: (phase, extra) => {
      const s = get();
      if (!s.match) return;
      const nextClock = clockOnPhase(s.clock, { phase, wall: Date.now(), round: s.clock.round });
      const meetings = effective(s.log).filter(e => e.kind === 'phase' && e.payload.phase === 'meetingDiscussion').length;
      const payload: PhaseChange = {
        phase,
        wall: Date.now(),
        round: Math.max(0, nextClock.round),
        meeting: phase === 'meetingDiscussion' ? meetings : s.match.phase.meeting,
        ...extra,
      };
      s.dispatch({ kind: 'phase', payload });
    },

    undo: () => {
      const s = get();
      if (!s.match) return;
      const target = lastUndoable(s.log);
      if (!target) { s.showToast('Nothing to undo', false); return; }
      const e: MatchEvent = { kind: 'undo', wall: Date.now() };
      const log = [...s.log, e];
      const match = replay(log);
      set({ log, match, clock: clockFromLog(log) });
      append(e);
      s.showToast(`Undid: ${describe(target)}`, false);
    },

    stamp: () => stampAt(get().clock, Date.now()),

    showToast: (text, undoable = false) => set({ toast: { id: ++toastSeq, text, undoable, at: Date.now() } }),
    clearToast: () => set({ toast: null }),
    setPending: (code) => set({ pending: code }),
  };
});

/** One-line human description of an event, for toasts and the timeline. */
export function describe(e: MatchEvent): string {
  switch (e.kind) {
    case 'init': return 'match start';
    case 'undo': return 'undo';
    case 'observation': {
      const o = e.payload;
      switch (o.type) {
        case 'sighting': return `${o.player} in ${o.room}${o.heading ? ' → ' + o.heading : ''}${o.alone ? ' (alone)' : ''}`;
        case 'withMe': return `${o.player} ${o.on ? 'with me' : 'left me'} in ${o.room}`;
        case 'myRoom': return `me → ${o.room}`;
        case 'sawTask': return `${o.player} ${o.visualConfirmed ? 'VISUAL task' : 'task'} in ${o.room}`;
        case 'sawVent': return `${o.player} VENTED in ${o.room}`;
        case 'sawKill': return `${o.killer} KILLED ${o.victim} in ${o.room}`;
        case 'bodyFound': return `body: ${o.victim} in ${o.room}${o.reporter ? ' (reported by ' + o.reporter + ')' : ''}`;
        case 'sabotage': return `sabotage ${o.kind} ${o.phase}`;
        case 'manualMark': return `${o.player} marked ${o.mark}`;
        case 'adminRead': return `admin: ${Object.entries(o.counts).map(([r, n]) => `${n} ${r}`).join(', ') || 'empty'}`;
        case 'vitalsRead': return `vitals: ${o.dead.length ? o.dead.join(', ') + ' dead' : 'all alive'}`;
      }
      return 'observation';
    }
    case 'claim': return `${e.payload.by} claims ${e.payload.type}${e.payload.room ? ' ' + e.payload.room : ''}${e.payload.about ? ' re ' + e.payload.about : ''}`;
    case 'vote': return `${e.payload.voter} voted ${e.payload.target}`;
    case 'ejection': return e.payload.player ? `${e.payload.player} ejected` : 'no ejection';
    case 'phase': return `phase → ${e.payload.phase}`;
    case 'chat': return `chat: ${e.payload.sender}`;
    case 'player': return `player ${e.payload.id} updated`;
    case 'settings': return 'settings updated';
    case 'myRole': return `my role: ${e.payload.role}`;
    case 'me': return `me = ${e.payload.id}`;
    case 'addPlayer': return `player ${e.payload.name} joined`;
    case 'removePlayer': return `removed ${e.payload.id}`;
    case 'mergePlayers': return `merged ${e.payload.from} into ${e.payload.into}`;
    case 'rosterSize': return `${e.payload.size} players (${e.payload.source})`;
    case 'myTasks': return `my tasks: ${e.payload.map(t => t.name).join(', ')}`;
    case 'chatPatch': return `translation`;
  }
}
