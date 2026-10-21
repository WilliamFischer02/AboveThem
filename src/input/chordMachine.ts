/**
 * In-window chord state machine. Mirrors the Rust side (`hotkeys.rs`): the
 * prefix (Ctrl+Alt) is held for both keys, so plain WASD/E/R/Q never count.
 * Used when running in a plain browser and as a fallback when the window
 * itself has focus. Feeds `KeyboardEvent`s, emits ChordEvents.
 */
import type { ChordEvent, HotkeyConfig } from './hotkeys';

export interface ChordMachine {
  onKeyDown: (e: KeyboardEvent) => boolean; // true if consumed
  dispose: () => void;
}

const prefixHeld = (prefix: string, e: KeyboardEvent): boolean => {
  const want = prefix.split('+').map(s => s.trim().toLowerCase());
  const has: Record<string, boolean> = { ctrl: e.ctrlKey, control: e.ctrlKey, alt: e.altKey, meta: e.metaKey, cmd: e.metaKey, shift: e.shiftKey };
  return want.every(w => has[w]);
};

export function createChordMachine(config: HotkeyConfig, emit: (ev: ChordEvent) => void, onPending?: (first: string | null) => void): ChordMachine {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; pending = null; onPending?.(null); };
  return {
    onKeyDown(e) {
      if (e.repeat || !prefixHeld(config.prefix, e)) return false;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return false;
      const code = e.code;
      const key = e.shiftKey && !config.prefix.toLowerCase().includes('shift') ? `Shift+${code}` : code;
      if (pending && config.second.includes(key)) {
        const first = pending; clear();
        emit({ first, second: key, cancelled: false });
        return true;
      }
      if (config.first.includes(key)) {
        if (config.immediate.includes(key)) { clear(); emit({ first: key, second: null, cancelled: false }); return true; }
        if (timer) clearTimeout(timer);
        pending = key; onPending?.(key);
        const first = key;
        timer = setTimeout(() => { if (pending === first) { clear(); emit({ first, second: null, cancelled: true }); } }, config.chord_timeout_ms);
        return true;
      }
      return false;
    },
    dispose: clear,
  };
}
