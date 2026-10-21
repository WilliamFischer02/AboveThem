//! Screen capture of the Among Us window.
//!
//! Phase 2: implement with Windows Graphics Capture (windows crate: Graphics::Capture)
//! or the `windows-capture` crate. Emit BGRA frames downscaled to 1920x1080-normalised
//! space at 4 fps idle / 15 fps during meetings.

/// Enumerate top-level windows (hwnd, title). Used by the Settings → Capture target picker.
pub fn list_windows() -> Vec<(u64, String)> {
    #[cfg(windows)]
    {
        // UNVERIFIED: implement with EnumWindows + GetWindowTextW in Phase 2.
        Vec::new()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// A captured frame in BGRA, already normalised to the reference resolution.
#[derive(Clone, Debug)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub t_wall_ms: u64,
}

pub fn find_among_us() -> Option<u64> {
    list_windows()
        .into_iter()
        .find(|(_, t)| t == "Among Us")
        .map(|(h, _)| h)
}
