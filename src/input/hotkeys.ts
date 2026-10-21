/**
 * Hotkey chords: key codes ↔ meaning. Pure TS so the mapping is testable; the
 * Tauri wiring (register + listen) is in `useHotkeys.ts`.
 *
 * Both keys are pressed WITH the prefix held (Ctrl+Alt): plain WASD/E/R/Q are never
 * intercepted from the game.
 * Layer 1: prefix + colour key, Space (body), Slash (my room), z (undo), Backquote (overlay).
 * Layer 2 (≤ 1.5 s later, prefix still held): a room key, or an action:
 *     .  with me      v  saw visual task     !  saw vent     k  saw kill
 *     +  mark sus     -  mark clear
 *
 * Doc note: docs/UI_SPEC.md used `b` for body and `t` for translator, which
 * collide with Blue and Tan. Body is Space here; translator is Phase 3.
 */
import type { MapData, PlayerColor, RoomId } from '../types/game';
import { PALETTE, COLOR_IDS } from '../ui/palette';

export interface HotkeyConfig {
  prefix: string;
  first: string[];
  immediate: string[];
  second: string[];
  chord_timeout_ms: number;
}

export interface ChordEvent { first: string; second: string | null; cancelled: boolean }

/** Who a chord is about: a colour letter, or a roster slot digit (1-9, 0 = 10). */
export type Target = { color: PlayerColor } | { slot: number };

export type ChordAction =
  | { kind: 'sighting'; target: Target; room: RoomId }
  | { kind: 'withMe'; target: Target }
  | { kind: 'sawTask'; target: Target }
  | { kind: 'sawVent'; target: Target }
  | { kind: 'sawKill'; target: Target }
  | { kind: 'mark'; target: Target; mark: 'sus' | 'clear' }
  | { kind: 'bodyFound'; room: RoomId }
  | { kind: 'myRoom'; room: RoomId }
  | { kind: 'undo' }
  | { kind: 'toggleOverlay' }
  | { kind: 'cancelled'; first: string }
  | { kind: 'unknown'; first: string; second: string | null };

const letterCode = (ch: string) => `Key${ch.toUpperCase()}`;

export const FIRST_SPECIAL = { body: 'Space', myRoom: 'Slash', undo: 'KeyZ', toggleOverlay: 'Backquote' } as const;

export const ACTION_KEYS: Record<string, Exclude<ChordAction['kind'], 'sighting' | 'bodyFound' | 'myRoom' | 'undo' | 'toggleOverlay' | 'cancelled' | 'unknown'> | 'sus' | 'clear'> = {
  Period: 'withMe',
  KeyV: 'sawTask',
  'Shift+Digit1': 'sawVent',
  KeyK: 'sawKill',
  'Shift+Equal': 'sus',
  Minus: 'clear',
};

/** Room key (single char from map data) → code. Two-char keys are rejected (chord must be 2 keypresses). */
export function roomKeyCodes(map: MapData): Record<string, RoomId> {
  const out: Record<string, RoomId> = {};
  for (const r of map.rooms) {
    if (r.key.length !== 1) continue;
    const code = /[a-z]/i.test(r.key) ? letterCode(r.key) : /[0-9]/.test(r.key) ? `Digit${r.key}` : null;
    if (code) out[code] = r.id;
  }
  return out;
}

export function colorKeyCodes(): Record<string, PlayerColor> {
  const out: Record<string, PlayerColor> = {};
  for (const c of COLOR_IDS) out[letterCode(PALETTE[c].key)] = c;
  return out;
}

export const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
export const slotOfCode = (code: string): number | null => { const i = SLOT_KEYS.indexOf(code); return i < 0 ? null : i + 1; };

export function buildConfig(map: MapData, prefix = 'Ctrl+Alt', timeoutMs = 1500): HotkeyConfig {
  const colors = Object.keys(colorKeyCodes());
  const rooms = Object.keys(roomKeyCodes(map));
  return {
    prefix,
    first: [...colors, ...SLOT_KEYS, FIRST_SPECIAL.body, FIRST_SPECIAL.myRoom, FIRST_SPECIAL.undo, FIRST_SPECIAL.toggleOverlay],
    immediate: [FIRST_SPECIAL.undo, FIRST_SPECIAL.toggleOverlay],
    second: [...new Set([...rooms, ...Object.keys(ACTION_KEYS)])],
    chord_timeout_ms: timeoutMs,
  };
}

export function interpret(map: MapData, ev: ChordEvent): ChordAction {
  if (ev.cancelled) return { kind: 'cancelled', first: ev.first };
  const colors = colorKeyCodes();
  const rooms = roomKeyCodes(map);
  if (ev.first === FIRST_SPECIAL.undo) return { kind: 'undo' };
  if (ev.first === FIRST_SPECIAL.toggleOverlay) return { kind: 'toggleOverlay' };
  if (!ev.second) return { kind: 'unknown', first: ev.first, second: null };
  if (ev.first === FIRST_SPECIAL.body) {
    const room = rooms[ev.second];
    return room ? { kind: 'bodyFound', room } : { kind: 'unknown', first: ev.first, second: ev.second };
  }
  if (ev.first === FIRST_SPECIAL.myRoom) {
    const room = rooms[ev.second];
    return room ? { kind: 'myRoom', room } : { kind: 'unknown', first: ev.first, second: ev.second };
  }
  const color = colors[ev.first];
  const slot = slotOfCode(ev.first);
  if (!color && slot === null) return { kind: 'unknown', first: ev.first, second: ev.second };
  const target: Target = color ? { color } : { slot: slot! };
  const action = ACTION_KEYS[ev.second];
  if (action === 'sus' || action === 'clear') return { kind: 'mark', target, mark: action };
  if (action) return { kind: action, target } as ChordAction;
  const room = rooms[ev.second];
  if (room) return { kind: 'sighting', target, room };
  return { kind: 'unknown', first: ev.first, second: ev.second };
}

/** Human label for a key code, for the cheat-sheet and the pending indicator. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  const m: Record<string, string> = { Space: 'space', Slash: '/', Backquote: '`', Period: '.', Minus: '-', 'Shift+Equal': '+', 'Shift+Digit1': '!' };
  return m[code] ?? code;
}
