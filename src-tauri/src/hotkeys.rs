//! Global hotkey chords → typed events. Phase 1.
//! Chord model: prefix (Ctrl+Alt) + color key, then a room/action key within 1.5 s.
//! Emits `hotkey://chord` with { color, action, room } to the frontend.

use tauri::AppHandle;

pub fn register_defaults(_app: &AppHandle) -> tauri::Result<()> {
    // UNVERIFIED: Phase 1 — use tauri_plugin_global_shortcut to register the prefix
    // chords and a short-lived listener for the second key. Verify Among Us in
    // fullscreen-windowed does not swallow global shortcuts.
    Ok(())
}
