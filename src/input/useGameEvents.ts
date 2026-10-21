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
import type { Phase, Player, PlayerColor, PlayerId } from '../types/game';

export interface RosterEntry { index: number; name: string; name_confidence: number; color: string; color_delta_e: number; dead: boolean; reporter: boolean }
interface PhaseEvent { phase: string; round: number; meeting: number }
interface EjectEvent { raw: string; name: string | null; was_impostor: boolean | null; skipped: boolean }
export interface WatcherStatus { running: boolean; phase: string | null; round: number; meeting: number; markers: Record<string, boolean>; last_ocr_ms: number; ocr_calls: number; frame_seq: number; lobby_code: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function fuzzyFind<T extends { name: string }>(name: string, list: T[]): T | undefined {
  const n = norm(name);
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

      guard(await listen<RosterEntry[]>('game://roster', async e => {
        const s = useMatch.getState();
        const entries = e.payload;
        if (!s.match) {
          if (creating) return;
          creating = true;
          const presets = await loadPresets();
          if (useMatch.getState().match) { creating = false; return; }
          const preset = lobbyCode ? presets[lobbyCode] : undefined;
          const { players, me, meGuessed } = playersFromRoster(entries, settings.myName);
          setMeGuessed(meGuessed);
          s.newMatch({ settings: preset?.settings ?? DEFAULT_SETTINGS, map: (preset?.settings ?? DEFAULT_SETTINGS).map, me, myRole: role ?? 'crew', players, lobbyCode: lobbyCode ?? undefined });
          // The watcher fires in a meeting, so the match starts in meeting phase.
          useMatch.getState().setPhase('meetingDiscussion', { reason: 'body' });
          useMatch.getState().showToast(`Roster read: ${players.length} players${meGuessed ? ' — tap your crewmate' : ''}`);
          invoke('watcher_set_names', { names: players.map(p => p.name) }).catch(() => {});
          creating = false;
          return;
        }
        const m = s.match;
        const existing = Object.values(m.players);
        for (const en of entries) {
          // Same vote-grid slot = same player, whatever OCR made of the name this time.
          let p = existing.find(x => x.slot === en.index + 1) ?? fuzzyFind(en.name, existing);
          if (!p && existing.length >= entries.length) {
            // Lobby is full: never invent a player, take the closest unmatched name.
            const taken = new Set(entries.map(x => fuzzyFind(x.name, existing)?.id).filter(Boolean));
            p = existing.filter(x => !taken.has(x.id)).sort((a, b) => similarity(norm(en.name), norm(b.name)) - similarity(norm(en.name), norm(a.name)))[0];
          }
          if (!p) {
            const live = useMatch.getState().match!;
            const { players } = playersFromRoster([en], '');
            const np = players[0];
            // Ids must be unique: fall back to a slot id when that colour is already taken.
            const id = live.players[np.id] || Object.values(live.players).some(x => x.color === np.color) ? `slot${en.index + 1}` : np.id;
            if (!live.players[id]) s.dispatch({ kind: 'addPlayer', payload: { ...np, id, isMe: false } });
            continue;
          }
          if (p.slot === undefined) s.dispatch({ kind: 'player', payload: { id: p.id, slot: en.index + 1 } });
          if (en.dead && p.status === 'alive') s.dispatch({ kind: 'player', payload: { id: p.id, status: 'dead' } });
        }
      }));

      guard(await listen<PhaseEvent>('game://phase', e => {
        const s = useMatch.getState();
        if (!s.match) return;
        const map: Record<string, Phase> = { lobby: 'lobby', roundStart: 'roundStart', round: 'round', meetingDiscussion: 'meetingDiscussion', meetingVoting: 'meetingVoting', ejection: 'ejection', gameOver: 'gameOver' };
        const phase = map[e.payload.phase];
        if (!phase || s.match.phase.phase === phase) return;
        if (phase === 'lobby' && s.match.phase.phase !== 'gameOver') return; // never bounce a live match back to lobby on a missed frame
        s.setPhase(phase, phase === 'meetingDiscussion' ? { reason: 'body' } : undefined);
        s.showToast(`${phase === 'round' ? 'Round started' : phase === 'meetingDiscussion' ? 'Meeting' : phase === 'ejection' ? 'Vote done' : phase} (auto)`);
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
    })();
    return () => { cancelled = true; unlisten.forEach(u => u()); };
  }, [settings, lobbyCode]);

  return { settings, setSettings, watcher, captureOk, meGuessed, setMeGuessed, lobbyCode };
}
