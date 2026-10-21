//! Tauri commands exposed to the frontend. Keep thin; logic lives in the modules.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::capture::{self, CaptureState, CaptureStatus};
use crate::ocr::{self, OcrLine};
use crate::regions::{Rect, Regions};

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[derive(Serialize)]
pub struct CaptureTarget {
    pub hwnd: u64,
    pub title: String,
}

#[tauri::command]
pub fn list_capture_targets() -> Vec<CaptureTarget> {
    capture::list_windows().into_iter().map(|(hwnd, title)| CaptureTarget { hwnd, title }).collect()
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn capture_start(state: State<CaptureState>, title: Option<String>, min_interval_ms: Option<u64>) -> Result<CaptureStatus, String> {
    state.start(title.as_deref().unwrap_or("Among Us"), min_interval_ms.unwrap_or(250))
}

#[tauri::command]
pub fn capture_stop(state: State<CaptureState>) -> CaptureStatus {
    state.stop();
    state.status()
}

#[tauri::command]
pub fn capture_status(state: State<CaptureState>) -> CaptureStatus {
    state.status()
}

/// Latest frame as a base64 PNG, downscaled to `max_width` (default 960) for the calibration preview.
#[tauri::command]
pub async fn capture_frame_png(state: State<'_, CaptureState>, max_width: Option<u32>) -> Result<String, String> {
    let f = state.latest_frame().ok_or("no frame yet")?;
    let (bgra, w, h) = capture::downscale_bgra(&f.bgra, f.width, f.height, max_width.unwrap_or(960));
    encode_png_base64(&bgra, w, h)
}

fn encode_png_base64(bgra: &[u8], w: u32, h: u32) -> Result<String, String> {
    use base64::Engine;
    let mut rgba = bgra.to_vec();
    for px in rgba.chunks_exact_mut(4) { px.swap(0, 2); px[3] = 255; }
    let img = image::RgbaImage::from_raw(w, h, rgba).ok_or("bad buffer")?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out.into_inner()))
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OcrRegionReq {
    /// Either a named region from `Regions` (scaled to the frame) …
    pub region: Option<String>,
    /// … or an explicit rect in frame pixels.
    pub rect: Option<Rect>,
    /// Upscale factor before OCR (default 2).
    pub scale: Option<u32>,
    pub lang: Option<String>,
}

#[derive(Serialize)]
pub struct OcrRegionRes {
    pub rect: Rect,
    pub frame_seq: u64,
    pub frame_age_ms: u64,
    pub ocr_ms: u64,
    pub lang: Option<String>,
    /// Lines with boxes in FRAME pixel coordinates.
    pub lines: Vec<OcrLine>,
}

#[tauri::command]
pub async fn ocr_region(state: State<'_, CaptureState>, req: OcrRegionReq) -> Result<OcrRegionRes, String> {
    let f = state.latest_frame().ok_or("no frame yet — start capture first")?;
    let rect = match (&req.region, req.rect) {
        (_, Some(r)) => r,
        (Some(name), None) => Regions::default().for_frame(f.width, f.height).get(name).ok_or_else(|| format!("unknown region {name}"))?,
        (None, None) => Rect::new(0, 0, f.width, f.height),
    };
    let scale = req.scale.unwrap_or(2).clamp(1, 4);
    let (crop, cw, ch) = capture::crop_bgra(&f, rect.x, rect.y, rect.w, rect.h);
    let (up, uw, uh) = capture::upscale_bgra(&crop, cw, ch, scale);
    let t0 = std::time::Instant::now();
    let res = ocr::ocr_bgra(&up, uw, uh, req.lang.as_deref()).map_err(|e| e.to_string())?;
    let ocr_ms = t0.elapsed().as_millis() as u64;
    let lines = res.lines.into_iter().map(|l| OcrLine { text: l.text, x: rect.x + l.x / scale, y: rect.y + l.y / scale, w: l.w / scale, h: l.h / scale }).collect();
    Ok(OcrRegionRes { rect, frame_seq: f.seq, frame_age_ms: capture::now_ms().saturating_sub(f.t_wall_ms), ocr_ms, lang: res.lang, lines })
}

/// Read the meeting vote grid from the latest frame → roster entries.
#[tauri::command]
pub async fn read_roster(state: State<'_, CaptureState>, known_names: Option<Vec<String>>) -> Result<crate::roster::RosterRead, String> {
    let f = state.latest_frame().ok_or("no frame yet — start capture first")?;
    crate::roster::read_vote_grid(&f, &known_names.unwrap_or_default()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Watcher (automatic detection)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn watcher_start(app: tauri::AppHandle, cap: State<CaptureState>, w: State<crate::watcher::WatcherState>) -> crate::watcher::WatcherStatus {
    crate::watcher::start(app, &w, cap.latest.clone());
    w.shared.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn watcher_stop(w: State<crate::watcher::WatcherState>) -> crate::watcher::WatcherStatus {
    crate::watcher::stop(&w);
    w.shared.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn watcher_status(w: State<crate::watcher::WatcherState>) -> crate::watcher::WatcherStatus {
    w.shared.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn watcher_set_names(w: State<crate::watcher::WatcherState>, names: Vec<String>) {
    w.shared.lock().unwrap().known_names = names;
}

#[tauri::command]
pub fn ocr_languages() -> Vec<String> {
    ocr::available_languages()
}

#[tauri::command]
pub fn default_regions() -> Regions {
    Regions::default()
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TranslateReq {
    pub text: String,
    pub from: Option<String>,
    pub to: String,
}

#[derive(Serialize)]
pub struct TranslateRes {
    pub text: String,
    pub detected: Option<String>,
    pub provider: String,
}

#[tauri::command]
pub async fn translate_text(req: TranslateReq) -> Result<TranslateRes, String> {
    let detected = req.from.clone().or_else(|| crate::translate::detect(&req.text));
    let provider = crate::translate::current();
    let text = provider
        .translate(&req.text, detected.as_deref().unwrap_or("auto"), &req.to)
        .await
        .map_err(|e| e.to_string())?;
    Ok(TranslateRes { text, detected, provider: provider.name().to_string() })
}
