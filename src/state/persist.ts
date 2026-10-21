/**
 * Disk bridge. In Tauri this calls the Rust commands in `src-tauri/src/files.rs`;
 * in a plain browser (vite dev without Tauri, Vitest) it degrades to an
 * in-memory map so the UI keeps working ("fail soft").
 */
import type { MatchEvent } from './events';
import { toLine, parseLines } from './events';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeImpl: Invoke | null = null;

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeImpl) {
    const mod = await import('@tauri-apps/api/core');
    invokeImpl = mod.invoke as Invoke;
  }
  return invokeImpl<T>(cmd, args);
}

// In-memory fallback (browser / tests).
const memMatches = new Map<string, string[]>();
const memFiles = new Map<string, string>();

export interface MatchFile { id: string; modified_ms: number; bytes: number }

export const persist = {
  async appendEvent(matchId: string, e: MatchEvent): Promise<void> {
    const line = toLine(e);
    if (!isTauri()) { (memMatches.get(matchId) ?? memMatches.set(matchId, []).get(matchId)!).push(line); return; }
    await invoke('append_match_event', { matchId, line });
  },

  async listMatches(): Promise<MatchFile[]> {
    if (!isTauri()) return [...memMatches.keys()].map(id => ({ id, modified_ms: 0, bytes: 0 }));
    return invoke<MatchFile[]>('list_matches');
  },

  async readMatch(matchId: string): Promise<MatchEvent[]> {
    if (!isTauri()) return parseLines((memMatches.get(matchId) ?? []).join('\n'));
    return parseLines(await invoke<string>('read_match', { matchId }));
  },

  async readJson<T>(name: string): Promise<T | null> {
    const text = isTauri() ? await invoke<string | null>('read_app_file', { name }) : memFiles.get(name) ?? null;
    if (text == null) return null;
    try { return JSON.parse(text) as T; } catch { return null; }
  },

  async writeJson(name: string, value: unknown): Promise<void> {
    const contents = JSON.stringify(value, null, 2);
    if (!isTauri()) { memFiles.set(name, contents); return; }
    await invoke('write_app_file', { name, contents });
  },

  async appDir(): Promise<string> {
    if (!isTauri()) return '(in-memory)';
    return invoke<string>('app_dir_path');
  },
};
