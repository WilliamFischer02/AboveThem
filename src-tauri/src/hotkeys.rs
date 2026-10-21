//! Global hotkey chords → `hotkey://chord` events. Phase 1.
//!
//! Chord model (docs/UI_SPEC.md, ADR-009 rev 2): `<prefix>+<first>` then, within
//! `chord_timeout_ms`, `<prefix>+<second>` — the prefix (Ctrl+Alt) stays held
//! for BOTH keys. Every registered shortcut carries the prefix, so no bare key
//! (WASD, E, R, Q, Tab...) is ever intercepted from the game. The frontend owns
//! the key→meaning mapping (colours, rooms per map, actions); this module only
//! knows key codes and whether a chord is pending.
//!
//! The same physical shortcut (e.g. Ctrl+Alt+R) is "Red" as a first key and
//! "Reactor" as a second key; the pending state disambiguates.
//!
//! UNVERIFIED with Among Us focused in fullscreen-windowed — being tested live.
//! Fallback if the game swallows RegisterHotKey: WH_KEYBOARD_LL hook thread.

use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct HotkeyConfig {
    /// e.g. "Ctrl+Alt"
    pub prefix: String,
    /// First-layer key codes (W3C `Code` names: "KeyR", "Space", "Slash", "KeyZ", "Backquote"...).
    pub first: Vec<String>,
    /// Subset of `first` that completes a chord on its own (undo, toggle overlay...).
    pub immediate: Vec<String>,
    /// Second-layer keys: bare codes, or "Shift+<code>" for shifted symbols like "!" and "+".
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
    Shortcut::from_str(&format!("{prefix}+KeyA")).map(|s| s.mods).map_err(|e| e.to_string())
}

/// The second-layer name of a pressed shortcut, with the prefix removed: "KeyE" or "Shift+Digit1".
fn layer_key(sc: &Shortcut, prefix_mods: Modifiers) -> Option<String> {
    let extra = sc.mods - prefix_mods;
    if !sc.mods.contains(prefix_mods) { return None; }
    let code = format!("{:?}", sc.key);
    if extra.is_empty() { Some(code) }
    else if extra == Modifiers::SHIFT { Some(format!("Shift+{code}")) }
    else { None }
}

/// All shortcuts to register for a config: prefix + every first and second key.
fn all_shortcuts(config: &HotkeyConfig) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    for k in config.first.iter().chain(config.second.iter()) {
        let s = if let Some(rest) = k.strip_prefix("Shift+") { format!("{}+Shift+{}", config.prefix, rest) } else { format!("{}+{}", config.prefix, k) };
        if !v.contains(&s) { v.push(s); }
    }
    v
}

/// Called for every global shortcut event (installed via `Builder::with_handler`).
pub fn on_shortcut<R: Runtime>(app: &AppHandle<R>, sc: &Shortcut, ev: ShortcutEvent) {
    if ev.state != ShortcutState::Pressed { return; }
    let chords: tauri::State<Chords> = app.state();
    let mut st = chords.lock().unwrap();
    let Some(key) = layer_key(sc, st.prefix_mods) else { return };

    // Second layer wins while a chord is pending.
    if let Some((first, _)) = st.pending.clone() {
        if st.config.second.iter().any(|k| *k == key) {
            st.pending = None;
            drop(st);
            let _ = app.emit(EVENT_CHORD, ChordEvent { first, second: Some(key), cancelled: false });
            return;
        }
        // Not a valid second key: fall through and treat it as a new first key.
    }

    if st.config.first.iter().any(|k| *k == key) {
        if st.config.immediate.iter().any(|k| *k == key) {
            st.pending = None;
            drop(st);
            let _ = app.emit(EVENT_CHORD, ChordEvent { first: key, second: None, cancelled: false });
            return;
        }
        st.seq += 1;
        let seq = st.seq;
        st.pending = Some((key.clone(), seq));
        let timeout = Duration::from_millis(st.config.chord_timeout_ms.max(200));
        drop(st);
        let _ = app.emit(EVENT_PENDING, ChordEvent { first: key.clone(), second: None, cancelled: false });
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(timeout);
            let chords: tauri::State<Chords> = app2.state();
            let mut st = chords.lock().unwrap();
            if matches!(&st.pending, Some((_, s)) if *s == seq) {
                st.pending = None;
                drop(st);
                let _ = app2.emit(EVENT_CHORD, ChordEvent { first: key, second: None, cancelled: true });
            }
        });
    }
}

/// Replace the whole hotkey configuration. Registers `<prefix>+<key>` for every first and second key.
#[tauri::command]
pub fn set_hotkey_config<R: Runtime>(app: AppHandle<R>, config: HotkeyConfig) -> Result<(), String> {
    let prefix_mods = parse_prefix_mods(&config.prefix)?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let shortcuts = all_shortcuts(&config);
    for s in &shortcuts {
        Shortcut::from_str(s).map_err(|e| format!("bad shortcut {s:?}: {e}"))?;
    }
    gs.register_multiple(shortcuts.iter().map(String::as_str)).map_err(|e| e.to_string())?;
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
    fn shortcuts_all_carry_the_prefix() {
        let cfg = HotkeyConfig { prefix: "Ctrl+Alt".into(), first: vec!["KeyR".into(), "Space".into()], immediate: vec![], second: vec!["KeyE".into(), "Shift+Digit1".into(), "KeyR".into()], chord_timeout_ms: 1500 };
        let all = all_shortcuts(&cfg);
        assert_eq!(all, vec!["Ctrl+Alt+KeyR", "Ctrl+Alt+Space", "Ctrl+Alt+KeyE", "Ctrl+Alt+Shift+Digit1"]);
        for s in &all { assert!(Shortcut::from_str(s).is_ok(), "{s}"); }
    }

    #[test]
    fn layer_key_strips_prefix_and_keeps_shift() {
        let pm = parse_prefix_mods("Ctrl+Alt").unwrap();
        assert_eq!(layer_key(&Shortcut::from_str("Ctrl+Alt+KeyE").unwrap(), pm), Some("KeyE".into()));
        assert_eq!(layer_key(&Shortcut::from_str("Ctrl+Alt+Shift+Digit1").unwrap(), pm), Some("Shift+Digit1".into()));
        assert_eq!(layer_key(&Shortcut::from_str("KeyE").unwrap(), pm), None);
        assert_eq!(layer_key(&Shortcut::from_str("Ctrl+KeyE").unwrap(), pm), None);
    }
}
