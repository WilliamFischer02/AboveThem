//! AboveThem backend.
//!
//! Module map (see docs/ARCHITECTURE.md):
//!   capture   — Windows Graphics Capture frame grabber (Phase 2)
//!   regions   — resolution-relative ROI definitions + calibration persistence (Phase 2)
//!   ocr       — Windows.Media.Ocr wrapper (Phase 2)
//!   colors    — player-color swatch sampling in CIELAB (Phase 2)
//!   phase     — game phase state machine from UI markers (Phase 2)
//!   hotkeys   — global hotkey chords → typed events (Phase 1)
//!   translate — provider trait + implementations (Phase 3)
//!   ipc       — Tauri commands/events, the only module the frontend talks to
//!
//! Everything Windows-specific is cfg(windows) and stubbed elsewhere so the crate
//! still compiles for `cargo test` on other platforms.

pub mod capture;
pub mod colors;
pub mod hotkeys;
pub mod ipc;
pub mod ocr;
pub mod phase;
pub mod regions;
pub mod translate;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            ipc::ping,
            ipc::list_capture_targets,
            ipc::translate_text,
        ])
        .setup(|app| {
            hotkeys::register_defaults(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AboveThem");
}
