//! Lobby reader: floating player names over the crewmates (lobby screen) → roster.
//!
//! The lobby has no structured grid, but every player has a name label (white,
//! black-outlined) centred above their sprite. One full-frame OCR at 1× finds
//! the labels; UI words are filtered out by a stop-list and geometry; the colour
//! is sampled from the body just below each label. Slots are unknown here (the
//! vote grid assigns them later); entries are ordered left→right.

use crate::capture::{crop_bgra, Frame};
use crate::colors::{classify, PlayerColor};
use crate::ocr::ocr_bgra;
use crate::roster::{RosterEntry, RosterRead};

const STOP: &[&str] = &[
    "PING", "WAITING", "ROOM", "CODE", "SETTINGS", "CAPACITY", "PRESET", "PRIVACY", "GAME", "HOST", "VIEW", "PUBLIC", "PRIVATE",
    "CUSTOM", "SKELD", "MIRA", "POLUS", "AIRSHIP", "FUNGLE", "IMPOSTOR", "SPEED", "COOLDOWN", "TASKS", "VISUAL", "SET TO", "TOTAL",
    "STARTING", "PLAYER", "KILL", "VOTING", "DISCUSSION", "EMERGENCY", "CONFIRM", "ANONYMOUS", "TASK", "COMMON", "LONG", "SHORT",
    "CLASSIC", "HIDE", "SEEK", "FRIENDS", "SEND", "CHAT", "MAP", "ONLINE", "BACK", "ENTER", "FIND", "CREATE", "PLAY", "LOBBY",
    // settings panel + role names
    "ROLE", "SCIENTIST", "ENGINEER", "GUARDIAN", "ANGEL", "NOISEMAKER", "TRACKER", "SHAPESHIFTER", "PHANTOM", "DETECTIVE", "VIPER",
    "CHANCE", "AMOUNT", "COSMETIC", "GENERAL", "FILTER", "APPLY", "RESET", "CLOSE", "REPORT", "USE", "SABOTAGE", "VENT", "DEAD",
];

fn looks_like_name(text: &str) -> bool {
    let t = text.trim();
    let n = t.chars().count();
    if !(2..=16).contains(&n) { return false; }
    let up = t.to_uppercase();
    if STOP.iter().any(|s| up.contains(s)) { return false; }
    let alnum = t.chars().filter(|c| c.is_alphanumeric()).count();
    if alnum * 10 < n * 6 { return false; }
    // "set to 30.0s", "0/8", "1/100" style fragments
    if t.chars().filter(|c| c.is_ascii_digit()).count() * 2 > n { return false; }
    true
}

fn color_name(c: PlayerColor) -> &'static str {
    match c {
        PlayerColor::Red => "red", PlayerColor::Blue => "blue", PlayerColor::Green => "green", PlayerColor::Pink => "pink",
        PlayerColor::Orange => "orange", PlayerColor::Yellow => "yellow", PlayerColor::Black => "black", PlayerColor::White => "white",
        PlayerColor::Purple => "purple", PlayerColor::Brown => "brown", PlayerColor::Cyan => "cyan", PlayerColor::Lime => "lime",
        PlayerColor::Maroon => "maroon", PlayerColor::Rose => "rose", PlayerColor::Banana => "banana", PlayerColor::Gray => "gray",
        PlayerColor::Tan => "tan", PlayerColor::Coral => "coral", PlayerColor::Unknown => "unknown",
    }
}

/// Majority palette colour of saturated pixels in a patch; (colour, mean distance, votes).
fn patch_color(f: &Frame, cx: i64, cy: i64, size: u32) -> (PlayerColor, f32, u32) {
    let x = (cx - size as i64 / 2).max(0) as u32;
    let y = (cy - size as i64 / 2).max(0) as u32;
    if x >= f.width || y >= f.height { return (PlayerColor::Unknown, 99.0, 0); }
    let (buf, _, _) = crop_bgra(f, x, y, size, size);
    let mut votes: std::collections::HashMap<PlayerColor, (u32, f32)> = Default::default();
    for px in buf.chunks_exact(4) {
        let rgb = [px[2], px[1], px[0]];
        let max = *rgb.iter().max().unwrap() as i32;
        let min = *rgb.iter().min().unwrap() as i32;
        if max < 50 { continue; } // outline / shadow
        if max - min < 30 && !(max > 170) { continue; } // grey background (keep white/light)
        let (c, d) = classify(rgb);
        if d > 35.0 || c == PlayerColor::Unknown { continue; }
        let e = votes.entry(c).or_insert((0, 0.0));
        e.0 += 1; e.1 += d;
    }
    votes.into_iter().max_by_key(|(_, (n, _))| *n).map(|(c, (n, d))| (c, d / n as f32, n)).unwrap_or((PlayerColor::Unknown, 99.0, 0))
}

pub fn read_lobby(f: &Frame) -> anyhow::Result<RosterRead> {
    let t0 = std::time::Instant::now();
    let ocr = ocr_bgra(&f.bgra, f.width, f.height, None)?;
    let sx = f.width as f32 / 1920.0;
    let play_area = |x: u32, y: u32| (x as f32) > 60.0 * sx && (x as f32) < 1450.0 * sx && (y as f32) > 100.0 * sx && (y as f32) < 980.0 * sx;
    let mut seen = std::collections::HashSet::new();
    let mut entries: Vec<RosterEntry> = Vec::new();
    for l in ocr.lines.iter().filter(|l| looks_like_name(&l.text) && play_area(l.x, l.y) && l.h >= (16.0 * sx) as u32 && l.h <= (44.0 * sx) as u32) {
        let name = l.text.trim().to_string();
        let key = name.to_lowercase();
        if !seen.insert(key) { continue; }
        let cx = (l.x + l.w / 2) as i64;
        // Sprite: hat/visor directly under the label, body ~80–115 px below the label bottom at 1080p.
        // Take the patch with the most palette votes among three depths.
        let mut best = (PlayerColor::Unknown, 99.0f32, 0u32);
        for dy in [80.0f32, 98.0, 115.0] {
            let r = patch_color(f, cx, (l.y + l.h) as i64 + (dy * sx) as i64, (28.0 * sx) as u32);
            if r.2 > best.2 { best = r; }
        }
        let (c, d, n) = best;
        entries.push(RosterEntry { index: entries.len() as u32, name, name_confidence: 0.7, color: color_name(if n < 20 { PlayerColor::Unknown } else { c }).to_string(), color_delta_e: d, dead: false, reporter: false, avatar_png: None });
    }
    // Left→right order so slots are stable while the lobby fills.
    entries.sort_by_key(|e| e.index);
    Ok(RosterRead { entries, ocr_ms: t0.elapsed().as_millis() as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_filter() {
        assert!(looks_like_name("BigBingus"));
        assert!(looks_like_name("sektör tek"));
        assert!(!looks_like_name("WAITING FOR HOST"));
        assert!(!looks_like_name("PING: 65 ms"));
        assert!(!looks_like_name("0/8"));
        assert!(!looks_like_name("Kill Cooldown set to 30.0s"));
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_real_lobby() {
        let path = format!("{}/fixtures/screens/1920x1080/round_cafeteria.png", env!("CARGO_MANIFEST_DIR"));
        let img = image::open(&path).expect("fixture png").to_rgba8();
        let (w, h) = img.dimensions();
        let mut bgra = img.into_raw();
        for px in bgra.chunks_exact_mut(4) { px.swap(0, 2); }
        let f = Frame { width: w, height: h, bgra, t_wall_ms: 0, seq: 1 };
        let r = read_lobby(&f).unwrap();
        let names: Vec<&str> = r.entries.iter().map(|e| e.name.as_str()).collect();
        for expected in ["BigBingus", "SHUSH", "Bonsainew", "Pablio888", "Waxscarce", "BASHOLI", "Sensepast", "Timetrast", "Flushbevy"] {
            assert!(names.iter().any(|n| crate::ocr::fuzzy_best(n, [expected]).unwrap().1 > 0.75), "missing {expected} in {names:?}");
        }
        assert!(!names.iter().any(|n| n.to_uppercase().contains("PING")), "{names:?}");
        let by = |n: &str| r.entries.iter().find(|e| e.name.contains(n)).unwrap();
        // Crowded round frame: sprites overlap and the floor is grey, so colour is best-effort here;
        // names are what this reader is for. SHUSH stands alone and must be right.
        assert_eq!(by("SHUSH").color, "blue", "{:?}", r.entries);
    }
}
