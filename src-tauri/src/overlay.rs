//! In-game overlay window: transparent, borderless, always-on-top, click-through.
//! It is a second webview (label "overlay") that renders `?overlay=1` of the same
//! frontend; the main window pushes it state over the `overlay://state` event.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

#[derive(serde::Deserialize)]
pub struct OverlayPlacement {
    /// Logical pixels. When omitted, the overlay docks to the top-right of the primary monitor.
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub w: Option<u32>,
    pub h: Option<u32>,
}

#[tauri::command]
pub fn show_overlay<R: Runtime>(app: AppHandle<R>, placement: OverlayPlacement) -> Result<(), String> {
    let w = placement.w.unwrap_or(380);
    let h = placement.h.unwrap_or(640);
    let (mut x, mut y) = (placement.x.unwrap_or(0), placement.y.unwrap_or(0));
    if placement.x.is_none() {
        // UNVERIFIED on multi-monitor setups with mixed DPI: primary_monitor() reports physical px.
        if let Ok(Some(mon)) = app.primary_monitor() {
            let size = mon.size();
            let pos = mon.position();
            let scale = mon.scale_factor();
            x = pos.x + ((size.width as f64 / scale) as i32) - w as i32 - 12;
            y = pos.y + 12;
        }
    }
    if let Some(win) = app.get_webview_window(LABEL) {
        win.set_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?overlay=1".into()))
        .title("AboveThem overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .shadow(false)
        .position(x as f64, y as f64)
        .inner_size(w as f64, h as f64)
        .build()
        .map_err(|e| e.to_string())?;
    win.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_overlay<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) { win.hide().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn set_overlay_clickthrough<R: Runtime>(app: AppHandle<R>, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) { win.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn overlay_visible<R: Runtime>(app: AppHandle<R>) -> bool {
    app.get_webview_window(LABEL).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}
