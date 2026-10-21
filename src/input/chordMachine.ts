/**
 * In-window chord state machine. Mirrors the Rust side (`hotkeys.rs`) for two
 * cases: (1) running in a plain browser during development, (2) a fallback if
 * global registration fails. Feeds `KeyboardEvent`s, emits ChordEvents.
 */
import type { ChordEvent, HotkeyConfig } from './hotkeys';

export interface ChordMachine {
  onKeyDown: (e: KeyboardEvent) => boolean; // true if consumed
  dispose: () => void;
}

const prefixHeld = (prefix: string, e: KeyboardEvent): boolean => {
  const want = prefix.split('+').map(s => s.trim().toLowerCase());
  const has = { ctrl: e.ctrlKey, control: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, cmd: e.metaKey };
  return want.every(w => (has as Record<string, boolean>)[w]) &&
    (!e.ctrlKey || want.includes('ctrl') || want.includes('control')) &&
    (!e.altKey || want.includes('alt')) &&
    (!e.shiftKey || want.includes('shift'));
};

export function createChordMachine(config: HotkeyConfig, emit: (ev: ChordEvent) => void, onPending?: (first: string | null) => void): ChordMachine {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; pending = null; onPending?.(null); };
  return {
    onKeyDown(e) {
      if (e.repeat) return false;
      const code = e.code;
      if (prefixHeld(config.prefix, e) && config.first.includes(code)) {
        if (config.immediate.includes(code)) { clear(); emit({ first: code, second: null, cancelled: false }); return true; }
        if (timer) clearTimeout(timer);
        pending = code; onPending?.(code);
        const first = code;
        timer = setTimeout(() => { if (pending === first) { clear(); emit({ first, second: null, cancelled: true }); } }, config.chord_timeout_ms);
        return true;
      }
      if (pending && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const keystr = e.shiftKey ? `Shift+${code}` : code;
        if (config.second.includes(keystr)) {
          const first = pending; clear();
          emit({ first, second: keystr, cancelled: false });
          return true;
        }
      }
      return false;
    },
    dispose: clear,
  };
}
