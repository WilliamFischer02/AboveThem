/** Copy plain text (never UI labels) to the clipboard; WebView2 clipboard first, Tauri plugin as fallback. */
import { isTauri } from '../state/persist';

export async function copyText(text: string): Promise<boolean> {
  const t = text.trim();
  try { await navigator.clipboard.writeText(t); return true; } catch { /* no permission / not focused */ }
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:clipboard-manager|write_text', { text: t, label: null });
    return true;
  } catch { return false; }
}
