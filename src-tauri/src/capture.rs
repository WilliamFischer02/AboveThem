//! Screen capture of the Among Us window.
//!
//! Windows Graphics Capture via the `windows-capture` crate (ADR-006). A capture
//! session runs on its own thread and keeps only the *latest* BGRA frame in
//! `Latest`; consumers (OCR, calibration preview, phase detection) pull from it.
//! Frames are throttled to `min_interval_ms` (idle 4 fps; meetings burst to 15).

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// A captured frame in BGRA (4 bytes per pixel, no row padding), native size.
#[derive(Clone, Debug)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub t_wall_ms: u64,
    pub seq: u64,
}

pub type Latest = Arc<Mutex<Option<Frame>>>;

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct CaptureStatus {
    pub running: bool,
    pub title: Option<String>,
    pub width: u32,
    pub height: u32,
    pub seq: u64,
    pub age_ms: u64,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Enumerate top-level windows (hwnd, title). Used by the Settings → Capture target picker.
pub fn list_windows() -> Vec<(u64, String)> {
    #[cfg(windows)]
    {
        use windows_capture::window::Window;
        Window::enumerate()
            .map(|ws| ws.into_iter().filter_map(|w| w.title().ok().filter(|t| !t.is_empty()).map(|t| (w.as_raw_hwnd() as u64, t))).collect())
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

pub fn find_among_us() -> Option<u64> {
    list_windows().into_iter().find(|(_, t)| t == "Among Us").map(|(h, _)| h)
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub mod win {
    use super::{now_ms, Frame, Latest};
    use std::time::{Duration, Instant};
    use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame as WcFrame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings,
        SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    pub type HandlerError = Box<dyn std::error::Error + Send + Sync>;

    pub struct Handler {
        latest: Latest,
        buf: Vec<u8>,
        last: Instant,
        min: Duration,
        seq: u64,
    }

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = (Latest, u64);
        type Error = HandlerError;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self {
                latest: ctx.flags.0,
                buf: Vec::new(),
                last: Instant::now() - Duration::from_secs(10),
                min: Duration::from_millis(ctx.flags.1),
                seq: 0,
            })
        }

        fn on_frame_arrived(&mut self, frame: &mut WcFrame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
            if self.last.elapsed() < self.min { return Ok(()); }
            self.last = Instant::now();
            let fb = frame.buffer()?;
            let (width, height) = (fb.width(), fb.height());
            let data = fb.as_nopadding_buffer(&mut self.buf).to_vec();
            self.seq += 1;
            *self.latest.lock().unwrap_or_else(|e| e.into_inner()) = Some(Frame { width, height, bgra: data, t_wall_ms: now_ms(), seq: self.seq });
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    pub struct Session {
        control: CaptureControl<Handler, HandlerError>,
        pub title: String,
    }

    impl Session {
        pub fn stop(self) {
            let _ = self.control.stop();
        }
        pub fn is_finished(&self) -> bool {
            self.control.is_finished()
        }
    }

    /// Start capturing the first window whose title contains `title_contains`.
    pub fn start(title_contains: &str, latest: Latest, min_interval_ms: u64) -> Result<Session, String> {
        // The game's window is titled exactly "Among Us"; a browser tab or Discord window that merely contains
        // the words must not win (from_contains_name takes the first match in Z-order).
        let exact = Window::enumerate().ok().and_then(|ws| ws.into_iter().find(|w| w.title().map(|t| t == title_contains).unwrap_or(false)));
        let window = match exact {
            Some(w) => w,
            None => Window::from_contains_name(title_contains).map_err(|e| format!("window '{title_contains}' not found: {e}"))?,
        };
        let title = window.title().unwrap_or_else(|_| title_contains.to_string());
        // UNVERIFIED: reusing the found handle (was a second lookup + expect(), which panicked if the window closed in between).
        let make = |border: DrawBorderSettings| {
            Settings::new(
                window,
                CursorCaptureSettings::WithoutCursor,
                border,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                (latest.clone(), min_interval_ms),
            )
        };
        // UNVERIFIED: WithoutBorder needs a recent Windows build; fall back to the default (yellow border) if refused.
        let control = match Handler::start_free_threaded(make(DrawBorderSettings::WithoutBorder)) {
            Ok(c) => c,
            Err(_) => Handler::start_free_threaded(make(DrawBorderSettings::Default)).map_err(|e| format!("capture start failed: {e}"))?,
        };
        Ok(Session { control, title })
    }
}

/// Tauri-managed capture state.
pub struct CaptureState {
    pub latest: Latest,
    #[cfg(windows)]
    pub session: Mutex<Option<win::Session>>,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            latest: Arc::new(Mutex::new(None)),
            #[cfg(windows)]
            session: Mutex::new(None),
        }
    }
}

impl CaptureState {
    pub fn status(&self) -> CaptureStatus {
        let latest = self.latest.lock().unwrap_or_else(|e| e.into_inner());
        let (width, height, seq, age_ms) = latest.as_ref().map(|f| (f.width, f.height, f.seq, now_ms().saturating_sub(f.t_wall_ms))).unwrap_or((0, 0, 0, 0));
        #[cfg(windows)]
        let (running, title) = {
            let s = self.session.lock().unwrap_or_else(|e| e.into_inner());
            (s.as_ref().map(|s| !s.is_finished()).unwrap_or(false), s.as_ref().map(|s| s.title.clone()))
        };
        #[cfg(not(windows))]
        let (running, title) = (false, None);
        CaptureStatus { running, title, width, height, seq, age_ms }
    }

    pub fn start(&self, title_contains: &str, min_interval_ms: u64) -> Result<CaptureStatus, String> {
        #[cfg(windows)]
        {
            let mut s = self.session.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(old) = s.take() { old.stop(); }
            *self.latest.lock().unwrap_or_else(|e| e.into_inner()) = None;
            *s = Some(win::start(title_contains, self.latest.clone(), min_interval_ms)?);
            drop(s);
            Ok(self.status())
        }
        #[cfg(not(windows))]
        {
            let _ = (title_contains, min_interval_ms);
            Err("capture is windows-only".into())
        }
    }

    pub fn stop(&self) {
        #[cfg(windows)]
        {
            if let Some(old) = self.session.lock().unwrap_or_else(|e| e.into_inner()).take() { old.stop(); }
        }
    }

    pub fn latest_frame(&self) -> Option<Frame> {
        self.latest.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// Crop a BGRA frame region (clamped to the frame). Returns (bgra, w, h).
pub fn crop_bgra(f: &Frame, x: u32, y: u32, w: u32, h: u32) -> (Vec<u8>, u32, u32) {
    let x = x.min(f.width.saturating_sub(1));
    let y = y.min(f.height.saturating_sub(1));
    let w = w.min(f.width - x).max(1);
    let h = h.min(f.height - y).max(1);
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in y..y + h {
        let start = ((row * f.width + x) * 4) as usize;
        out.extend_from_slice(&f.bgra[start..start + (w * 4) as usize]);
    }
    (out, w, h)
}

/// Bilinear upscale of a BGRA buffer by an integer factor (OCR likes ≥ 2× on small UI text).
pub fn upscale_bgra(src: &[u8], w: u32, h: u32, factor: u32) -> (Vec<u8>, u32, u32) {
    if factor <= 1 { return (src.to_vec(), w, h); }
    let (nw, nh) = (w * factor, h * factor);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    let px = |x: u32, y: u32, c: usize| src[((y * w + x) * 4) as usize + c] as f32;
    for ny in 0..nh {
        let fy = (ny as f32 + 0.5) / factor as f32 - 0.5;
        let y0 = fy.floor().max(0.0) as u32;
        let y1 = (y0 + 1).min(h - 1);
        let ty = (fy - y0 as f32).clamp(0.0, 1.0);
        for nx in 0..nw {
            let fx = (nx as f32 + 0.5) / factor as f32 - 0.5;
            let x0 = fx.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(w - 1);
            let tx = (fx - x0 as f32).clamp(0.0, 1.0);
            let o = ((ny * nw + nx) * 4) as usize;
            for c in 0..4 {
                let v = px(x0, y0, c) * (1.0 - tx) * (1.0 - ty) + px(x1, y0, c) * tx * (1.0 - ty) + px(x0, y1, c) * (1.0 - tx) * ty + px(x1, y1, c) * tx * ty;
                out[o + c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    (out, nw, nh)
}

/// Downscale (box filter, integer step) for previews.
pub fn downscale_bgra(src: &[u8], w: u32, h: u32, max_width: u32) -> (Vec<u8>, u32, u32) {
    if w <= max_width { return (src.to_vec(), w, h); }
    let step = (w + max_width - 1) / max_width;
    let (nw, nh) = (w / step, h / step);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for ny in 0..nh {
        for nx in 0..nw {
            let mut acc = [0u32; 4];
            for dy in 0..step { for dx in 0..step {
                let i = (((ny * step + dy) * w + nx * step + dx) * 4) as usize;
                for c in 0..4 { acc[c] += src[i + c] as u32; }
            } }
            let o = ((ny * nw + nx) * 4) as usize;
            for c in 0..4 { out[o + c] = (acc[c] / (step * step)) as u8; }
        }
    }
    (out, nw, nh)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: u32, h: u32) -> Frame {
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        for y in 0..h { for x in 0..w { let i = ((y * w + x) * 4) as usize; bgra[i] = x as u8; bgra[i + 1] = y as u8; bgra[i + 3] = 255; } }
        Frame { width: w, height: h, bgra, t_wall_ms: 0, seq: 1 }
    }

    #[test]
    fn crop_is_clamped_and_row_correct() {
        let f = frame(16, 8);
        let (c, w, h) = crop_bgra(&f, 10, 6, 100, 100);
        assert_eq!((w, h), (6, 2));
        assert_eq!(c[0], 10); // x of first pixel
        assert_eq!(c[1], 6);  // y of first pixel
    }

    #[test]
    fn upscale_doubles_and_keeps_corners() {
        let f = frame(4, 4);
        let (u, w, h) = upscale_bgra(&f.bgra, 4, 4, 2);
        assert_eq!((w, h), (8, 8));
        assert_eq!(u.len(), 8 * 8 * 4);
        assert_eq!(u[0], 0);
        assert_eq!(u[((7 * 8 + 7) * 4) as usize], 3);
    }

    #[test]
    fn downscale_hits_max_width() {
        let f = frame(64, 32);
        let (d, w, h) = downscale_bgra(&f.bgra, 64, 32, 16);
        assert_eq!((w, h), (16, 8));
        assert_eq!(d.len(), 16 * 8 * 4);
    }
}
