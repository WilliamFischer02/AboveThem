//! OCR over cropped ROIs using Windows.Media.Ocr (WinRT).
//!
//! Input is a BGRA buffer (from `capture.rs`, already cropped and usually
//! upscaled 2×). Output is lines with bounding boxes in the *input* pixel space;
//! callers map back to frame space. Measured on William's 1920×1080 frames:
//! 35–60 ms per ROI, names/room code/role card read cleanly, stylised task
//! text needs fuzzy matching against the map's task names.

#[derive(Clone, Debug, serde::Serialize)]
pub struct OcrLine {
    pub text: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct OcrResult {
    pub lines: Vec<OcrLine>,
    pub lang: Option<String>,
}

/// Installed OCR languages (BCP-47 tags). Non-Latin chat needs its pack installed in Windows.
pub fn available_languages() -> Vec<String> {
    #[cfg(windows)]
    {
        init_winrt();
        use windows::Media::Ocr::OcrEngine;
        OcrEngine::AvailableRecognizerLanguages()
            .ok()
            .map(|v| v.into_iter().filter_map(|l| l.LanguageTag().ok().map(|t| t.to_string())).collect())
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn init_winrt() {
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    // Idempotent per thread; an "already initialised" error is fine.
    unsafe { let _ = RoInitialize(RO_INIT_MULTITHREADED); }
}

/// One OCR at a time. The WinRT engine returned empty results when three test threads
/// recognised concurrently; serialising costs nothing at our frame rates.
static OCR_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn ocr_bgra(bgra: &[u8], width: u32, height: u32, lang_hint: Option<&str>) -> anyhow::Result<OcrResult> {
    #[cfg(windows)]
    {
        let _guard = OCR_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        use windows::core::HSTRING;
        use windows::Globalization::Language;
        use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
        use windows::Media::Ocr::OcrEngine;
        use windows::Storage::Streams::DataWriter;

        init_winrt();
        anyhow::ensure!(bgra.len() == (width * height * 4) as usize, "buffer size mismatch");
        let max = OcrEngine::MaxImageDimension().unwrap_or(2600);
        anyhow::ensure!(width <= max && height <= max, "image too large for OCR ({width}x{height} > {max})");

        let writer = DataWriter::new()?;
        writer.WriteBytes(bgra)?;
        let buffer = writer.DetachBuffer()?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width as i32, height as i32, BitmapAlphaMode::Ignore)?;

        let engine = match lang_hint {
            Some(tag) => OcrEngine::TryCreateFromLanguage(&Language::CreateLanguage(&HSTRING::from(tag))?)?,
            None => OcrEngine::TryCreateFromUserProfileLanguages()?,
        };
        let lang = engine.RecognizerLanguage().and_then(|l| l.LanguageTag()).ok().map(|t| t.to_string());
        let result = engine.RecognizeAsync(&bitmap)?.join()?;

        let mut lines = Vec::new();
        for line in result.Lines()? {
            let text = line.Text()?.to_string();
            let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, 0f32, 0f32);
            for word in line.Words()? {
                let r = word.BoundingRect()?;
                x0 = x0.min(r.X); y0 = y0.min(r.Y);
                x1 = x1.max(r.X + r.Width); y1 = y1.max(r.Y + r.Height);
            }
            if x0 == f32::MAX { continue; }
            lines.push(OcrLine { text, x: x0.max(0.0) as u32, y: y0.max(0.0) as u32, w: (x1 - x0).max(0.0) as u32, h: (y1 - y0).max(0.0) as u32 });
        }
        Ok(OcrResult { lines, lang })
    }
    #[cfg(not(windows))]
    {
        let _ = (bgra, width, height, lang_hint);
        anyhow::bail!("ocr is windows-only")
    }
}

/// Case-insensitive fuzzy match of an OCR'd string against a vocabulary (room/task/player names).
/// Returns (best, score 0..1); score = 1 - normalised Levenshtein distance.
pub fn fuzzy_best<'a>(text: &str, vocab: impl IntoIterator<Item = &'a str>) -> Option<(&'a str, f32)> {
    let t = normalise(text);
    let mut best: Option<(&str, f32)> = None;
    for v in vocab {
        let n = normalise(v);
        let d = levenshtein(&t, &n) as f32;
        let score = 1.0 - d / t.len().max(n.len()).max(1) as f32;
        if best.map(|b| score > b.1).unwrap_or(true) { best = Some((v, score)); }
    }
    best
}

fn normalise(s: &str) -> Vec<char> {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_recovers_ocr_garbage_from_real_frames() {
        let tasks = ["Fix Wiring", "Empty Garbage", "Divert Power", "Download Data", "Swipe Card", "Clear Asteroids"];
        assert_eq!(fuzzy_best("FikWirihg", tasks).unwrap().0, "Fix Wiring");
        assert_eq!(fuzzy_best("DivertJPoweMo", tasks).unwrap().0, "Divert Power");
        let maps = ["The Skeld", "MIRA HQ", "Polus", "The Airship", "The Fungle"];
        assert_eq!(fuzzy_best("*THE SkßLL)", maps).unwrap().0, "The Skeld");
        let names = ["SHUSH", "BigDingus", "Bonsainew", "Pablio888", "Waxscarce"];
        assert_eq!(fuzzy_best("BigBingus", names).unwrap().0, "BigDingus");
    }

    #[test]
    fn fuzzy_score_is_low_for_unrelated_text() {
        let (_, score) = fuzzy_best("PING: 65 ms", ["Electrical", "MedBay"]).unwrap();
        assert!(score < 0.5);
    }

    #[cfg(windows)]
    #[test]
    fn winrt_ocr_reads_synthetic_text_or_reports_no_engine() {
        // Smoke test: a blank white image must not panic and yields zero lines.
        let (w, h) = (200u32, 60u32);
        let bgra = vec![255u8; (w * h * 4) as usize];
        let r = ocr_bgra(&bgra, w, h, None).expect("ocr call");
        assert!(r.lines.is_empty());
        assert!(!available_languages().is_empty());
    }
}
