/**
 * The automatic layer on the frontend: starts capture + the Rust watcher when
 * the game window exists, and turns `game://*` events into store events.
 *
 *  game://lobby   → remembers the lobby code (and applies a saved preset)
 *  game://role    → my role for this match
 *  game://roster  → creates the match on the first meeting if none exists,
 *                   otherwise adds players / marks dead
 *  game://phase   → round start / meeting / ejection / next round
 *  game://eject   → ejection event (who, impostor or not)
 */
import { useEffect, useState } from 'react';
import { useMatch } from '../state/store';
import { isTauri } from '../state/persist';
import { loadSettings, type AppSettings } from '../state/settings';
import { loadPresets, DEFAULT_SETTINGS } from '../state/presets';
import { COLOR_IDS } from '../ui/palette';
import { MAPS } from '../data/maps';
import { parseChatClaims, toClaims } from '../engine/chatClaims';
import { newId } from '../state/events';
import { myRoomNow } from './useHotkeys';
import type { MapId, MyTask, Phase, Player, PlayerColor, PlayerId } from '../types/game';

export interface RosterEntry { index: number; name: string; name_confidence: number; color: string; color_delta_e: number; dead: boolean; reporter: boolean; avatar_png?: string; body_rgb?: [number, number, number] }
interface PhaseEvent { phase: string; round: number; meeting: number }
interface EjectEvent { raw: string; name: string | null; was_impostor: boolean | null; skipped: boolean }
export interface WatcherStatus { running: boolean; phase: string | null; round: number; meeting: number; markers: Record<string, boolean>; last_ocr_ms: number; ocr_calls: number; frame_seq: number; lobby_code: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** UI words the lobby reader can mistake for names when a settings panel is open. */
const NOT_NAMES = /^(roles?|role amounts?|crewmate roles?|impostor roles?|scientist|engineer|guardian angel|noisemaker|tracker|shapeshifter|phantom|detective|viper|% ?chance|chance|amount|cosmetics|host|back|close|apply|reset|general|chat|filters?|map|skeld|mira hq|polus|airship|fungle|waiting for host|starting in \d+)$/i;
const plausibleName = (n: string) => !NOT_NAMES.test(n.trim()) && !/^[\W_]+$/.test(n) && n.trim().length >= 2;
/** Lobby names must be seen in two consecutive reads before they become players. */
const lobbySeen = new Map<string, number>();

function fuzzyFind<T extends { name: string }>(name: string, list: T[]): T | undefined {
  const n = norm(name);
  if (n.length < 2) return undefined;
  let best: { item: T; score: number } | null = null;
  for (const item of list) {
    const m = norm(item.name);
    const score = m === n ? 1 : m.includes(n) || n.includes(m) ? 0.85 : similarity(n, m);
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.6 ? best.item : undefined;
}

function similarity(a: string, b: string): number {
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

/** Build players from a roster read; `myName` picks "me" (falls back to the first entry, flagged by `meGuessed`). */
export function playersFromRoster(entries: RosterEntry[], myName: string): { players: Player[]; me: PlayerId; meGuessed: boolean } {
  const used = new Set<PlayerColor>();
  const players: Player[] = [];
  for (const e of entries) {
    let color = (COLOR_IDS as string[]).includes(e.color) ? (e.color as PlayerColor) : 'gray';
    if (used.has(color)) color = COLOR_IDS.find(c => !used.has(c)) ?? 'unknown';
    used.add(color);
    players.push({ id: color === 'unknown' ? `p${e.index}` : color, name: e.name, color, isMe: false, status: e.dead ? 'dead' : 'alive', knownRole: 'unknown', slot: e.index + 1 });
  }
  const mine = myName ? fuzzyFind(myName, players) : undefined;
  const me = mine ?? players[0];
  for (const p of players) p.isMe = p.id === me.id;
  return { players, me: me.id, meGuessed: !mine };
}

export function useGameEvents() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [watcher, setWatcher] = useState<WatcherStatus | null>(null);
  const [captureOk, setCaptureOk] = useState<boolean | null>(null);
  const [meGuessed, setMeGuessed] = useState(false);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);

  useEffect(() => { loadSettings().then(setSettings); }, []);

  // Keep the OCR snap-list in sync with the roster (names added, renamed, rescanned).
  useEffect(() => {
    if (!isTauri()) return;
    let last = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useMatch.subscribe(st => {
      const names = st.match ? Object.values(st.match.players).map(p => p.name).filter(n => n && !n.startsWith('#')) : [];
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
    const tick = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const st = await invoke<{ running: boolean }>('capture_status');
        if (!st.running) {
          try { await invoke('capture_start', { title: 'Among Us', minIntervalMs: 200 }); setCaptureOk(true); }
          catch { setCaptureOk(false); }
        } else setCaptureOk(true);
        const w = await invoke<WatcherStatus>('watcher_status');
        if (!w.running) await invoke('watcher_start');
      } catch { /* not in tauri */ }
      if (!stop) setTimeout(tick, 8000);
    };
    tick();
    return () => { stop = true; };
  }, [settings?.autoCapture]);

  // Event wiring.
  useEffect(() => {
    if (!isTauri() || !settings) return;
    const unlisten: Array<() => void> = [];
    let cancelled = false;
    let creating = false;
    let role: 'crew' | 'impostor' | null = null;
    let pendingMap: MapId | null = null;
    let pendingSettings: Record<string, unknown> = {};
    let bannerReason: 'body' | 'button' | null = null;
    const lastAutoSighting = new Map<string, number>();
    /** Vote-grid colour votes per player: two agreeing reads change an unlocked colour. */
    const colorVotes = new Map<string, { color: string; n: number }>();
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      // StrictMode runs effects twice; if we were cleaned up while awaiting, drop everything we register.
      const guard = <T,>(un: () => void) => { if (cancelled) un(); else unlisten.push(un); return un as unknown as T; };

      guard(await listen<WatcherStatus>('game://watcher', e => setWatcher(e.payload)));

      guard(await listen<string>('game://lobby', async e => {
        setLobbyCode(e.payload);
        useMatch.getState().showToast(`Lobby ${e.payload} detected`);
      }));

      guard(await listen<string>('game://role', e => {
        role = e.payload === 'impostor' ? 'impostor' : 'crew';
        const s = useMatch.getState();
        if (s.match && s.match.myRole !== role) s.dispatch({ kind: 'myRole', payload: { role } });
        s.showToast(`You are ${role === 'impostor' ? 'IMPOSTOR' : 'crew'} (read from the role card)`);
      }));

      guard(await listen<{ source: 'lobby' | 'grid'; entries: RosterEntry[] }>('game://roster', async e => {
        const s = useMatch.getState();
        const { source, entries } = e.payload;
        // A grid read with several unreadable cells is occluded (chat panel, fade) — ignore it.
        if (source === 'grid' && entries.filter(x => x.name.startsWith('#')).length >= 3) return;
        if (!s.match) {
          if (creating) return;
          creating = true;
          const presets = await loadPresets();
          if (useMatch.getState().match) { creating = false; return; }
          const preset = lobbyCode ? presets[lobbyCode] : undefined;
          const { players, me, meGuessed } = playersFromRoster(entries, settings.myName);
          setMeGuessed(meGuessed);
          const fromLobby = source === 'lobby';
          if (fromLobby && players.filter(p => plausibleName(p.name)).length < 2) { creating = false; return; }
          const ps = (fromLobby ? players.map(p => ({ ...p, slot: undefined })) : players).filter(p => !fromLobby || plausibleName(p.name));
          const baseSettings = preset?.settings ?? DEFAULT_SETTINGS;
          const mapId = pendingMap && MAPS[pendingMap].rooms.length > 0 ? pendingMap : baseSettings.map;
          s.newMatch({ settings: { ...baseSettings, ...pendingSettings, map: mapId }, map: mapId, me, myRole: role ?? 'crew', players: ps, lobbyCode: lobbyCode ?? undefined });
          if (!fromLobby) {
            for (const en of entries) { const p = ps.find(x => x.slot === en.index + 1); if (p && en.avatar_png && !en.dead) useMatch.getState().setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`); if (p && en.body_rgb && !en.dead) useMatch.getState().setBodySample(p.id, en.body_rgb); }
            useMatch.getState().setPhase('meetingDiscussion', { reason: bannerReason ?? 'body' });
          }
          useMatch.getState().showToast(`${fromLobby ? 'Lobby' : 'Roster'} read: ${players.length} players${meGuessed ? ' — tap your crewmate' : ''}`);
          invoke('watcher_set_names', { names: players.map(p => p.name) }).catch(() => {});
          creating = false;
          return;
        }
        const m = s.match;
        const existing = Object.values(m.players);
        const fromLobby = source === 'lobby';
        if (fromLobby && m.phase.phase !== 'lobby') return; // floating names mid-game are partial; ignore
        if (m.players['me'] && !fromLobby) {
          // Provisional match: add everyone from the grid, then point "me" at my name (or ask).
          const { players, me, meGuessed } = playersFromRoster(entries, settings.myName);
          for (const p of players) if (!useMatch.getState().match!.players[p.id]) s.dispatch({ kind: 'addPlayer', payload: { ...p, isMe: false } });
          for (const en of entries) { const p = players.find(x => x.slot === en.index + 1); if (p && en.avatar_png) useMatch.getState().setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`); }
          if (!meGuessed) { s.dispatch({ kind: 'me', payload: { id: me } }); s.dispatch({ kind: 'removePlayer', payload: { id: 'me' } }); }
          else setMeGuessed(true);
          invoke('watcher_set_names', { names: players.map(p => p.name) }).catch(() => {});
          return;
        }
        if (fromLobby) {
          const now = new Set(entries.map(x => norm(x.name)));
          for (const k of [...lobbySeen.keys()]) if (!now.has(k)) lobbySeen.delete(k);
          for (const k of now) lobbySeen.set(k, (lobbySeen.get(k) ?? 0) + 1);
        }
        for (const en of entries) {
          if (fromLobby && (!plausibleName(en.name) || (lobbySeen.get(norm(en.name)) ?? 0) < 2)) continue;
          // Same vote-grid slot = same player, whatever OCR made of the name this time.
          let p = (fromLobby ? undefined : existing.find(x => x.slot === en.index + 1)) ?? fuzzyFind(en.name, existing);
          if (!p && existing.length >= entries.length) {
            // Lobby is full: never invent a player, take the closest unmatched name.
            const taken = new Set(entries.map(x => fuzzyFind(x.name, existing)?.id).filter(Boolean));
            p = existing.filter(x => !taken.has(x.id)).sort((a, b) => similarity(norm(en.name), norm(b.name)) - similarity(norm(en.name), norm(a.name)))[0];
          }
          if (!p) {
            const live = useMatch.getState().match!;
            const { players } = playersFromRoster([en], '');
            const np = { ...players[0], slot: fromLobby ? undefined : players[0].slot };
            // Ids must be unique: fall back to a slot id when that colour is already taken.
            const id = live.players[np.id] || Object.values(live.players).some(x => x.color === np.color) ? `slot${en.index + 1}` : np.id;
            if (!live.players[id]) s.dispatch({ kind: 'addPlayer', payload: { ...np, id, isMe: false } });
            continue;
          }
          if (!fromLobby && p.slot === undefined) {
            s.dispatch({ kind: 'player', payload: { id: p.id, slot: en.index + 1 } });
            // First grid sighting of a lobby/chat-created player: take the grid colour straight away when ours is a placeholder.
            if (!p.colorLocked && (p.color === 'gray' || p.color === 'unknown') && en.color !== 'unknown' && en.color !== 'gray' && !Object.values(useMatch.getState().match!.players).some(x => x.id !== p.id && x.color === en.color)) {
              s.dispatch({ kind: 'player', payload: { id: p.id, color: en.color as PlayerColor } });
            }
          }
          if (!fromLobby) {
            // Merge slot-less duplicates of this player (chat/lobby spellings): drop the one without a slot.
            const live = useMatch.getState().match!;
            for (const d of Object.values(live.players)) {
              if (d.id === p.id || d.slot !== undefined || d.isMe) continue;
              if (similarity(norm(d.name), norm(p.name)) >= 0.5 || similarity(norm(d.name), norm(en.name)) >= 0.5) s.dispatch({ kind: 'removePlayer', payload: { id: d.id } });
            }
          }
          if (!fromLobby && en.body_rgb && !en.dead) useMatch.getState().setBodySample(p.id, en.body_rgb);
          // Keep the freshest alive-time headshot (dead cards carry the X); take a dead one only if we have none.
          if (!fromLobby && en.avatar_png && (!en.dead || !useMatch.getState().avatars[p.id])) useMatch.getState().setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`);
          if (!fromLobby && !p.colorLocked && en.color !== 'unknown' && en.color !== p.color) {
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
          if (!fromLobby && en.dead && p.status === 'alive') s.dispatch({ kind: 'player', payload: { id: p.id, status: 'dead' } });
          // Lobby colour sampling is noisy: only fill a colour that is still the unknown fallback, never flip a set one.
          if (fromLobby && en.color !== 'unknown' && en.color !== p.color && (p.color === 'gray' || p.color === 'unknown') && !existing.some(x => x.color === en.color && x.id !== p.id)) s.dispatch({ kind: 'player', payload: { id: p.id, color: en.color as PlayerColor } });
        }
      }));

      guard(await listen<PhaseEvent>('game://phase', e => {
        const s = useMatch.getState();
        if (!s.match) {
          // Already in a game (app started mid-match): open a provisional match with a placeholder "me";
          // the next vote-grid read fills the roster and re-points "me" by name.
          if (!['round', 'roundStart', 'meetingDiscussion', 'ejection'].includes(e.payload.phase)) return;
          if (creating) return;
          creating = true;
          const mapId = pendingMap && MAPS[pendingMap].rooms.length > 0 ? pendingMap : DEFAULT_SETTINGS.map;
          s.newMatch({ settings: { ...DEFAULT_SETTINGS, ...pendingSettings, map: mapId }, map: mapId, me: 'me', myRole: role ?? 'crew', lobbyCode: lobbyCode ?? undefined,
            players: [{ id: 'me', name: settings.myName || 'You', color: 'gray', isMe: true, status: 'alive', knownRole: role ?? 'crew' }] });
          creating = false;
          useMatch.getState().showToast('Game in progress detected — roster fills at the next meeting');
        }
        const s2 = useMatch.getState();
        if (!s2.match) return;
        const map: Record<string, Phase> = { lobby: 'lobby', roundStart: 'roundStart', round: 'round', meetingDiscussion: 'meetingDiscussion', meetingVoting: 'meetingVoting', ejection: 'ejection', gameOver: 'gameOver' };
        const phase = map[e.payload.phase];
        if (!phase || s2.match.phase.phase === phase) return;
        if (phase === 'lobby' && s2.match.phase.phase !== 'gameOver') return; // never bounce a live match back to lobby on a missed frame
        s2.setPhase(phase, phase === 'meetingDiscussion' ? { reason: bannerReason ?? 'body' } : undefined);
        if (phase === 'meetingDiscussion') bannerReason = null;
        s2.showToast(`${phase === 'round' ? 'Round started' : phase === 'meetingDiscussion' ? 'Meeting' : phase === 'ejection' ? 'Vote done' : phase} (auto)`);
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
        if (!MAPS[id] || MAPS[id].rooms.length === 0) { s.showToast(`Map ${id} detected — no map data yet, room features off`); pendingMap = null; return; }
        pendingMap = id;
        if (s.match && s.match.settings.map !== id) { s.dispatch({ kind: 'settings', payload: { map: id } }); s.showToast(`Map: ${MAPS[id].name} (auto)`); }
      }));

      guard(await listen<{ sender: string; text: string; mine: boolean; system: boolean; y: number; color: string }[]>('game://chat', e => {
        const s = useMatch.getState();
        if (!s.match) return;
        const meeting = s.match.phase.meeting ?? 0;
        for (const msg of e.payload) {
          if (msg.system) {
            const left = msg.text.match(/^(.*?) (?:has )?left the game/i);
            if (left) { const mm = useMatch.getState().match!; const p = fuzzyFind(left[1], Object.values(mm.players)); if (p && p.status === 'alive') s.dispatch({ kind: 'player', payload: { id: p.id, status: 'disconnected' } }); }
            continue;
          }
          const m = useMatch.getState().match!;
          // Re-reads of the same bubble can lose the name line: a long identical text seen recently is a duplicate.
          const recent = m.chat.slice(-25);
          if (msg.text.length >= 12 && recent.some(c => norm(c.original) === norm(msg.text))) continue;
          const others = Object.values(m.players).filter(p => !p.isMe);
          let sender: string = msg.mine ? m.me : (fuzzyFind(msg.sender, others)?.id ?? 'unknown');
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
          if (sender === 'unknown' && msg.sender && msg.sender !== '?' && plausibleName(msg.sender)) {
            // Chat bubbles are a roster source too: a new name with a readable icon becomes a player.
            const color = (COLOR_IDS as string[]).includes(msg.color) && !others.some(p => p.color === msg.color) ? (msg.color as PlayerColor) : 'gray';
            const id = color !== 'gray' && !m.players[color] ? color : `chat${Object.keys(m.players).length + 1}`;
            s.dispatch({ kind: 'addPlayer', payload: { id, name: msg.sender, color, isMe: false, status: 'alive', knownRole: 'unknown' } });
            sender = id;
          }
          const stamp = s.stamp();
          s.dispatch({ kind: 'chat', payload: { id: newId('ch'), meeting, stamp, sender, original: msg.text, source: 'ocr' } });
          if (sender === 'unknown' || sender === m.me) continue;
          const parsed = parseChatClaims(msg.text, sender, m);
          for (const b of parsed.filter(x => x.type === 'body' && x.room)) {
            const live = useMatch.getState().match!;
            const round = Math.max(0, live.phase.round);
            if (!live.observations.some(o => o.type === 'bodyFound' && o.stamp.round === round)) {
              useMatch.getState().observe({ type: 'bodyFound', victim: 'unknown', room: b.room!, source: 'ocr', confidence: 0.6 }, `Body in ${live.map.rooms.find(r => r.id === b.room)?.name ?? b.room} (chat)`);
            }
          }
          const claims = toClaims(parsed, { meeting, stamp, by: sender }, msg.text, () => newId('c'));
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
        if (me && me.status === 'alive') { s.dispatch({ kind: 'player', payload: { id: me.id, status: 'dead' } }); s.showToast('You died (read from the meeting screen) — ghost mode'); }
      }));

      guard(await listen<string>('game://room', e => {
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
        const room = myRoomNow(m);
        if (!room) return;
        const now = Date.now();
        for (const name of e.payload) {
          const p = fuzzyFind(name, Object.values(m.players));
          if (!p || p.isMe || p.status !== 'alive') continue;
          const key = `${p.id}|${room}`;
          if (now - (lastAutoSighting.get(key) ?? 0) < 20_000) continue;
          lastAutoSighting.set(key, now);
          useMatch.getState().observe({ type: 'sighting', player: p.id, room, source: 'ocr', confidence: 0.75 });
        }
      }));

      guard(await listen<string[]>('game://tasks', e => {
        const s = useMatch.getState();
        const m = s.match;
        if (!m) return;
        const lines = e.payload;
        if (lines.some(l => /fake/i.test(l)) && m.myRole !== 'impostor') s.dispatch({ kind: 'myRole', payload: { role: 'impostor' } });
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
  }, [settings, lobbyCode]);

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
      for (const en of r.entries) {
        if (en.name.startsWith('#')) continue;
        const p = Object.values(m.players).find(x => x.slot === en.index + 1);
        if (p) { if (p.name !== en.name) { s.dispatch({ kind: 'player', payload: { id: p.id, name: en.name } }); changed++; } }
        else {
          const { players } = playersFromRoster([en], '');
          const np = { ...players[0], id: `slot${en.index + 1}` };
          if (!m.players[np.id]) { s.dispatch({ kind: 'addPlayer', payload: { ...np, isMe: false } }); changed++; }
        }
        if (en.avatar_png && !en.dead && p) s.setAvatar(p.id, `data:image/png;base64,${en.avatar_png}`);
      }
      invoke('watcher_set_names', { names: r.entries.map(e => e.name) }).catch(() => {});
      return `rescanned ${r.entries.length} cards, ${changed} updated`;
    } catch (e) { return String(e); }
  };

  return { settings, setSettings, watcher, captureOk, meGuessed, setMeGuessed, lobbyCode, rescanNames };
}
