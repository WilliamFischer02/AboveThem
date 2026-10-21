//! Global hotkey chords → `hotkey://chord` events. Phase 1.
//!
//! Chord model (docs/UI_SPEC.md): `<prefix>+<first>` then, within `chord_timeout_ms`,
//! a bare `<second>` key. The frontend owns the key→meaning mapping (colors, rooms
//! per map, actions); this module only knows key codes.
//!
//! Mechanism: the prefix chords are registered permanently with
//! `tauri-plugin-global-shortcut` (RegisterHotKey under the hood). When a prefix
//! chord fires, the second-layer keys are registered *temporarily* as bare global
//! hotkeys, so the second keypress reaches us even while Among Us has focus, and
//! are unregistered again on completion or timeout. While they are registered the
//! game does not receive those keys — that is the price of a two-keystroke chord
//! without a low-level keyboard hook, and it only lasts ≤ 1.5 s after a prefix.
//!
//! UNVERIFIED (needs a live test with Among Us focused in fullscreen-windowed):
//! RegisterHotKey-based shortcuts are expected to work there because the game
//! does not use raw input exclusively; if the game swallows them, the fallback
//! is a WH_KEYBOARD_LL hook (see docs/handoff.md).

use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct HotkeyConfig {
    /// e.g. "Ctrl+Alt"
    pub prefix: String,
    /// Key codes (W3C `Code` names: "KeyR", "Digit1", "Slash", "Enter", "Backquote"...).
    pub first: Vec<String>,
    /// Subset of `first` that completes a chord on its own (undo, toggle overlay...).
    pub immediate: Vec<String>,
    /// Second-layer keys. Bare codes, or "Shift+<code>" for shifted symbols like "!".
    pub second: Vec<String>,
    pub chord_timeout_ms: u64,
}

#[derive(Default)]
pub struct ChordState {
    config: HotkeyConfig,
    prefix_mods: Modifiers,
    pending: Option<(String, u64)>,
    seq: u64,
}

pub type Chords = Arc<Mutex<ChordState>>;

#[derive(Clone, Debug, serde::Serialize)]
pub struct ChordEvent {
    pub first: String,
    pub second: Option<String>,
    /// true when the chord timed out without a second key.
    pub cancelled: bool,
}

pub const EVENT_CHORD: &str = "hotkey://chord";
pub const EVENT_PENDING: &str = "hotkey://pending";

fn parse_prefix_mods(prefix: &str) -> Result<Modifiers, String> {
    // Parse "<prefix>+KeyA" and keep only the modifiers.
    Shortcut::from_str(&format!("{prefix}+KeyA")).map(|s| s.mods).map_err(|e| e.to_string())
}

fn key_string(sc: &Shortcut) -> String {
    let code = format!("{:?}", sc.key);
    if sc.mods.contains(Modifiers::SHIFT) && !sc.mods.contains(Modifiers::CONTROL) && !sc.mods.contains(Modifiers::ALT) {
        format!("Shift+{code}")
    } else {
        code
    }
}

/// Called for every global shortcut event (installed via `Builder::with_handler`).
pub fn on_shortcut<R: Runtime>(app: &AppHandle<R>, sc: &Shortcut, ev: ShortcutEvent) {
    if ev.state != ShortcutState::Pressed { return; }
    let chords: tauri::State<Chords> = app.state();
    let mut st = chords.lock().unwrap();
    let code = format!("{:?}", sc.key);
    let keystr = key_string(sc);

    let is_first = sc.mods == st.prefix_mods && st.config.first.iter().any(|k| *k == code);
    if is_first {
        if st.config.immediate.iter().any(|k| *k == code) {
            st.pending = None;
            let _ = app.emit(EVENT_CHORD, ChordEvent { first: code, second: None, cancelled: false });
            return;
        }
        st.seq += 1;
        let seq = st.seq;
        let already_pending = st.pending.is_some();
        st.pending = Some((code.clone(), seq));
        let second = st.config.second.clone();
        let timeout = Duration::from_millis(st.config.chord_timeout_ms.max(200));
        drop(st);
        let _ = app.emit(EVENT_PENDING, ChordEvent { first: code.clone(), second: None, cancelled: false });

        if !already_pending {
            let app1 = app.clone();
            std::thread::spawn(move || {
                if let Err(e) = app1.global_shortcut().register_multiple(second.iter().map(String::as_str)) {
                    eprintln!("[hotkeys] register second layer failed: {e}");
                }
            });
        }
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(timeout);
            let chords: tauri::State<Chords> = app2.state();
            let mut st = chords.lock().unwrap();
            if matches!(&st.pending, Some((_, s)) if *s == seq) {
                st.pending = None;
                let second = st.config.second.clone();
                drop(st);
                let _ = app2.emit(EVENT_CHORD, ChordEvent { first: code, second: None, cancelled: true });
                let _ = app2.global_shortcut().unregister_multiple(second.iter().map(String::as_str));
            }
        });
        return;
    }

    // Second layer: only meaningful while a chord is pending.
    if let Some((first, _)) = st.pending.clone() {
        if st.config.second.iter().any(|k| *k == keystr) {
            st.pending = None;
            let second = st.config.second.clone();
            drop(st);
            let _ = app.emit(EVENT_CHORD, ChordEvent { first, second: Some(keystr), cancelled: false });
            let app3 = app.clone();
            std::thread::spawn(move || {
                let _ = app3.global_shortcut().unregister_multiple(second.iter().map(String::as_str));
            });
        }
    }
}

/// Replace the whole hotkey configuration. Registers `<prefix>+<first>` for every first key.
#[tauri::command]
pub fn set_hotkey_config<R: Runtime>(app: AppHandle<R>, config: HotkeyConfig) -> Result<(), String> {
    let prefix_mods = parse_prefix_mods(&config.prefix)?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let firsts: Vec<String> = config.first.iter().map(|k| format!("{}+{}", config.prefix, k)).collect();
    // Validate everything before registering anything, so a typo doesn't leave half a config live.
    for s in firsts.iter().chain(config.second.iter()) {
        Shortcut::from_str(s).map_err(|e| format!("bad shortcut {s:?}: {e}"))?;
    }
    gs.register_multiple(firsts.iter().map(String::as_str)).map_err(|e| e.to_string())?;
    let chords: tauri::State<Chords> = app.state();
    let mut st = chords.lock().unwrap();
    st.config = config;
    st.prefix_mods = prefix_mods;
    st.pending = None;
    Ok(())
}

#[tauri::command]
pub fn clear_hotkeys<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    let chords: tauri::State<Chords> = app.state();
    let mut st = chords.lock().unwrap();
    st.config = HotkeyConfig::default();
    st.pending = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_and_shifted_codes_parse() {
        assert!(Shortcut::from_str("KeyE").is_ok());
        assert!(Shortcut::from_str("Shift+Digit1").is_ok());
        assert!(Shortcut::from_str("Ctrl+Alt+KeyR").is_ok());
        assert!(Shortcut::from_str("Backquote").is_ok());
        assert!(Shortcut::from_str("Slash").is_ok());
    }

    #[test]
    fn prefix_mods_are_extracted() {
        let m = parse_prefix_mods("Ctrl+Alt").unwrap();
        assert!(m.contains(Modifiers::CONTROL) && m.contains(Modifiers::ALT) && !m.contains(Modifiers::SHIFT));
    }

    #[test]
    fn key_string_marks_shift_only() {
        let s = Shortcut::from_str("Shift+Digit1").unwrap();
        assert_eq!(key_string(&s), "Shift+Digit1");
        let s = Shortcut::from_str("KeyE").unwrap();
        assert_eq!(key_string(&s), "KeyE");
    }
}
