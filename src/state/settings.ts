/** App settings in `%APPDATA%/AboveThem/settings.json`. */
import { persist } from './persist';

export interface AppSettings {
  /** The user's in-game display name; lets the auto-roster pick "me". */
  myName: string;
  /** Start capture + watcher automatically whenever the game window exists. */
  autoCapture: boolean;
  /** Show the in-game overlay automatically when a match starts. */
  autoOverlay: boolean;
  hotkeyPrefix: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { myName: '', autoCapture: true, autoOverlay: true, hotkeyPrefix: 'Ctrl+Alt' };

const FILE = 'settings.json';

export async function loadSettings(): Promise<AppSettings> {
  const s = await persist.readJson<Partial<AppSettings>>(FILE);
  return { ...DEFAULT_APP_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await persist.writeJson(FILE, s);
}
