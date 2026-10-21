//! Chat reader (Phase 3 core): the open chat panel → messages {sender, text, mine}.
//!
//! Layout (lobby and meeting): white bubbles inside the chat panel; each bubble has
//! the sender's name on its first line and the message on the lines below. Other
//! players' bubbles are left-aligned (icon on the left), mine are right-aligned.
//! System lines ("X has voted. N remaining.") are green text without a bubble.
//!
//! Strategy: OCR the panel at 2×, then group lines top→bottom: a line that fuzzy-
//! matches a known name (or looks like a name when no roster is known) starts a
//! message; following lines within the same bubble (close vertically, same side)
//! are its text. Dedupe is the watcher's job (it keeps a window of recent keys).

use crate::capture::{crop_bgra, upscale_bgra, Frame};
use crate::ocr::{fuzzy_best, ocr_bgra, OcrLine};
use crate::regions::{Rect, Regions, REF_W};
use crate::roster::{body_color_in, color_name};

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ChatMsg {
    pub sender: String,
    pub text: String,
    /// Right-aligned bubble = my own message.
    pub mine: bool,
    /// "X has voted. N remaining." style system line.
    pub system: bool,
    /// Frame y of the name line (for ordering / dedupe hints).
    pub y: u32,
    /// Colour of the crewmate icon beside the bubble ("unknown" when unreadable).
    pub color: String,
}

fn is_system(text: &str) -> bool {
    let l = text.to_lowercase();
    l.contains("has voted") || l.contains("remaining") || l.contains("left the game") || l.contains("joined the game")
}

fn looks_like_name(text: &str, known: &[String]) -> Option<(String, f32)> {
    let t = text.trim();
    if t.is_empty() || t.chars().count() > 20 { return None; }
    if !known.is_empty() {
        if let Some((n, score)) = fuzzy_best(t, known.iter().map(String::as_str)) {
            if score >= 0.7 { return Some((n.to_string(), score)); }
        }
        return None;
    }
    // No roster yet: a short single token with mostly letters/digits.
    let alnum = t.chars().filter(|c| c.is_alphanumeric()).count();
    if t.split_whitespace().count() <= 2 && alnum * 10 >= t.chars().count() * 7 && !is_system(t) { Some((t.to_string(), 0.5)) } else { None }
}

pub fn read_chat(f: &Frame, known: &[String]) -> anyhow::Result<Vec<ChatMsg>> {
    let reg = Regions::default().for_frame(f.width, f.height);
    let r = reg.chat_panel;
    let (c, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
    let res = ocr_bgra(&u, uw, uh, None)?;
    // Back to frame coordinates, sorted top→bottom.
    let sx = f.width as f32 / REF_W as f32;
    // Drop what isn't bubble text: vote-grid names bleeding through the translucent panel (small),
    // and glyph-like junk from the crewmate icons in the left (x<~500) and right (x>~1340) icon columns.
    let min_h = (23.0 * sx) as u32;
    let left_text = r.x + (150.0 * sx) as u32;
    let right_icon = r.x + (995.0 * sx) as u32;
    let mut lines: Vec<OcrLine> = res.lines.into_iter()
        .map(|l| OcrLine { text: l.text, x: r.x + l.x / 2, y: r.y + l.y / 2, w: l.w / 2, h: l.h / 2 })
        .filter(|l| l.h >= min_h && l.x >= left_text && l.x < right_icon && l.text.trim().chars().count() >= 1)
        .collect();
    lines.sort_by_key(|l| l.y);
    let line_gap = (48.0 * sx) as u32; // max vertical gap between lines of one bubble

    let mut out: Vec<ChatMsg> = Vec::new();
    let mut cur: Option<ChatMsg> = None;
    let mut last_y = 0u32;
    for l in lines {
        let t = l.text.trim().to_string();
        if t.is_empty() { continue; }
        if is_system(&t) {
            if let Some(m) = cur.take() { out.push(m); }
            out.push(ChatMsg { sender: String::new(), text: t, mine: false, system: true, y: l.y, color: "unknown".into() });
            last_y = l.y;
            continue;
        }
        // Other players' bubbles sit against the icon column: every line starts at x≈515 (1080p).
        // My bubbles are right-aligned, so even wrapped lines start further right (≥ ~570).
        let right_aligned = l.x > r.x + (195.0 * sx) as u32;
        let starts_new = cur.is_none() || l.y.saturating_sub(last_y) > line_gap;
        if starts_new {
            if let Some(m) = cur.take() { if !m.text.is_empty() { out.push(m); } }
            let mine = right_aligned;
            // Icon sits left of a left bubble (x≈385–470) or right of a right bubble (x≈1350–1440), level with the name line.
            let icon = if mine { Rect::new(r.x + (1010.0 * sx) as u32, l.y.saturating_sub((5.0 * sx) as u32), (80.0 * sx) as u32, (80.0 * sx) as u32) }
                       else { Rect::new(r.x + (40.0 * sx) as u32, l.y.saturating_sub((5.0 * sx) as u32), (80.0 * sx) as u32, (80.0 * sx) as u32) };
            // body of that sprite (measured: SHUSH's blue at icon-local x 20..60, y 30..75); plain palette rendering
            let body = Rect::new(icon.x + (20.0 * sx) as u32, icon.y + (30.0 * sx) as u32, (40.0 * sx) as u32, (45.0 * sx) as u32);
            let color = color_name(body_color_in(f, body, false, false).0).to_string();
            // The first line of a bubble is the sender: snap to a known name when close, else keep it raw.
            let sender = match looks_like_name(&t, known) {
                Some((name, _)) => name,
                None => if t.chars().count() <= 20 { t.clone() } else { "?".into() },
            };
            let text = if sender == "?" { t.clone() } else { String::new() };
            cur = Some(ChatMsg { sender, text, mine, system: false, y: l.y, color });
        } else if let Some(m) = cur.as_mut() {
            // A name line right after a name line (no text yet) means the previous bubble was empty.
            if m.text.is_empty() {
                if let Some((name, score)) = looks_like_name(&t, known) { if score >= 0.85 && !known.is_empty() { m.sender = name; last_y = l.y; continue; } }
            }
            if !m.text.is_empty() { m.text.push(' '); }
            m.text.push_str(&t);
        }
        last_y = l.y;
    }
    if let Some(m) = cur.take() { if !m.text.is_empty() { out.push(m); } }
    Ok(out)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn load(name: &str) -> Frame {
        let path = format!("{}/fixtures/screens/1920x1080/{name}.png", env!("CARGO_MANIFEST_DIR"));
        let img = image::open(&path).expect("fixture png").to_rgba8();
        let (w, h) = img.dimensions();
        let mut bgra = img.into_raw();
        for px in bgra.chunks_exact_mut(4) { px.swap(0, 2); }
        Frame { width: w, height: h, bgra, t_wall_ms: 0, seq: 1 }
    }

    #[test]
    fn reads_the_lobby_chat() {
        let f = load("lobby_chat");
        let known = vec!["SHUSH".to_string(), "BigBingus".to_string(), "Bonsainew".to_string()];
        let msgs = read_chat(&f, &known).unwrap();
        let flat: Vec<String> = msgs.iter().map(|m| format!("{}{}: {}", if m.mine { "*" } else { "" }, m.sender, m.text)).collect();
        let shush = msgs.iter().find(|m| m.sender == "SHUSH").unwrap();
        assert_eq!(shush.color, "blue", "{:?}", msgs);
        let big = msgs.iter().find(|m| m.sender == "BigBingus").unwrap();
        assert_eq!(big.color, "maroon", "{:?}", msgs);
        assert!(flat.iter().any(|m| *m == "SHUSH: Hi"), "{flat:?}");
        assert!(flat.iter().any(|m| m.starts_with("*BigBingus: hell")), "{flat:?}"); // the crewmate icon overlaps the last letter
        assert!(flat.iter().any(|m| m.starts_with("SHUSH: How are u")), "{flat:?}");
        assert!(flat.iter().any(|m| m.starts_with("*BigBingus: doing goo")), "{flat:?}");
    }

    #[test]
    fn reads_the_meeting_chat() {
        let f = load("meeting_chat");
        let msgs = read_chat(&f, &[]).unwrap();
        assert!(msgs.len() >= 3, "{msgs:?}");
        assert!(msgs.iter().any(|m| m.text.to_lowercase().contains("vent")), "{msgs:?}");
    }
}

