/**
 * Wires chords to the store. Global (Tauri) chords come from `hotkey://chord`;
 * in-window chords come from the TS chord machine so the app also works when
 * it has focus itself or when running in a browser.
 */
import { useEffect, useState } from 'react';
import { useMatch } from '../state/store';
import { isTauri } from '../state/persist';
import { buildConfig, interpret, keyLabel, type ChordAction, type ChordEvent, type Target } from './hotkeys';
import { createChordMachine } from './chordMachine';
import { PALETTE } from '../ui/palette';
import type { MatchState, PlayerId, RoomId } from '../types/game';

export function playerByColor(m: MatchState, color: string): PlayerId | null {
  return Object.values(m.players).find(p => p.color === color)?.id ?? null;
}

/** Roster order: vote-grid slot when known, else insertion order. 1-based. */
export function slotOrder(m: MatchState): PlayerId[] {
  const ps = Object.values(m.players);
  const withSlot = ps.filter(p => p.slot !== undefined).sort((a, b) => a.slot! - b.slot!);
  const rest = ps.filter(p => p.slot === undefined);
  return [...withSlot, ...rest].map(p => p.id);
}

export function resolveTarget(m: MatchState, t: Target): PlayerId | null {
  if ('color' in t) return playerByColor(m, t.color);
  return slotOrder(m)[t.slot - 1] ?? null;
}

const targetLabel = (t: Target) => 'color' in t ? (PALETTE[t.color as keyof typeof PALETTE]?.label ?? t.color) : `slot ${t.slot}`;

/** Current round index for observation lookups (lobby/pre-round counts as round 0). */
export const currentRound = (m: MatchState) => Math.max(0, m.phase.round);

export function myRoomNow(m: MatchState): RoomId | null {
  const round = currentRound(m);
  for (let i = m.observations.length - 1; i >= 0; i--) {
    const o = m.observations[i];
    if (o.type === 'myRoom' && o.stamp.round === round) return o.room;
  }
  return null;
}

export function withMeNow(m: MatchState, p: PlayerId): boolean {
  const round = currentRound(m);
  let on = false;
  for (const o of m.observations) if (o.type === 'withMe' && o.player === p && o.stamp.round === round) on = o.on;
  return on;
}

export const roomName = (m: MatchState, id: RoomId) => m.map.rooms.find(r => r.id === id)?.name ?? id;

/** Apply a chord to the store. Exported so the roster menu can share it. */
export function applyAction(a: ChordAction): void {
  const s = useMatch.getState();
  const m = s.match;
  if (!m) return;
  const pname = (t: Target) => { const id = resolveTarget(m, t); return id ? m.players[id].name : targetLabel(t); };
  switch (a.kind) {
    case 'undo': s.undo(); return;
    case 'toggleOverlay': return; // Phase 5 (overlay mode)
    case 'cancelled': s.showToast(`Chord cancelled (${keyLabel(a.first)} …)`); return;
    case 'unknown': s.showToast(`Unmapped chord: ${keyLabel(a.first)} ${a.second ? keyLabel(a.second) : ''}`); return;
    case 'myRoom': s.observe({ type: 'myRoom', room: a.room }, `Me → ${roomName(m, a.room)}`); return;
    case 'bodyFound': s.observe({ type: 'bodyFound', victim: 'unknown', room: a.room }, `Body in ${roomName(m, a.room)} — click the victim in the roster`); return;
  }
  const id = resolveTarget(m, a.target);
  if (!id) { s.showToast(`${targetLabel(a.target)} is not in this lobby`); return; }
  const who = pname(a.target);
  const room = myRoomNow(m) ?? m.map.rooms[0].id;
  switch (a.kind) {
    case 'sighting': s.observe({ type: 'sighting', player: id, room: a.room }, `${who} in ${roomName(m, a.room)}`); return;
    case 'withMe': {
      const on = !withMeNow(m, id);
      s.observe({ type: 'withMe', player: id, room, on }, on ? `${who} with me (${roomName(m, room)})` : `${who} left me`);
      return;
    }
    case 'sawTask': s.observe({ type: 'sawTask', player: id, room, visualConfirmed: true }, `${who} did a VISUAL task in ${roomName(m, room)}`); return;
    case 'sawVent': s.observe({ type: 'sawVent', player: id, room }, `${who} VENTED in ${roomName(m, room)} — impostor`); return;
    case 'sawKill': s.observe({ type: 'sawKill', killer: id, victim: 'unknown', room }, `${who} KILLED in ${roomName(m, room)} — set victim in roster`); return;
    case 'mark': s.observe({ type: 'manualMark', player: id, mark: a.mark }, `${who} marked ${a.mark}`); return;
  }
}

export function useHotkeys(): { pending: string | null; registered: 'global' | 'window' | 'off'; error: string | null } {
  const map = useMatch(s => s.match?.map ?? null);
  const [pending, setPendingLocal] = useState<string | null>(null);
  const setPending = (code: string | null) => { setPendingLocal(code); useMatch.getState().setPending(code); };
  const [registered, setRegistered] = useState<'global' | 'window' | 'off'>('off');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!map) { setRegistered('off'); return; }
    const config = buildConfig(map);
    const handle = (ev: ChordEvent) => { setPending(null); applyAction(interpret(map, ev)); };

    // In-window chords always on (covers browser dev + docked focus).
    const machine = createChordMachine(config, handle, setPending);
    const onKey = (e: KeyboardEvent) => { if (machine.onKeyDown(e)) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    setRegistered('window');

    let unlistenChord: (() => void) | null = null;
    let unlistenPending: (() => void) | null = null;
    let cancelled = false;
    if (isTauri()) {
      (async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        try {
          await invoke('set_hotkey_config', { config });
          if (cancelled) return;
          unlistenChord = await listen<ChordEvent>('hotkey://chord', e => handle(e.payload));
          unlistenPending = await listen<ChordEvent>('hotkey://pending', e => setPending(e.payload.first));
          setRegistered('global');
          setError(null);
        } catch (err) {
          setError(String(err));
        }
      })();
    }
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      machine.dispose();
      unlistenChord?.(); unlistenPending?.();
      if (isTauri()) import('@tauri-apps/api/core').then(({ invoke }) => invoke('clear_hotkeys')).catch(() => {});
    };
  }, [map]);

  return { pending, registered, error };
}
