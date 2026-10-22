/**
 * The automatic layer on the frontend: starts capture + the Rust watcher when
 * the game window exists, and turns `game://*` events into store events.
 *
 *  game://lobby     → remembers the lobby code (and applies a saved preset)
 *  game://role      → my role for this match
 *  game://roster    → creates the match on the first meeting if none exists,
 *                     otherwise matches cards to players (name / icon / slot), marks dead
 *  game://phase     → round start / meeting / ejection / next round; a round start after a
 *                     finished game rolls the lobby into a fresh match
 *  game://game_over → VICTORY / DEFEAT screen (word or text colour)
 *  game://eject     → ejection event (who, impostor or not)
 *  game://chat      → chat lines → claims; non-English lines are translated
 */
import { useEffect, useRef, useState } from 'react';
import { useMatch } from '../state/store';
import { isTauri, persist } from '../state/persist';
import { loadSettings, DEFAULT_APP_SETTINGS, type AppSettings } from '../state/settings';
import { loadPresets, DEFAULT_SETTINGS } from '../state/presets';
import { COLOR_IDS } from '../ui/palette';
import { MAPS } from '../data/maps';
import { parseChatClaims, toClaims } from '../engine/chatClaims';
import { matchGrid, rosterConfidence, norm, similarity, nameScore, type GridEntry, type RosterPlayer } from '../engine/rosterMatch';
import { consolidate, NAME_MAX, isPlaceholderName, nameQuality, type ConsolidatePlayer } from '../engine/rosterConsolidate';
import { emptyBook, learnAlias, learnJunk, learnName, isJunk, resolve, snapList, prune, bestReading, type NameBook } from '../engine/nameBook';
import { newId } from '../state/events';
import { myRoomNow } from './useHotkeys';
import { translationRequest, senderByIconColor, captureVerdict, watcherStalled, type ChatPayload, type CaptureSnap } from './eventHelpers';
import { inferMapFromLabels, mapIdFromText } from '../engine/map';
import type { MapId, MyTask, Phase, Player, PlayerColor, PlayerId, Role } from '../types/game';

export interface RosterEntry { index: number; name: string; name_confidence: number; color: string; color_delta_e: number; dead: boolean; reporter: boolean; avatar_png?: string; body_rgb?: [number, number, number]; icon_hash?: string; dim?: number }
interface PhaseEvent { phase: string; round: number; meeting: number; lag_ms?: number }
interface EjectEvent { raw: string; name: string | null; was_impostor: boolean | null; skipped: boolean }
interface GameOverEvent { outcome: 'victory' | 'defeat' | null; accent: 'teal' | 'blue' | 'red' | null }
export interface WatcherStatus { running: boolean; phase: string | null; round: number; meeting: number; markers: Record<string, boolean>; last_ocr_ms: number; ocr_calls: number; frame_seq: number; lobby_code: string | null }

/** UI words the lobby reader can mistake for names when a settings panel is open. */
const NOT_NAMES = /^(roles?|role amounts?|crewmate roles?|impostor roles?|scientist|engineer|guardian angel|noisemaker|tracker|shapeshifter|phantom|detective|viper|% ?chance|chance|amount|cosmetics|host|back|close|apply|reset|general|chat|filters?|map|skeld|mira hq|polus|airship|fungle|waiting for host|starting in \d+)$/i;
/** A name the game could have accepted: 2–12 characters, no brackets (the host line reads "Name (Red)"), not a UI word. */
const plausibleName = (n: string) => !NOT_NAMES.test(n.trim()) && !/^[\W_]+$/.test(n) && n.trim().length >= 2 && n.trim().length <= NAME_MAX && !/[()]/.test(n);
/** Lobby names must be seen in two consecutive reads before they become players. */
const lobbySeen = new Map<string, number>();

// --- Map detection memory (maps agent). Module-level on purpose: the event effect below re-runs whenever the
// lobby code changes, and the watcher emits `game://map` only once per change — usually in the same tick as
// `game://lobby` — so an effect-local variable lost it and every game started on the default map (Skeld).
/** Last map read from the screen, and how sure we are ('lobby' panel / settings line beats label inference). */
let detectedMap: { id: MapId; source: 'lobby' | 'infer' } | null = null;
/** Room popups / task-list lines seen in the current match: enough unique names reveal the map (fail-soft path). */
let mapLabels: { matchId: string | null; labels: string[] } = { matchId: null, labels: [] };
/** Feed one on-screen label; switches the match map when the labels clearly point at another map (unless the lobby panel said otherwise). */
function inferMapFrom(label: string) {
  const s = useMatch.getState();
  const m = s.match;
  if (!m || !label.trim()) return;
  if (mapLabels.matchId !== m.id) mapLabels = { matchId: m.id, labels: [] };
  mapLabels.labels.push(label);
  if (mapLabels.labels.length > 40) mapLabels.labels.shift();
  if (detectedMap?.source === 'lobby' && detectedMap.id === m.settings.map) return;
  const guess = inferMapFromLabels(mapLabels.labels, Object.values(MAPS));
  if (!guess || guess.map === m.settings.map) return;
  detectedMap = { id: guess.map, source: 'infer' };
  s.dispatch({ kind: 'settings', payload: { map: guess.map } });
  s.showToast(`Map: ${MAPS[guess.map].name} (auto, from ${guess.hits.slice(0, 3).join(', ')})`);
}

function fuzzyFind<T extends { name: string }>(name: string, list: T[]): T | undefined {
  let best: { item: T; score: number } | null = null;
  for (const item of list) {
    const score = nameScore(name, item.name);
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.6 ? best.item : undefined;
}

/** Build players from a roster read; `myName` picks "me" (falls back to the first entry, flagged by `meGuessed`). */
export function playersFromRoster(entries: RosterEntry[], myName: string, meeting = 0): { players: Player[]; me: PlayerId; meGuessed: boolean } {
  const used = new Set<PlayerColor>();
  const players: Player[] = [];
  for (const e of entries) {
    let color = (COLOR_IDS as string[]).includes(e.color) ? (e.color as PlayerColor) : 'gray';
    if (used.has(color)) color = COLOR_IDS.find(c => !used.has(c)) ?? 'unknown';
    used.add(color);
    players.push({ id: color === 'unknown' ? `p${e.index}` : color, name: e.name, color, isMe: false, status: e.dead ? 'dead' : 'alive', knownRole: 'unknown', slot: e.index + 1, slotMeeting: meeting });
  }
  const mine = myName ? fuzzyFind(myName, players) : undefined;
  const me = mine ?? players[0];
  for (const p of players) p.isMe = p.id === me.id;
  return { players, me: me.id, meGuessed: !mine };
}

/** Has this match seen any play? (Decides whether a role card / lobby means "new game".) */
export function playedRounds(m: { phase: { phase: string; round: number }; observations: unknown[]; claims: unknown[]; ejections: unknown[]; chat: unknown[]; players: Record<string, { status: string }> }): boolean {
  if (m.phase.phase === 'gameOver') return true;
  if (m.phase.phase === 'lobby') return false;
  return m.phase.round >= 0 && (m.observations.length + m.claims.length + m.ejections.length > 0 || Object.values(m.players).some(p => p.status !== 'alive'));
}

// looksEnglish lives in ./eventHelpers (script-aware, tested); re-exported for old importers.
export { looksEnglish } from './eventHelpers';

/** Diagnostics raised while no match is open (capture failing before the game) wait here and are written
 *  into the next match's NDJSON, so a log always explains how capture got there. */
const diagQueue: Array<{ what: string; at: number; [k: string]: unknown }> = [];
function logDiag(payload: { what: string; [k: string]: unknown }) {
  const s = useMatch.getState();
  if (s.match) { s.dispatch({ kind: 'diag', payload }); return; }
  diagQueue.push({ ...payload, at: Date.now() });
  if (diagQueue.length > 20) diagQueue.shift();
}
useMatch.subscribe((st, prev) => {
  if (st.matchId && st.matchId !== prev.matchId && diagQueue.length) {
    for (const d of diagQueue.splice(0)) st.dispatch({ kind: 'diag', payload: { ...d, queued: true } });
  }
});

/** What the auto layer knows about its own health (AutoStatus shows it). Times are wall ms. */
export interface AutoHealth {
  /** Capture was working and then stopped / failed (null while fine or never started). */
  captureLostAt: number | null;
  captureError: string | null;
  /** The watcher thread died / stalled (null while fine). */
  watcherDownAt: number | null;
  watcherProblem: string | null;
}

export function useGameEvents() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [watcher, setWatcher] = useState<WatcherStatus | null>(null);
  const [captureOk, setCaptureOk] = useState<boolean | null>(null);
  const [health, setHealth] = useState<AutoHealth>({ captureLostAt: null, captureError: null, watcherDownAt: null, watcherProblem: null });
  const [meGuessed, setMeGuessed] = useState(false);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const resetRosterRef = useRef<() => void>(() => {});
  /** The resume-from-disk attempt has finished: only then may a screen read create a new match
   *  (a reload mid-game otherwise races the resume and starts a fresh match with everyone alive). */
  const resumeDone = useRef(!isTauri());
  /** What the app has learned about names across games (`names.json`); every user fix feeds it. */
  const bookRef = useRef<NameBook>(emptyBook());
  const lobbyRef = useRef<string | null>(null);
  const bookSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const learn = (fn: (b: NameBook) => NameBook) => {
    bookRef.current = fn(bookRef.current);
    if (bookSave.current) clearTimeout(bookSave.current);
    bookSave.current = setTimeout(() => { persist.writeJson('names.json', bookRef.current).catch(() => {}); }, 1500);
  };
  useEffect(() => {
    persist.readJson<NameBook>('names.json').then(b => { if (b && b.version === 1) bookRef.current = prune(b, Date.now()); }).catch(() => {});
  }, []);
  useEffect(() => { lobbyRef.current = lobbyCode; }, [lobbyCode]);
  /** Latest settings for the event wiring (typing your name must not re-register every listener). */
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;
  const settingsLoaded = settings !== null;

  useEffect(() => { loadSettings().catch(() => ({ ...DEFAULT_APP_SETTINGS })).then(setSettings); }, []);

  // Resume the most recent match after a restart/reload (logs persist; memory doesn't).
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        if (useMatch.getState().match) return;
        const list = await persist.listMatches().catch(() => []);
        const newest = list[0];
        if (!newest || Date.now() - newest.modified_ms > 20 * 60_000) return;
        const ok = await useMatch.getState().loadMatch(newest.id);
        if (ok) useMatch.getState().showToast(`Resumed match ${newest.id}`);
      } catch { /* unreadable log: start fresh (fail soft) */ } finally { resumeDone.current = true; }
    })();
  }, []);

  // Keep the OCR snap-list in sync with the roster (names added, renamed, rescanned).
  useEffect(() => {
    if (!isTauri()) return;
    let last = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useMatch.subscribe(st => {
      const roster = st.match ? Object.values(st.match.players).map(p => p.name).filter(n => n && !n.startsWith('#')) : [];
      const names = snapList(bookRef.current, roster, lobbyRef.current);
      const key = names.join('|');
      if (key === last) return;
      last = key;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { import('@tauri-apps/api/core').then(({ invoke }) => invoke('watcher_set_names', { names })).catch(() => {}); }, 300);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);

  // Auto-start capture + watcher whenever the game window exists (retry every 8 s).
  useEffect(() => {
    if (!isTauri() || !settings?.autoCapture) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Capture health across ticks: was it ever working, since when is it lost, last error logged.
    let everOk = false;
    let lostAt: number | null = null;
    let lastErr: string | null = null;
    let lastRestart = 0;
    let watcherDown: number | null = null;
    const tick = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const now = Date.now();
        const st = await invoke<CaptureSnap>('capture_status');
        const verdict = captureVerdict(st, now);
        let ok = verdict === 'ok';
        // Running but no frames (window re-created by a resolution / borderless toggle, Graphics Capture stalled):
        // restart it, at most every 30 s.
        if (verdict === 'stale' && now - lastRestart > 30_000) {
          lastRestart = now;
          logDiag({ what: 'captureRestart', why: st.seq === 0 ? 'no frame since start' : 'no new frame', ageMs: st.age_ms, seq: st.seq });
          await invoke('capture_stop').catch(() => {});
        }
        if (verdict !== 'ok') {
          try {
            const s2 = await invoke<CaptureSnap>('capture_start', { title: 'Among Us', minIntervalMs: 200 });
            ok = true;
            logDiag({ what: 'captureStart', title: s2.title ?? null, after: lostAt ? 'lost' : everOk ? 'restart' : 'first' });
          } catch (err) {
            ok = false;
            const msg = String(err).slice(0, 200);
            // Every new reason once (a missing window repeats every 8 s; don't flood the log).
            if (msg !== lastErr) logDiag({ what: 'captureFailed', error: msg, wasRunning: everOk });
            lastErr = msg;
          }
        }
        if (ok) { everOk = true; lostAt = null; lastErr = null; }
        else if (everOk && lostAt === null) lostAt = now;
        setCaptureOk(ok);
        const w = await invoke<WatcherStatus & { started_ms?: number; last_frame_ms?: number; stopped_ms?: number; last_panic?: string | null }>('watcher_status');
        let problem: string | null = null;
        if (!w.running) {
          if (w.last_panic || w.stopped_ms) logDiag({ what: 'watcherRestart', panic: w.last_panic ?? null, stoppedMs: w.stopped_ms ?? null });
          if (w.last_panic) problem = `crashed: ${w.last_panic.slice(0, 80)}`;
          await invoke('watcher_start');
        } else if (watcherStalled(w, ok && st.age_ms < 5_000, now)) {
          problem = 'not reading frames';
          if (watcherDown === null) logDiag({ what: 'watcherStalled', lastFrameMs: w.last_frame_ms ?? null });
        }
        watcherDown = problem ? (watcherDown ?? now) : null;
        const h: AutoHealth = { captureLostAt: lostAt, captureError: ok ? null : lastErr, watcherDownAt: watcherDown, watcherProblem: problem };
        setHealth(prev => (prev.captureLostAt === h.captureLostAt && prev.captureError === h.captureError && prev.watcherDownAt === h.watcherDownAt && prev.watcherProblem === h.watcherProblem ? prev : h));
      } catch { /* not in tauri */ }
      if (!stop) timer = setTimeout(tick, 8000);
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [settings?.autoCapture]);

  // Event wiring.
  useEffect(() => {
    if (!isTauri() || !settings) return;
    const unlisten: Array<() => void> = [];
    let cancelled = false;
    let creating = false;
    let role: Role | null = null;
    let roleAt = 0;
    let pendingMap: MapId | null = detectedMap?.id ?? null;
    let pendingSettings: Record<string, unknown> = {};
    let bannerReason: 'body' | 'button' | null = null;
    const lastAutoSighting = new Map<string, number>();
    const redSeen = new Map<string, number>();
    /** Vote-grid colour votes per player: three agreeing reads change an unlocked colour. */
    const colorVotes = new Map<string, { color: string; n: number }>();
    const translated = new Map<string, { text: string; lang: string | null }>();
    /** Grid readings of each card's name this match (spelling votes). */
    const nameVotes = new Map<string, Record<string, number>>();

    /** The role card read for *this* game (a card older than 30 s belongs to the previous one). */
    const freshRole = (): Role => (role && Date.now() - roleAt < 30_000 ? role : 'crew');

    /** Game ended (or a new one started without us seeing the end): keep the lobby, wipe the slate.
     *  `keepRoster = false` (new room code, Reset roster) keeps only me. */
    const rollOver = (why: string, keepRoster = true, code: string | null = lobbyRef.current) => {
      const st = useMatch.getState();
      const cur = st.match;
      if (!cur) return;
      const { avatars, bodySamples, iconHashes } = st;
      // Drop placeholders ("#N") and chat-created cards that never got a vote-grid slot; everyone else carries over alive.
      const players = Object.values(cur.players)
        .filter(p => p.isMe || (keepRoster && !p.name.startsWith('#') && !(p.id.startsWith('chat') && p.slot === undefined)))
        .map(p => ({ ...p, status: 'alive' as const, knownRole: p.isMe ? freshRole() : 'unknown' as const, isPartner: false, slot: undefined, slotMeeting: undefined, gridOrder: undefined }));
      st.newMatch({ settings: cur.settings, map: cur.settings.map, me: cur.me, myRole: freshRole(), players, lobbyCode: code ?? undefined });
      const live = useMatch.getState();
      const keep = new Set(players.map(p => p.id));
      for (const [id, url] of Object.entries(avatars)) if (keep.has(id)) live.setAvatar(id, url);
      for (const [id, rgb] of Object.entries(bodySamples)) if (keep.has(id)) live.setBodySample(id, rgb);
      for (const [id, h] of Object.entries(iconHashes)) if (keep.has(id)) live.setIconHash(id, h);
      live.showToast(keepRoster ? `${why} — roster kept, slate wiped (auto)` : `${why} — fresh roster`);
    };
    resetRosterRef.current = () => rollOver('Roster reset', false);

    /** Vote-grid card count per meeting: trusted once two reads agree (a fading grid can be short). */
    let gridCount = { meeting: -1, n: 0, seen: 0 };

    /**
     * Merge duplicate cards (OCR spellings, "(Black)", chat senders) into the better-evidenced card and
     * drop the weakest cards until the roster fits what the screen says: vote-grid cards (exact) or the
     * lobby CAPACITY counter (±1). Disconnected players are not on screen and are left alone.
     */
    const tidyRoster = (why: string, tolerance: number) => {
      const st = useMatch.getState();
      const m = st.match;
      if (!m) return;
      const refs = new Map<string, number>();
      const bump = (id: unknown) => { if (typeof id === 'string') refs.set(id, (refs.get(id) ?? 0) + 1); };
      for (const o of m.observations) { const r = o as unknown as Record<string, unknown>; bump(r.player); bump(r.victim); bump(r.killer); bump(r.reporter); }
      for (const c of m.claims) { bump(c.by); bump(c.about); }
      for (const v of m.votes) { bump(v.voter); bump(v.target); }
      for (const c of m.chat) bump(c.sender);
      const meeting = m.phase.meeting ?? 0;
      const cps: ConsolidatePlayer[] = Object.values(m.players).filter(p => p.status !== 'disconnected').map(p => ({
        id: p.id, name: p.name, color: p.color, status: p.status, isMe: p.isMe, slot: p.slot, slotMeeting: p.slotMeeting,
        iconHash: st.iconHashes[p.id], colorLocked: p.colorLocked, roleLocked: p.roleLocked, refs: refs.get(p.id) ?? 0,
      }));
      const actions = consolidate(cps, { size: m.rosterSize ?? null, tolerance, meeting });
      const merged: string[] = []; const dropped: string[] = [];
      for (const a of actions) {
        const live = useMatch.getState();
        if (!live.match) return;
        if (a.kind === 'merge') {
          const from = live.match.players[a.from], into = live.match.players[a.into];
          if (!from || !into) continue;
          // Headshot / icon hash / body sample follow the survivor when it has none of its own.
          if (!live.avatars[a.into] && live.avatars[a.from]) live.setAvatar(a.into, live.avatars[a.from]);
          if (!live.iconHashes[a.into] && live.iconHashes[a.from]) live.setIconHash(a.into, live.iconHashes[a.from]);
          if (!live.bodySamples[a.into] && live.bodySamples[a.from]) live.setBodySample(a.into, live.bodySamples[a.from]);
          live.dispatch({ kind: 'mergePlayers', payload: { from: a.from, into: a.into, why: a.why } });
          merged.push(`${from.name} → ${into.name}`);
          // The misread spelling becomes an alias of the surviving one.
          const keep = nameQuality(into.name) >= nameQuality(from.name) ? into.name : from.name;
          const lost = keep === into.name ? from.name : into.name;
          if (!isPlaceholderName(lost) && !isPlaceholderName(keep)) learn(b => learnAlias(b, lost, keep, Date.now(), 'merge'));
        } else {
          const p = live.match.players[a.id];
          if (!p || p.isMe) continue;
          live.dispatch({ kind: 'removePlayer', payload: { id: a.id } });
          dropped.push(p.name);
          // A card that never reached the vote grid and got dropped is probably not a name at all.
          if (p.slot === undefined && !isPlaceholderName(p.name)) learn(b => learnJunk(b, p.name, Date.now(), false));
        }
      }
      if (merged.length || dropped.length) useMatch.getState().showToast(`${why}: ${[merged.length ? `merged ${merged.join(', ')}` : '', dropped.length ? `dropped ${dropped.join(', ')}` : ''].filter(Boolean).join('; ')}`);
    };

    const translateLine = async (id: string, msg: ChatPayload) => {
      const req = translationRequest(msg);
      if (!req) return;
      const { text, from, guess } = req;
      const s = useMatch.getState();
      const key = `${from ?? ''}|${text.trim().toLowerCase()}`;
      const cached = translated.get(key);
      if (cached) { s.dispatch({ kind: 'chatPatch', payload: { id, translated: cached.text || undefined, lang: cached.lang ?? undefined, ...(guess && cached.text ? { xlatGuess: true } : {}) } }); return; }
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const r = await invoke<{ text: string; detected: string | null; provider: string }>('translate_text', { req: { text, to: 'en', ...(from ? { from } : {}) } });
        const lang = r.detected ?? null;
        const changed = r.text.trim().length > 0 && norm(r.text) !== norm(text) && lang !== 'en';
        const result = { text: changed ? r.text : '', lang };
        translated.set(key, result);
        if (translated.size > 300) translated.delete(translated.keys().next().value as string);
        useMatch.getState().dispatch({ kind: 'chatPatch', payload: { id, translated: changed ? r.text : undefined, lang: lang ?? undefined, ...(guess && changed ? { xlatGuess: true } : {}) } });
      } catch (err) {
        // Offline or provider down: the original stays. Logged so a silent failure is visible in the NDJSON.
        useMatch.getState().dispatch({ kind: 'diag', payload: { what: 'translateFailed', line: id, error: String(err).slice(0, 200) } });
      }
    };

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      // StrictMode runs effects twice; if we were cleaned up while awaiting, drop everything we register.
      const guard = <T,>(un: () => void) => { if (cancelled) un(); else unlisten.push(un); return un as unknown as T; };

      guard(await listen<WatcherStatus>('game://watcher', e => setWatcher(e.payload)));

      guard(await listen<string>('game://lobby', async e => {
        setLobbyCode(e.payload);
        lobbyRef.current = e.payload;
        const cur = useMatch.getState().match;
        // A different room code means different people: start over with just me.
        if (cur && cur.lobbyCode && cur.lobbyCode !== e.payload) { rollOver(`New lobby ${e.payload}`, false, e.payload); return; }
        useMatch.getState().showToast(`Lobby ${e.payload} detected`);
      }));

      guard(await listen<{ current: number; max: number }>('game://capacity', e => {
        const s = useMatch.getState();
        const m = s.match;
        if (!m || playedRounds(m)) return;   // the lobby counter only matters before the game starts
        if (m.rosterSize !== e.payload.current || m.rosterSizeSource !== 'lobby') s.dispatch({ kind: 'rosterSize', payload: { size: e.payload.current, source: 'lobby' } });
        tidyRoster('Lobby count', 1);
      }));

      guard(await listen<string>('game://role', e => {
        role = e.payload === 'impostor' ? 'impostor' : 'crew';
        roleAt = Date.now();
        const s = useMatch.getState();
        if (s.match && s.match.myRole !== role && !s.match.myRoleLocked) {
          s.dispatch({ kind: 'myRole', payload: { role, auto: true } });
          s.showToast(`You are ${role === 'impostor' ? 'IMPOSTOR' : 'crew'} (read from the screen)`);
        }
      }));

      guard(await listen<{ source: 'lobby' | 'grid'; entries: RosterEntry[] }>('game://roster', async e => {
        const s = useMatch.getState();
        const { source } = e.payload;
        let entries = e.payload.entries;
        // A grid read with several unreadable cells is occluded (chat panel, fade) — ignore it.
        if (source === 'grid' && entries.filter(x => x.name.startsWith('#')).length >= 3) return;
        // The grid fills without gaps: a lone card after a gap is UI text misread as a card.
        let gridComplete = false;
        if (source === 'grid') {
          const sorted = [...entries].sort((a, b) => a.index - b.index);
          const keep: RosterEntry[] = [];
          for (const en of sorted) { if (en.index !== keep.length) break; keep.push(en); }
          gridComplete = keep.length === sorted.length && keep.length >= 4;
          entries = keep;
          if (entries.length < 3) return;
        }
        const fromLobby = source === 'lobby';
        const meetingNow = s.match?.phase.meeting ?? 0;
        // Known spellings win over the raw read ("BigBihgis" → "BigBingus"); learned junk never becomes a card.
        entries = entries.map(en => en.name.startsWith('#') ? en : { ...en, name: resolve(bookRef.current, en.name).name })
          .filter(en => !isJunk(bookRef.current, en.name) || !fromLobby);
        if (!s.match) {
          if (creating || !resumeDone.current) return;
          creating = true;
          const presets = await loadPresets();
          if (useMatch.getState().match) { creating = false; return; }
          const code = lobbyRef.current;
          const preset = code ? presets[code] : undefined;
          const { players, me, meGuessed } = playersFromRoster(entries, settingsRef.current?.myName ?? '', 0);
          setMeGuessed(meGuessed);
          if (fromLobby && players.filter(p => plausibleName(p.name)).length < 2) { creating = false; return; }
          const ps = (fromLobby ? players.map(p => ({ ...p, slot: undefined, slotMeeting: undefined })) : players).filter(p => !fromLobby || plausibleName(p.name));
          const baseSettings = preset?.settings ?? DEFAULT_SETTINGS;
          // Fail soft: a detected map is used even without room data (room rules stand down); never silently Skeld.
          const mapId = pendingMap && MAPS[pendingMap] ? pendingMap : baseSettings.map;
          s.newMatch({ settings: { ...baseSettings, ...pendingSettings, map: mapId }, map: mapId, me, myRole: freshRole(), players: ps, lobbyCode: lobbyRef.current ?? undefined });
          if (!fromLobby) {
            for (const en of entries) { const p = ps.find(x => x.slot === en.index + 1); if (p && en.avatar_png && !en.dead) useMatch.getState().setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`); if (p && en.body_rgb && !en.dead) useMatch.getState().setBodySample(p.id, en.body_rgb); if (p && en.icon_hash) useMatch.getState().setIconHash(p.id, en.icon_hash); }
            useMatch.getState().setPhase('meetingDiscussion', { reason: bannerReason ?? 'body' });
            useMatch.getState().setRosterConfidence(entries.filter(x => !x.name.startsWith('#')).length / Math.max(1, entries.length));
          }
          useMatch.getState().showToast(`${fromLobby ? 'Lobby' : 'Roster'} read: ${players.length} players${meGuessed ? ' — tap your crewmate' : ''}`);
          invoke('watcher_set_names', { names: players.map(p => p.name) }).catch(() => {});
          creating = false;
          return;
        }
        const m = s.match;
        const existing = Object.values(m.players);
        if (fromLobby && m.phase.phase !== 'lobby') return; // floating names mid-game are partial; ignore
        if (m.players['me'] && !fromLobby) {
          // Provisional match: add everyone from the grid, then point "me" at my name (or ask).
          const { players, me, meGuessed } = playersFromRoster(entries, settingsRef.current?.myName ?? '', meetingNow);
          for (const p of players) if (!useMatch.getState().match!.players[p.id]) s.dispatch({ kind: 'addPlayer', payload: { ...p, isMe: false } });
          for (const en of entries) { const p = players.find(x => x.slot === en.index + 1); if (p && en.avatar_png) useMatch.getState().setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`); if (p && en.icon_hash) useMatch.getState().setIconHash(p.id, en.icon_hash); }
          if (!meGuessed) { s.dispatch({ kind: 'me', payload: { id: me } }); s.dispatch({ kind: 'removePlayer', payload: { id: 'me' } }); }
          else setMeGuessed(true);
          invoke('watcher_set_names', { names: players.map(p => p.name) }).catch(() => {});
          return;
        }

        if (fromLobby) {
          const now = new Set(entries.map(x => norm(x.name)));
          for (const k of [...lobbySeen.keys()]) if (!now.has(k)) lobbySeen.delete(k);
          for (const k of now) lobbySeen.set(k, (lobbySeen.get(k) ?? 0) + 1);
          for (const en of entries) {
            if (!plausibleName(en.name) || isJunk(bookRef.current, en.name) || (lobbySeen.get(norm(en.name)) ?? 0) < 2) continue;
            let p = fuzzyFind(en.name, existing);
            if (!p && existing.length >= entries.length) {
              // Lobby is full: never invent a player, take the closest unmatched name.
              const taken = new Set(entries.map(x => fuzzyFind(x.name, existing)?.id).filter(Boolean));
              p = existing.filter(x => !taken.has(x.id)).sort((a, b) => similarity(norm(en.name), norm(b.name)) - similarity(norm(en.name), norm(a.name)))[0];
            }
            if (!p) {
              const live = useMatch.getState().match!;
              // The room is full per the CAPACITY counter: a new label is a misread, not a newcomer.
              if (live.rosterSize && Object.values(live.players).filter(x => x.status !== 'disconnected').length >= live.rosterSize + 1) continue;
              const { players } = playersFromRoster([en], '');
              const np = { ...players[0], slot: undefined, slotMeeting: undefined };
              const id = live.players[np.id] || Object.values(live.players).some(x => x.color === np.color) ? `slot${en.index + 1}` : np.id;
              if (!live.players[id]) s.dispatch({ kind: 'addPlayer', payload: { ...np, id, isMe: false } });
              continue;
            }
            // Lobby colour sampling is noisy: only fill a colour that is still the unknown fallback, never flip a set one.
            if (en.color !== 'unknown' && en.color !== p.color && (p.color === 'gray' || p.color === 'unknown') && !existing.some(x => x.color === en.color && x.id !== p.id)) s.dispatch({ kind: 'player', payload: { id: p.id, color: en.color as PlayerColor } });
          }
          tidyRoster('Lobby', 1);
          return;
        }

        // ---- Vote grid: match cards to players by name / icon / colour / same-meeting slot. ----
        const hashes = useMatch.getState().iconHashes;
        const rp: RosterPlayer[] = existing.map(p => ({ id: p.id, name: p.name, color: p.color, status: p.status, slot: p.slot, slotMeeting: p.slotMeeting, iconHash: hashes[p.id], isMe: p.isMe, gridOrder: p.gridOrder }));
        const ge: GridEntry[] = entries.map(en => ({ index: en.index, name: en.name, color: en.color, dead: en.dead, iconHash: en.icon_hash }));
        const assignments = matchGrid(rp, ge, meetingNow);
        useMatch.getState().setRosterConfidence(rosterConfidence(assignments, ge));
        // Grid order (handoff #9): taken once per game, from the first complete grid where every alive card found
        // its player — all orders then come from one meeting, so their ranks are comparable later.
        if (gridComplete && !existing.some(p => p.gridOrder !== undefined)) {
          const alive = assignments.filter(a => !(entries.find(x => x.index === a.index)?.dead));
          if (alive.length >= 3 && alive.every(a => a.playerId && !a.reasons.includes('elimination'))) {
            for (const a of alive) s.dispatch({ kind: 'player', payload: { id: a.playerId!, gridOrder: a.index } });
          }
        }
        const established = existing.filter(p => p.slot !== undefined).length >= Math.min(entries.length, 4);
        for (const a of assignments) {
          const en = entries[a.index] ?? entries.find(x => x.index === a.index)!;
          if (!a.playerId) {
            // Unmatched card: a real newcomer only while the roster is still forming; later it is an OCR miss.
            if (established && existing.length >= entries.length) continue;
            if (en.name.startsWith('#')) continue;
            const live = useMatch.getState().match!;
            const { players } = playersFromRoster([en], '', meetingNow);
            const np = players[0];
            const id = live.players[np.id] || Object.values(live.players).some(x => x.color === np.color) ? `slot${en.index + 1}` : np.id;
            if (!live.players[id]) {
              s.dispatch({ kind: 'addPlayer', payload: { ...np, id, isMe: false } });
              if (en.avatar_png && !en.dead) useMatch.getState().setAvatar(id, `data:image/png;base64,${en.avatar_png}`);
              if (en.icon_hash) useMatch.getState().setIconHash(id, en.icon_hash);
            }
            continue;
          }
          const p = useMatch.getState().match!.players[a.playerId];
          if (!p) continue;
          // Slot is per meeting (the grid re-sorts: alive first, dead last).
          if (p.slot !== en.index + 1 || p.slotMeeting !== meetingNow) s.dispatch({ kind: 'player', payload: { id: p.id, slot: en.index + 1, slotMeeting: meetingNow } });
          // A placeholder / slot-named card takes its readable name.
          if (!en.name.startsWith('#') && (p.name.startsWith('#') || /^slot\d+$/.test(p.name) || p.name === 'You') && en.name_confidence >= 0.4) s.dispatch({ kind: 'player', payload: { id: p.id, name: en.name } });
          // Repeated readings vote on the spelling: a better reading seen twice replaces a first misread,
          // and a settled spelling is learned for the next game (the user's typed name always stands).
          else if (!en.name.startsWith('#') && en.name_confidence >= 0.4 && !p.nameLocked) {
            const v = nameVotes.get(p.id) ?? {};
            v[en.name] = (v[en.name] ?? 0) + 1;
            nameVotes.set(p.id, v);
            const best = bestReading(v, p.name, p.nameLocked);
            if (best !== p.name) { s.dispatch({ kind: 'player', payload: { id: p.id, name: best } }); learn(b => learnAlias(b, p.name, best, Date.now(), 'grid')); }
            else if (v[en.name] >= 2 && en.name === p.name) learn(b => learnName(b, p.name, 'grid', Date.now(), lobbyRef.current ?? undefined));
          }
          // First grid sighting of a lobby/chat-created player: take the grid colour straight away when ours is a placeholder.
          if (!p.colorLocked && (p.color === 'gray' || p.color === 'unknown') && en.color !== 'unknown' && en.color !== 'gray' && !Object.values(useMatch.getState().match!.players).some(x => x.id !== p.id && x.color === en.color)) {
            s.dispatch({ kind: 'player', payload: { id: p.id, color: en.color as PlayerColor } });
          }
          // Merge slot-less duplicates of this player (chat/lobby spellings): drop the one without a slot.
          {
            const live = useMatch.getState().match!;
            for (const d of Object.values(live.players)) {
              if (d.id === p.id || d.slot !== undefined || d.isMe) continue;
              // mergePlayers, not removePlayer: the duplicate's chat lines / claims / sightings follow the survivor.
              if (!d.colorLocked && (similarity(norm(d.name), norm(p.name)) >= 0.6 || similarity(norm(d.name), norm(en.name)) >= 0.6)) s.dispatch({ kind: 'mergePlayers', payload: { from: d.id, into: p.id, why: `grid duplicate of ${p.name}` } });
            }
          }
          if (en.body_rgb && !en.dead) useMatch.getState().setBodySample(p.id, en.body_rgb);
          // Headshot + icon hash: keep the freshest alive-time one (dead cards carry the X and are dimmed).
          if (en.avatar_png && (!en.dead || !useMatch.getState().avatars[p.id])) useMatch.getState().setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`);
          if (en.icon_hash && (!en.dead || !useMatch.getState().iconHashes[p.id])) useMatch.getState().setIconHash(p.id, en.icon_hash);
          if (!p.colorLocked && en.color !== 'unknown' && en.color !== p.color && !en.dead) {
            const v = colorVotes.get(p.id);
            const n = v && v.color === en.color ? v.n + 1 : 1;
            colorVotes.set(p.id, { color: en.color, n });
            const live = useMatch.getState().match!;
            const clash = Object.values(live.players).find(x => x.id !== p.id && x.color === en.color);
            if (n >= 3 && (!clash || !clash.colorLocked)) {
              if (clash) s.dispatch({ kind: 'player', payload: { id: clash.id, color: p.color } });
              s.dispatch({ kind: 'player', payload: { id: p.id, color: en.color as PlayerColor } });
              colorVotes.delete(p.id);
            }
          }
          // The card went grey / got the X: they died since the last meeting.
          if (en.dead && p.status === 'alive' && p.aliveLockMeeting !== meetingNow) { s.dispatch({ kind: 'player', payload: { id: p.id, status: 'dead' } }); if (!p.isMe) s.showToast(`${p.name} is dead (vote grid)`); }
        }
        // The grid is the roster size: every player in the game has a card. Trust a count once two reads
        // agree (or it matches what we already know); a fading grid can come up short.
        if (gridComplete) {
          if (gridCount.meeting !== meetingNow) gridCount = { meeting: meetingNow, n: 0, seen: 0 };
          if (gridCount.n === entries.length) gridCount.seen++; else gridCount = { meeting: meetingNow, n: entries.length, seen: 1 };
          const live = useMatch.getState().match!;
          if (gridCount.seen >= 2 || live.rosterSize === entries.length) {
            if (live.rosterSize !== entries.length || live.rosterSizeSource !== 'grid') s.dispatch({ kind: 'rosterSize', payload: { size: entries.length, source: 'grid' } });
            tidyRoster('Vote grid', 0);
          }
        }
      }));

      guard(await listen<PhaseEvent>('game://phase', e => {
        const s = useMatch.getState();
        if (e.payload.phase === 'gameOver') return; // handled by game://game_over (carries the outcome)
        if (!s.match) {
          // Already in a game (app started mid-match): open a provisional match with a placeholder "me";
          // the next vote-grid read fills the roster and re-points "me" by name.
          if (!['round', 'roundStart', 'meetingDiscussion', 'ejection'].includes(e.payload.phase)) return;
          if (creating || !resumeDone.current) return;
          creating = true;
          const mapId = pendingMap && MAPS[pendingMap] ? pendingMap : DEFAULT_SETTINGS.map;
          s.newMatch({ settings: { ...DEFAULT_SETTINGS, ...pendingSettings, map: mapId }, map: mapId, me: 'me', myRole: freshRole(), lobbyCode: lobbyRef.current ?? undefined,
            players: [{ id: 'me', name: settingsRef.current?.myName || 'You', color: 'gray', isMe: true, status: 'alive', knownRole: freshRole() }] });
          creating = false;
          useMatch.getState().showToast('Game in progress detected — roster fills at the next meeting');
        }
        const s2 = useMatch.getState();
        if (!s2.match) return;
        const map: Record<string, Phase> = { lobby: 'lobby', roundStart: 'roundStart', round: 'round', meetingDiscussion: 'meetingDiscussion', meetingVoting: 'meetingVoting', ejection: 'ejection', gameOver: 'gameOver' };
        const phase = map[e.payload.phase];
        if (!phase || s2.match.phase.phase === phase) return;
        const cur = s2.match;
        if (phase === 'lobby') {
          // Back in the lobby after a game: keep the lobby (names, colours, me, headshots) but start a fresh match.
          if (!playedRounds(cur)) return; // nothing to roll over
          rollOver('Back in the lobby');
          return;
        }
        if (phase === 'roundStart' && playedRounds(cur)) {
          // A role card after a finished (or unfinished) game: this is the next game.
          rollOver('New game started');
          useMatch.getState().setPhase('roundStart');
          return;
        }
        const lag = e.payload.lag_ms ? { lagMs: e.payload.lag_ms } : {};
        s2.setPhase(phase, phase === 'meetingDiscussion' ? { reason: bannerReason ?? 'body', ...lag } : lag);
        if (phase === 'meetingDiscussion') bannerReason = null;
        s2.showToast(`${phase === 'round' ? 'Round started' : phase === 'meetingDiscussion' ? 'Meeting' : phase === 'ejection' ? 'Vote done' : phase} (auto)`);
      }));

      guard(await listen<GameOverEvent>('game://game_over', e => {
        const s = useMatch.getState();
        if (!s.match || s.match.phase.phase === 'gameOver' || s.match.phase.phase === 'lobby') return;
        // UNVERIFIED: end-screen colours. Blue letters = crew victory; red letters = impostor win,
        // which reads "Victory" for impostors and "Defeat" for crew.
        const byColour = e.payload.accent === 'blue' ? 'victory' : e.payload.accent === 'red' ? (s.match.myRole === 'impostor' ? 'victory' : 'defeat') : undefined;
        const outcome = e.payload.outcome ?? byColour;
        s.setPhase('gameOver', outcome ? { outcome } : undefined);
        s.showToast(outcome === 'victory' ? 'VICTORY (auto)' : outcome === 'defeat' ? 'DEFEAT (auto)' : 'Game over (auto)');
      }));

      guard(await listen<EjectEvent>('game://eject', e => {
        const s = useMatch.getState();
        if (!s.match) return;
        const ev = e.payload;
        const meeting = s.match.phase.meeting ?? 0;
        if (s.match.ejections.some(x => x.meeting === meeting)) return;
        // Ejection text is animated and often read mid-typing; among ALIVE players accept a looser match.
        const alive = Object.values(s.match.players).filter(p => p.status === 'alive');
        let player = ev.name ? fuzzyFind(ev.name, alive) : undefined;
        if (!player && ev.name && !ev.skipped) {
          const n = norm(ev.name);
          const ranked = alive.map(p => ({ p, score: Math.max(similarity(n, norm(p.name)), norm(p.name).startsWith(n.slice(0, 4)) ? 0.5 : 0) })).sort((a, b) => b.score - a.score);
          if (ranked[0] && ranked[0].score >= 0.4) player = ranked[0].p;
        }
        s.dispatch({ kind: 'ejection', payload: { meeting, player: player?.id ?? null, wasImpostor: ev.was_impostor } });
        s.showToast(player ? `${player.name} ejected${ev.was_impostor === true ? ' — IMPOSTOR' : ev.was_impostor === false ? ' — not impostor' : ''} (auto)` : `No ejection (auto)`);
      }));

      guard(await listen<MapId>('game://map', e => {
        const id = e.payload;
        const s = useMatch.getState();
        if (!MAPS[id]) return;
        if (MAPS[id].rooms.length === 0) s.showToast(`Map ${id} detected — no map data yet, room features off`);
        pendingMap = id;
        detectedMap = { id, source: 'lobby' };
        if (s.match && s.match.settings.map !== id) { s.dispatch({ kind: 'settings', payload: { map: id } }); s.showToast(`Map: ${MAPS[id].name} (auto)`); }
      }));

      guard(await listen<ChatPayload[]>('game://chat', e => {
        const s = useMatch.getState();
        if (!s.match) return;
        const meeting = s.match.phase.meeting ?? 0;
        /** Every bubble the screen showed that does not become a chat line gets a reason in the NDJSON. */
        const drop = (why: string, msg: ChatPayload) => s.dispatch({ kind: 'diag', payload: { what: 'chatDropped', why, sender: msg.sender, text: msg.text.slice(0, 120) } });
        for (const msg of e.payload) {
          if (!msg.system && msg.text.trim().length === 0 && !msg.unreadable) { drop('empty', msg); continue; }
          if (msg.unreadable) s.dispatch({ kind: 'diag', payload: { what: 'chatUnreadable', sender: msg.sender, text: msg.text.slice(0, 120), scriptHint: msg.script_hint ?? null, ocrLang: msg.ocr_lang ?? null, plausibility: msg.plausibility ?? null } });
          // Garbled system lines ("sillynorny nas votea. z remyalmng.") still carry 'vot' + 'rem' fragments.
          const system = msg.system || (/vot/i.test(msg.text) && /rem/i.test(msg.text) && !/(vote|voting) [a-z]/i.test(msg.text)) || /left the game|joined the game/i.test(msg.text);
          if (system) {
            const left = msg.text.match(/^(.*?) (?:has )?left the game/i);
            if (left) { const mm = useMatch.getState().match!; const p = fuzzyFind(left[1], Object.values(mm.players)); if (p && p.status === 'alive') s.dispatch({ kind: 'player', payload: { id: p.id, status: 'disconnected' } }); }
            continue;
          }
          const m = useMatch.getState().match!;
          // Re-reads of the same bubble can lose the name line: a long identical text seen recently is a duplicate.
          const recent = m.chat.slice(-25);
          const nt = norm(msg.text);
          if (nt.length >= 12 && recent.some(c => { const o = norm(c.original); return o === nt || o.startsWith(nt) || (nt.startsWith(o) && o.length >= 12) || similarity(nt, o) >= 0.85; })) { drop('duplicate', msg); continue; }
          const others = Object.values(m.players).filter(p => !p.isMe);
          // A bubble whose first line was unreadable yields text that is just the sender's name: not a message.
          if (msg.text.trim() && msg.text.split(' ').length <= 2 && fuzzyFind(msg.text, others) && !fuzzyFind(msg.sender, others)) { drop('nameOnly', msg); continue; }
          if (msg.sender && !msg.mine && msg.sender !== '?') msg.sender = resolve(bookRef.current, msg.sender).name;
          let sender: string = msg.mine ? m.me : (msg.sender && msg.sender !== '?' ? fuzzyFind(msg.sender, others)?.id ?? 'unknown' : 'unknown');
          // No readable name line (cut off, or a non-Latin name): the icon colour names the sender when it is unique.
          if (sender === 'unknown' && !msg.mine && (!msg.sender || msg.sender === '?')) sender = senderByIconColor(msg.color, others) ?? 'unknown';
          if (sender === 'unknown' && msg.color && msg.color !== 'unknown') {
            const byColor = others.filter(p => p.color === msg.color);
            if (byColor.length === 1 && msg.sender && similarity(norm(msg.sender), norm(byColor[0].name)) > 0.4) sender = byColor[0].id;
          }
          // Chat icon colours (plain palette, reliable): a second vote for an unlocked card colour.
          if (sender !== 'unknown' && !msg.mine && msg.color && msg.color !== 'unknown') {
            const p = m.players[sender];
            if (p && !p.colorLocked && p.color !== msg.color) {
              const v = colorVotes.get(p.id);
              const n = v && v.color === msg.color ? v.n + 1 : 1;
              colorVotes.set(p.id, { color: msg.color, n });
              const clash = Object.values(m.players).find(x => x.id !== p.id && x.color === msg.color);
              if (n >= 2 && (!clash || !clash.colorLocked)) {
                if (clash) s.dispatch({ kind: 'player', payload: { id: clash.id, color: p.color } });
                s.dispatch({ kind: 'player', payload: { id: p.id, color: msg.color as PlayerColor } });
                colorVotes.delete(p.id);
              }
            }
          }
          const slotted = Object.values(m.players).filter(p => p.slot !== undefined).length;
          // Once the vote grid has established the roster, unknown chat senders are OCR misses, not new players.
          const roomFor = !m.rosterSize || Object.values(m.players).filter(p => p.status !== 'disconnected').length < m.rosterSize + (m.rosterSizeSource === 'grid' ? 0 : 1);
          if (sender === 'unknown' && slotted < 8 && roomFor && msg.sender && msg.sender !== '?' && plausibleName(msg.sender) && !isJunk(bookRef.current, msg.sender)) {
            // Chat bubbles are a roster source too: a new name with a readable icon becomes a player.
            const color = (COLOR_IDS as string[]).includes(msg.color) && !others.some(p => p.color === msg.color) ? (msg.color as PlayerColor) : 'gray';
            const id = color !== 'gray' && !m.players[color] ? color : `chat_${Date.now().toString(36)}`;
            s.dispatch({ kind: 'addPlayer', payload: { id, name: msg.sender, color, isMe: false, status: 'alive', knownRole: 'unknown' } });
            sender = id;
          }
          const stamp = s.stamp();
          const lineId = newId('ch');
          s.dispatch({ kind: 'chat', payload: { id: lineId, meeting, stamp, sender, original: msg.text, source: 'ocr', ...(msg.unreadable ? { unreadable: true } : {}), ...(msg.script_hint ? { scriptHint: msg.script_hint } : {}), ...(msg.ocr_lang ? { ocrLang: msg.ocr_lang } : {}) } });
          if (sender !== m.me) void translateLine(lineId, msg);
          // Garbage OCR must not turn into claims (a misread could "say" anything).
          if (sender === 'unknown' || sender === m.me || msg.unreadable) continue;
          const parsed = parseChatClaims(msg.text, sender, m);
          for (const b of parsed.filter(x => x.type === 'body' && x.room)) {
            const live = useMatch.getState().match!;
            const round = Math.max(0, live.phase.round);
            if (!live.observations.some(o => o.type === 'bodyFound' && o.stamp.round === round)) {
              useMatch.getState().observe({ type: 'bodyFound', victim: 'unknown', room: b.room!, source: 'ocr', confidence: 0.6 }, `Body in ${live.map.rooms.find(r => r.id === b.room)?.name ?? b.room} (chat)`);
            }
          }
          for (const mc of parsed.filter(x => x.type === 'myColor' && x.color)) {
            const live = useMatch.getState().match!;
            const pl = live.players[sender];
            const clash = Object.values(live.players).find(x => x.id !== sender && x.color === mc.color);
            if (pl && !pl.colorLocked && pl.color !== mc.color && (!clash || !clash.colorLocked)) {
              if (clash) s.dispatch({ kind: 'player', payload: { id: clash.id, color: pl.color } });
              s.dispatch({ kind: 'player', payload: { id: pl.id, color: mc.color as PlayerColor } });
              s.showToast(`${pl.name} says they are ${mc.color} (chat)`);
            }
          }
          for (const d of parsed.filter(x => x.type === 'dead' && x.about)) {
            const live = useMatch.getState().match!;
            const pl = live.players[d.about!];
            if (pl && pl.status === 'alive' && pl.aliveLockMeeting !== meeting) { s.dispatch({ kind: 'player', payload: { id: pl.id, status: 'dead' } }); s.showToast(`${pl.name} is dead (chat)`); }
          }
          const claims = toClaims(parsed, { meeting, stamp, by: sender, chatLineId: lineId }, msg.text, () => newId('c'));
          for (const c of claims) {
            s.dispatch({ kind: 'claim', payload: c });
          }
          if (claims.length) s.showToast(`${m.players[sender]?.name ?? sender}: ${claims.map(c => c.type + (c.room ? ' ' + c.room : '') + (c.about ? ' ' + (m.players[c.about]?.name ?? c.about) : '')).join(', ')} (chat)`);
        }
      }));

      guard(await listen<string[]>('game://settings', e => {
        const s = useMatch.getState();
        const patch: Record<string, unknown> = {};
        for (const line of e.payload) {
          const m = line.match(/^(.*?)\s+set to\s+(.+)$/i);
          if (!m) continue;
          const key = norm(m[1]); const val = m[2].trim();
          const num = parseFloat(val.replace(/[^0-9.]/g, ''));
          const on = /^on/i.test(val);
          if (key.includes('impostor')) { if (num >= 1 && num <= 3) patch.impostorCount = num; }
          else if (key.includes('killcooldown')) { if (num >= 5 && num <= 60) patch.killCooldownSec = num; }
          else if (key.includes('visualtask')) patch.visualTasksOn = on;
          else if (key.includes('confirmeject')) patch.confirmEjectsOn = on;
          else if (key.includes('anonymousvote')) patch.anonymousVotes = on;
          else if (key.includes('playerspeed')) { if (num >= 0.5 && num <= 3) patch.playerSpeed = num; }
          else if (key.includes('emergencymeeting')) { if (num >= 0 && num <= 9) patch.emergencyMeetings = num; }
          else if (key.includes('taskbar')) patch.taskBarMode = /always/i.test(val) ? 'always' : /meeting/i.test(val) ? 'meetings' : 'never';
          else if (key.includes('commontask')) { if (num >= 0 && num <= 4) patch.commonTasks = num; }
          else if (key.includes('longtask')) { if (num >= 0 && num <= 4) patch.longTasks = num; }
          else if (key.includes('shorttask')) { if (num >= 0 && num <= 6) patch.shortTasks = num; }
          else if (key === 'map' || key.endsWith('map')) { const id = mapIdFromText(val); if (id) { patch.map = id; pendingMap = id; detectedMap = { id, source: 'lobby' }; } }
        }
        if (Object.keys(patch).length === 0) return;
        pendingSettings = { ...pendingSettings, ...patch };
        if (s.match) {
          const changed = Object.entries(patch).filter(([k, v]) => (s.match!.settings as unknown as Record<string, unknown>)[k] !== v);
          if (changed.length) { s.dispatch({ kind: 'settings', payload: Object.fromEntries(changed) }); s.showToast(`Lobby settings: ${changed.map(([k, v]) => `${k}=${v}`).join(', ')} (auto)`); }
        }
      }));

      guard(await listen<string>('game://meeting_banner', e => { bannerReason = e.payload === 'button' ? 'button' : 'body'; }));

      guard(await listen<number>('game://me_dead', () => {
        const s = useMatch.getState();
        const me = s.match?.players[s.match.me];
        if (me && me.status === 'alive' && me.aliveLockMeeting !== (s.match!.phase.meeting ?? 0)) { s.dispatch({ kind: 'player', payload: { id: me.id, status: 'dead' } }); s.showToast('You died (read from the meeting screen) — ghost mode'); }
      }));

      guard(await listen<string>('game://room', e => {
        inferMapFrom(e.payload);
        const s = useMatch.getState();
        const m = s.match;
        if (!m || m.map.rooms.length === 0) return;
        const room = fuzzyFind(e.payload, m.map.rooms.map(r => ({ name: r.name, id: r.id })));
        if (!room) return;
        if (myRoomNow(m) === room.id) return;
        s.observe({ type: 'myRoom', room: room.id, source: 'ocr', confidence: 0.85 }, `You → ${room.name} (auto)`);
      }));

      guard(await listen<string[]>('game://nearby', e => {
        const s = useMatch.getState();
        const m = s.match;
        if (!m || m.phase.phase !== 'round') return;
        // Red floating names: only an impostor sees them — on me (role) or on a partner.
        // A red hat or sign near a label can fake it: act on the second consecutive sighting only.
        const redNow = new Set(e.payload.filter(r => r.startsWith('!')).map(r => norm(r.slice(1))));
        for (const k of [...redSeen.keys()]) if (!redNow.has(k)) redSeen.delete(k);
        for (const k of redNow) redSeen.set(k, (redSeen.get(k) ?? 0) + 1);
        for (const raw of e.payload) {
          if (!raw.startsWith('!')) continue;
          const nm = raw.slice(1);
          if ((redSeen.get(norm(nm)) ?? 0) < 2) continue;
          const live = useMatch.getState().match!;
          const p = fuzzyFind(nm, Object.values(live.players));
          if (!p) continue;
          if (live.myRole !== 'impostor' && !live.myRoleLocked && live.players[live.me]?.status === 'alive') { role = 'impostor'; roleAt = Date.now(); s.dispatch({ kind: 'myRole', payload: { role: 'impostor', auto: true } }); s.showToast('Red name seen — you are IMPOSTOR (auto)'); }
          if (!p.isMe && !p.isPartner && !p.roleLocked) { s.dispatch({ kind: 'player', payload: { id: p.id, isPartner: true, knownRole: 'impostor' } }); s.showToast(`${p.name} is your partner (red name)`); }
        }
        const room = myRoomNow(m);
        if (!room) return;
        const now = Date.now();
        for (const raw of e.payload) {
          const name = raw.startsWith('!') ? raw.slice(1) : raw;
          const p = fuzzyFind(name, Object.values(m.players));
          if (!p || p.isMe || p.status !== 'alive') continue;
          const key = `${p.id}|${room}`;
          if (now - (lastAutoSighting.get(key) ?? 0) < 20_000) continue;
          lastAutoSighting.set(key, now);
          useMatch.getState().observe({ type: 'sighting', player: p.id, room, source: 'ocr', confidence: 0.75 });
        }
      }));

      guard(await listen<string[]>('game://tasks', e => {
        for (const l of e.payload) if (!/total tasks|fake tasks/i.test(l)) inferMapFrom(l);
        const s = useMatch.getState();
        const m = s.match;
        if (!m) return;
        const lines = e.payload;
        // Only the real "Fake Tasks:" header counts (chat about "faking" overlaps this region during meetings).
        if (lines.some(l => /^\W*fake\s*tasks?/i.test(l)) && m.myRole !== 'impostor' && !m.myRoleLocked && m.phase.phase === 'round') { role = 'impostor'; roleAt = Date.now(); s.dispatch({ kind: 'myRole', payload: { role: 'impostor', auto: true } }); s.showToast('Fake tasks on your list — you are IMPOSTOR (auto)'); }
        const tasks: MyTask[] = [];
        for (const raw of lines) {
          if (/total tasks|fake tasks/i.test(raw)) continue;
          const progress = raw.match(/\((\d+)\s*\/\s*(\d+)\)/)?.[0];
          const body = raw.replace(/\(.*?\)/g, '').trim();
          const [roomPart, taskPart] = body.includes(':') ? body.split(':').map(x => x.trim()) : ['', body];
          const task = taskPart && m.map.tasks.length ? fuzzyFind(taskPart.replace(/ to .*$/i, ''), m.map.tasks.map(t => ({ name: t.name, id: t.id }))) : undefined;
          const room = roomPart && m.map.rooms.length ? fuzzyFind(roomPart, m.map.rooms.map(r => ({ name: r.name, id: r.id }))) : undefined;
          if (!task && body.length < 4) continue;
          tasks.push({ id: task?.id ?? body, name: task?.name ?? body, room: room?.id, progress, matched: !!task });
        }
        // Compare on normalised content so OCR jitter in unmatched lines doesn't spam the log.
        const sig = (ts: MyTask[]) => ts.map(t => `${t.matched ? t.id : norm(t.name).slice(0, 10)}|${t.progress ?? ''}`).sort().join(';');
        if (tasks.length && sig(tasks) !== sig(m.myTasks ?? [])) s.dispatch({ kind: 'myTasks', payload: tasks });
      }));
    })();
    return () => { cancelled = true; unlisten.forEach(u => u()); };
    // Deliberately not keyed on lobbyCode (read through lobbyRef): re-registering every listener on a new room
    // code dropped events in the gap and wiped the closures' state (role, pending map/settings, votes).
  }, [settingsLoaded]);

  const rescanNames = async (): Promise<string> => {
    if (!isTauri()) return 'needs the Tauri window';
    const s = useMatch.getState();
    const m = s.match;
    if (!m) return 'no match open';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = await invoke<{ entries: RosterEntry[] }>('read_roster', { knownNames: [] });
      if (r.entries.length < 3) return 'vote grid not visible — rescan during a meeting';
      let changed = 0;
      const meeting = m.phase.meeting ?? 0;
      for (const en of r.entries) {
        if (en.name.startsWith('#')) continue;
        const p = Object.values(m.players).find(x => x.slot === en.index + 1 && x.slotMeeting === meeting) ?? Object.values(m.players).find(x => x.slot === en.index + 1);
        if (p) { if (p.name !== en.name) { s.dispatch({ kind: 'player', payload: { id: p.id, name: en.name } }); changed++; } }
        else {
          const { players } = playersFromRoster([en], '', meeting);
          const np = { ...players[0], id: `slot${en.index + 1}` };
          if (!m.players[np.id]) { s.dispatch({ kind: 'addPlayer', payload: { ...np, isMe: false } }); changed++; }
        }
        if (en.avatar_png && !en.dead && p) s.setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`);
        if (en.icon_hash && p) s.setIconHash(p.id, en.icon_hash);
      }
      invoke('watcher_set_names', { names: r.entries.map(e => e.name) }).catch(() => {});
      return `rescanned ${r.entries.length} cards, ${changed} updated`;
    } catch (e) { return String(e); }
  };

  /** Start over with only me in the roster (wrong people carried over from another lobby). */
  const resetRoster = () => resetRosterRef.current();

  /** The user corrected a card's name: the typed spelling is truth, the old reading its alias. */
  const learnRename = (oldName: string, newName: string) => learn(b => learnAlias(b, oldName, newName, Date.now(), 'user'));
  /** The user removed a card: that string is never a player. */
  const learnRemoved = (name: string) => learn(b => learnJunk(b, name, Date.now(), true));
  const nameBook = () => bookRef.current;

  return { settings, setSettings, watcher, captureOk, health, meGuessed, setMeGuessed, lobbyCode, rescanNames, resetRoster, learnRename, learnRemoved, nameBook };
}
