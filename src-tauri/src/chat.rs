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
use crate::regions::{Regions, REF_W};

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
    let mut lines: Vec<OcrLine> = res.lines.into_iter().map(|l| OcrLine { text: l.text, x: r.x + l.x / 2, y: r.y + l.y / 2, w: l.w / 2, h: l.h / 2 }).collect();
    lines.sort_by_key(|l| l.y);
    let sx = f.width as f32 / REF_W as f32;
    let mid = (r.x as f32 + r.w as f32 * 0.5) as u32;
    let line_gap = (48.0 * sx) as u32; // max vertical gap between lines of one bubble

    let mut out: Vec<ChatMsg> = Vec::new();
    let mut cur: Option<ChatMsg> = None;
    let mut last_y = 0u32;
    for l in lines {
        let t = l.text.trim().to_string();
        if t.is_empty() { continue; }
        if is_system(&t) {
            if let Some(m) = cur.take() { out.push(m); }
            out.push(ChatMsg { sender: String::new(), text: t, mine: false, system: true, y: l.y });
            last_y = l.y;
            continue;
        }
        let mine = l.x + l.w / 2 > mid + (120.0 * sx) as u32; // right-aligned bubble
        let starts_new = cur.is_none() || l.y.saturating_sub(last_y) > line_gap || cur.as_ref().map(|m| m.mine != mine).unwrap_or(true);
        if starts_new {
            if let Some(m) = cur.take() { if !m.text.is_empty() { out.push(m); } }
            match looks_like_name(&t, known) {
                Some((name, _)) => cur = Some(ChatMsg { sender: name, text: String::new(), mine, system: false, y: l.y }),
                None => cur = Some(ChatMsg { sender: "?".into(), text: t.clone(), mine, system: false, y: l.y }),
            }
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
        assert!(flat.iter().any(|m| m.starts_with("SHUSH: Hi")), "{flat:?}");
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
