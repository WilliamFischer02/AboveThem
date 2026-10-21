//! Tauri commands exposed to the frontend. Keep thin; logic lives in the modules.

use serde::{Deserialize, Serialize};

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
    crate::capture::list_windows()
        .into_iter()
        .map(|(hwnd, title)| CaptureTarget { hwnd, title })
        .collect()
}

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
