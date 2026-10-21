//! OCR over cropped ROIs using Windows.Media.Ocr (WinRT). Phase 2.
//!
//! Pre-process: 2x upscale, grayscale, per-ROI polarity threshold.
//! Return lines with bounding boxes so the chat parser can split sender/text and
//! the color sampler can find the swatch left of each name.

#[derive(Clone, Debug)]
pub struct OcrLine {
    pub text: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Debug, Default)]
pub struct OcrResult {
    pub lines: Vec<OcrLine>,
    pub lang: Option<String>,
}

pub fn ocr_bgra(_bgra: &[u8], _width: u32, _height: u32, _lang_hint: Option<&str>) -> anyhow::Result<OcrResult> {
    #[cfg(windows)]
    {
        // UNVERIFIED: Phase 2 — SoftwareBitmap::CreateCopyFromBuffer + OcrEngine::TryCreateFromLanguage
        // + RecognizeAsync. Fallback to OcrEngine::TryCreateFromUserProfileLanguages.
        anyhow::bail!("ocr not implemented yet")
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("ocr is windows-only")
    }
}
