/**
 * Per-viewer UI conveniences (sort order, focus mode, dismissed tips) in localStorage.
 * Never game state. Every access is wrapped: storage can be missing or throw, and the UI
 * must work without it (falls back to the default).
 */
import { useCallback, useState } from 'react';

const NS = 'abovethem.ui.';

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(NS + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

export function writePref<T>(key: string, value: T): void {
  try { window.localStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* storage unavailable: keep in memory only */ }
}

export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => readPref(key, fallback));
  const set = useCallback((next: T) => { setV(next); writePref(key, next); }, [key]);
  return [v, set];
}
