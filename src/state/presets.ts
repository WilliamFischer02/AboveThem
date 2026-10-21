/** Lobby presets remembered by lobby code, in `%APPDATA%/AboveThem/presets.json`. */
import type { LobbySettings, PlayerColor, PlayerId } from '../types/game';
import { persist } from './persist';

export interface PresetPlayer { id: PlayerId; color: PlayerColor; name: string }
export interface LobbyPreset {
  code: string;
  savedAt: number;
  settings: LobbySettings;
  players: PresetPlayer[];
  me: PlayerId | null;
}

interface PresetFile { version: 1; presets: Record<string, LobbyPreset> }

const FILE = 'presets.json';

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export async function loadPresets(): Promise<Record<string, LobbyPreset>> {
  const f = await persist.readJson<PresetFile>(FILE);
  return f?.presets ?? {};
}

export async function savePreset(p: LobbyPreset): Promise<void> {
  const all = await loadPresets();
  all[normalizeCode(p.code)] = { ...p, code: normalizeCode(p.code), savedAt: Date.now() };
  await persist.writeJson(FILE, { version: 1, presets: all } satisfies PresetFile);
}

export async function deletePreset(code: string): Promise<void> {
  const all = await loadPresets();
  delete all[normalizeCode(code)];
  await persist.writeJson(FILE, { version: 1, presets: all } satisfies PresetFile);
}

export const DEFAULT_SETTINGS: LobbySettings = {
  map: 'skeld', impostorCount: 2, killCooldownSec: 30, visualTasksOn: true, confirmEjectsOn: true,
  anonymousVotes: false, taskBarMode: 'always', crewVision: 1, impostorVision: 1.5, playerSpeed: 1,
  emergencyMeetings: 1, discussionTimeSec: 15, votingTimeSec: 120, commonTasks: 1, longTasks: 1, shortTasks: 2,
};
