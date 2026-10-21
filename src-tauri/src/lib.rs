//! AboveThem backend.
//!
//! Module map (see docs/ARCHITECTURE.md):
//!   capture   — Windows Graphics Capture frame grabber (Phase 2)
//!   regions   — resolution-relative ROI definitions + calibration persistence (Phase 2)
//!   ocr       — Windows.Media.Ocr wrapper (Phase 2)
//!   chat      — open chat panel → messages (Phase 3)
//!   colors    — player-color swatch sampling in CIELAB (Phase 2)
//!   phase     — game phase state machine from UI markers (Phase 2)
//!   lobby     — floating-name reader for the lobby screen (Phase 2)
//!   roster    — vote-grid reader: names, colours, dead, reporter (Phase 2)
//!   watcher   — background loop: markers → phase/roster/eject events, no user trigger (Phase 2)
//!   hotkeys   — global hotkey chords → typed events (Phase 1)
//!   files     — %APPDATA%/AboveThem: match NDJSON logs, presets, settings (Phase 1)
//!   overlay   — transparent always-on-top click-through legend/clock window (Phase 1.5)
//!   translate — provider trait + implementations (Phase 3)
//!   ipc       — Tauri commands/events, the only module the frontend talks to
//!
//! Everything Windows-specific is cfg(windows) and stubbed elsewhere so the crate
//! still compiles for `cargo test` on other platforms.

pub mod capture;
pub mod chat;
pub mod colors;
pub mod files;
pub mod hotkeys;
pub mod ipc;
pub mod lobby;
pub mod ocr;
pub mod overlay;
pub mod phase;
pub mod regions;
pub mod roster;
pub mod translate;
pub mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(hotkeys::Chords::default())
        .manage(capture::CaptureState::default())
        .manage(watcher::WatcherState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::on_shortcut)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            ipc::ping,
            ipc::list_capture_targets,
            ipc::translate_text,
            ipc::capture_start,
            ipc::capture_stop,
            ipc::capture_status,
            ipc::capture_frame_png,
            ipc::ocr_region,
            ipc::ocr_languages,
            ipc::read_roster,
            ipc::calibrate_color,
            ipc::watcher_start,
            ipc::watcher_stop,
            ipc::watcher_status,
            ipc::watcher_set_names,
            ipc::default_regions,
            files::append_match_event,
            files::list_matches,
            files::read_match,
            files::read_app_file,
            files::write_app_file,
            files::app_dir_path,
            hotkeys::set_hotkey_config,
            hotkeys::clear_hotkeys,
            overlay::show_overlay,
            overlay::hide_overlay,
            overlay::set_overlay_clickthrough,
            overlay::overlay_visible,
        ])
        .setup(|_app| { ipc::load_color_calibration(); Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running AboveThem");
}
