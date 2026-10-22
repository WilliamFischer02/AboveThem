//! Chat reader (Phase 3 core): the open chat panel → messages {sender, text, mine}.
//!
//! Layout (lobby and meeting): white bubbles inside the chat panel; each bubble has
//! the sender's name on its first line and the message on the lines below. Other
//! players' bubbles are left-aligned (icon on the left), mine are right-aligned.
//! System lines ("X has voted. N remaining.") are green text without a bubble.
//!
//! Strategy (session 5): find the white bubbles from their pixels first (geometry does not
//! depend on OCR), then OCR the panel at 2× and drop each line into its bubble. The line in
//! the top ~40 px of a bubble is the sender, the rest is the message. A bubble whose message
//! OCR could not read (other script, e.g. Cyrillic with only the en-US OCR pack installed) is
//! still reported, flagged `unreadable`, instead of silently vanishing. When more than one
//! OCR language is installed, a bubble that reads as garbage is re-OCR'd with the others and
//! the most plausible text wins (`textscore::plausibility`); the winner per sender is cached.
//! Without bubbles (unknown layout / resolution), the old line-gap grouping is used.
//! Dedupe is the watcher's job (it keeps a window of recent keys).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::capture::{crop_bgra, upscale_bgra, Frame};
use crate::ocr::{available_languages, fuzzy_best, ocr_bgra, OcrLine};
use crate::regions::{dhash, Rect, Regions, REF_H, REF_W};
use crate::roster::{body_color_in, color_name};
use crate::textscore::{cyrillic_from_lookalike, looks_like_cyrillic_misread, plausibility};

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
    /// The bubble is there but its text could not be read (empty, or garbage in every installed OCR language).
    #[serde(default)]
    pub unreadable: bool,
    /// OCR language whose reading won ("en-US", "ru"…); None for the default engine / legacy path.
    pub ocr_lang: Option<String>,
    /// `textscore::plausibility` of the text (0..1).
    pub plausibility: f32,
    /// "cyrillic" when the text looks like Cyrillic read by a Latin-only OCR engine.
    pub script_hint: Option<String>,
    /// With `script_hint == "cyrillic"`: the look-alike letters mapped back to Cyrillic. A guess for the translator only.
    pub cyrillic_guess: Option<String>,
    /// Pixel hash of the bubble (dedupe of unreadable bubbles, which have no text to compare).
    #[serde(skip)]
    pub bubble_hash: u64,
}

impl ChatMsg {
    fn new(sender: String, text: String, mine: bool, system: bool, y: u32, color: String) -> Self {
        Self { sender, text, mine, system, y, color, unreadable: false, ocr_lang: None, plausibility: 1.0, script_hint: None, cyrillic_guess: None, bubble_hash: 0 }
    }
}

/// Why something visible in the chat panel did not become a message (NDJSON diagnostics).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ChatDrop {
    pub why: &'static str,
    pub y: u32,
    pub text: String,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct ChatRead {
    pub msgs: Vec<ChatMsg>,
    pub drops: Vec<ChatDrop>,
    /// Bubbles found from pixels (0 ⇒ legacy grouping was used).
    pub bubbles: usize,
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

/// A white chat bubble in frame pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bubble {
    pub x0: u32,
    pub x1: u32,
    pub y0: u32,
    pub y1: u32,
    /// Starts at the panel's top edge: scrolled partly out of view (its name line may be gone).
    pub cut_top: bool,
    pub mine: bool,
}

fn is_white(f: &Frame, x: u32, y: u32) -> bool {
    let i = ((y * f.width + x) * 4) as usize;
    f.bgra[i] >= 215 && f.bgra[i + 1] >= 215 && f.bgra[i + 2] >= 215
}

/// White bubbles inside the chat panel `r`, top→bottom. Measured on `lobby_chat` / `meeting_chat`:
/// bubbles are pure white, ≈ 112 px tall with a name and one text line, ≥ 35 px apart; others'
/// bubbles start at x≈360, mine at x≈478 (1080p).
pub fn find_bubbles(f: &Frame, r: Rect) -> Vec<Bubble> {
    let sx = f.width as f32 / REF_W as f32;
    let sy = f.height as f32 / REF_H as f32;
    let x1r = (r.x + r.w).min(f.width);
    let y1r = (r.y + r.h).min(f.height);
    if r.x >= x1r || r.y >= y1r { return Vec::new(); }
    // The band every bubble covers (others' and mine overlap here), clear of the icons.
    let bx0 = (r.x + (355.0 * sx) as u32).min(x1r);
    let bx1 = (r.x + (755.0 * sx) as u32).min(x1r);
    if bx1 <= bx0 { return Vec::new(); }
    let white_row = |y: u32| -> bool {
        let (mut n, mut w) = (0u32, 0u32);
        let mut x = bx0;
        while x < bx1 { n += 1; if is_white(f, x, y) { w += 1; } x += 3; }
        n > 0 && w * 100 >= n * 35
    };
    let rows: Vec<bool> = (r.y..y1r).map(white_row).collect();
    // Runs of white rows; gaps up to 12 px (dense text rows) are closed.
    let max_gap = (12.0 * sy).max(2.0) as usize;
    let min_h = (30.0 * sy).max(4.0) as u32;
    let mut runs: Vec<(u32, u32)> = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        if !rows[i] { i += 1; continue; }
        let start = i;
        let mut end = i;
        let mut j = i;
        while j < rows.len() {
            if rows[j] { end = j; j += 1; continue; }
            let gap_end = (j..rows.len().min(j + max_gap + 1)).find(|k| rows[*k]);
            match gap_end { Some(k) => j = k, None => break }
        }
        runs.push((r.y + start as u32, r.y + end as u32 + 1));
        i = end + 1;
    }
    let mut out = Vec::new();
    for (y0, y1) in runs {
        if y1 - y0 < min_h { continue; }
        // Horizontal extent: the longest white run on the whitest row of the bubble.
        let mut best: (u32, u32) = (0, 0);
        for y in (y0..y1).step_by(((y1 - y0) / 8).max(1) as usize) {
            let (mut run_start, mut x) = (None::<u32>, r.x);
            while x < x1r {
                let w = is_white(f, x, y);
                match (w, run_start) {
                    (true, None) => run_start = Some(x),
                    (false, Some(s)) => { if x - s > best.1.saturating_sub(best.0) { best = (s, x); } run_start = None; }
                    _ => {}
                }
                x += 1;
            }
            if let Some(s) = run_start { if x1r - s > best.1.saturating_sub(best.0) { best = (s, x1r); } }
        }
        if best.1 <= best.0 || best.1 - best.0 < (400.0 * sx) as u32 { continue; } // not a bubble-wide white area
        out.push(Bubble { x0: best.0, x1: best.1, y0, y1, cut_top: y0 <= r.y + 1, mine: best.0 > r.x + (75.0 * sx) as u32 });
    }
    out
}

/// Geometry constants (1080p) the assembler needs, scaled to the frame.
#[derive(Clone, Copy, Debug)]
pub struct ChatGeom {
    pub panel: Rect,
    /// Text lines start right of this x (icon column on the left).
    pub left_text: u32,
    /// Text lines start left of this x (icon column on the right).
    pub right_icon: u32,
    /// Minimum line height outside bubbles (legacy) / inside bubbles.
    pub min_h_loose: u32,
    pub min_h_bubble: u32,
    /// Max vertical gap between lines of one bubble (legacy grouping).
    pub line_gap: u32,
    /// Lines whose top is within this many px of the bubble top are the name line.
    pub name_zone: u32,
    /// "Mine" threshold for the legacy path.
    pub right_aligned_x: u32,
}

impl ChatGeom {
    pub fn for_frame(w: u32, h: u32) -> Self {
        let reg = Regions::default().for_frame(w, h);
        let r = reg.chat_panel;
        let sx = w as f32 / REF_W as f32;
        let sy = h as f32 / REF_H as f32;
        Self {
            panel: r,
            left_text: r.x + (150.0 * sx) as u32,
            right_icon: r.x + (995.0 * sx) as u32,
            min_h_loose: (23.0 * sy) as u32,
            // Lower-case Cyrillic is mostly x-height only ("кто", "нет", "все"): ≈ 19 px at 1080p.
            min_h_bubble: (10.0 * sy) as u32,
            line_gap: (48.0 * sy) as u32,
            name_zone: (40.0 * sy) as u32,
            right_aligned_x: r.x + (195.0 * sx) as u32,
        }
    }
}

/// Lines (frame coords) → messages. Pure: no OCR, no pixels (testable anywhere).
/// Bubble-less frames use the legacy line-gap grouping. Returns (messages, drops); messages carry
/// only geometry/text — colour, hash and alternative OCR languages are filled in by `read_chat`.
pub fn assemble(lines: &[OcrLine], bubbles: &[Bubble], known: &[String], g: &ChatGeom) -> (Vec<(ChatMsg, Option<usize>)>, Vec<ChatDrop>) {
    let mut drops = Vec::new();
    let mut lines: Vec<OcrLine> = lines.iter().filter(|l| !l.text.trim().is_empty()).cloned().collect();
    lines.sort_by_key(|l| l.y);
    if bubbles.is_empty() { return (assemble_legacy(&lines, known, g).into_iter().map(|m| (m, None)).collect(), drops); }

    let mut per_bubble: Vec<Vec<OcrLine>> = vec![Vec::new(); bubbles.len()];
    let mut out: Vec<(ChatMsg, Option<usize>)> = Vec::new();
    for l in &lines {
        let cy = l.y + l.h / 2;
        let t = l.text.trim();
        match bubbles.iter().position(|b| cy + 4 >= b.y0 && cy <= b.y1 + 4) {
            Some(bi) => {
                let b = &bubbles[bi];
                // Icon columns and anything outside the bubble horizontally.
                if l.x < g.left_text.max(b.x0) || l.x >= g.right_icon.min(b.x1) || l.h < g.min_h_bubble { continue; }
                per_bubble[bi].push(l.clone());
            }
            None => {
                // Outside every bubble: system lines (green, bubble-less) are kept; the rest is the vote grid /
                // lobby names showing through the translucent panel.
                if is_system(t) && l.h >= g.min_h_loose {
                    out.push((ChatMsg::new(String::new(), t.to_string(), false, true, l.y, "unknown".into()), None));
                } else if l.h >= g.min_h_loose && l.x >= g.left_text && l.x < g.right_icon {
                    drops.push(ChatDrop { why: "outsideBubble", y: l.y, text: t.to_string() });
                }
            }
        }
    }
    for (bi, b) in bubbles.iter().enumerate() {
        let ls = &per_bubble[bi];
        if b.cut_top {
            // Scrolled half out of view: we can't tell the name line by position; legacy rule (first line = name).
            let msgs = assemble_legacy(ls, known, g);
            if ls.is_empty() { continue; }
            for mut m in msgs { m.mine = b.mine; out.push((m, Some(bi))); }
            continue;
        }
        let (name_lines, text_lines): (Vec<&OcrLine>, Vec<&OcrLine>) = ls.iter().partition(|l| l.y < b.y0 + g.name_zone);
        let name_raw = name_lines.iter().map(|l| l.text.trim()).collect::<Vec<_>>().join(" ");
        let text = text_lines.iter().map(|l| l.text.trim()).collect::<Vec<_>>().join(" ");
        let sender = match looks_like_name(&name_raw, known) {
            Some((n, _)) => n,
            None if !name_raw.is_empty() && name_raw.chars().count() <= 20 => name_raw.clone(),
            _ => "?".into(),
        };
        let y = name_lines.first().map(|l| l.y).unwrap_or(b.y0);
        let mut m = ChatMsg::new(sender, text, b.mine, false, y, "unknown".into());
        if m.text.is_empty() {
            m.unreadable = true;
            drops.push(ChatDrop { why: "bubbleWithoutText", y, text: name_raw });
        }
        out.push((m, Some(bi)));
    }
    out.sort_by_key(|(m, _)| m.y);
    (out, drops)
}

/// Pre-bubble grouping (session 3): a line far below the previous one starts a new bubble whose first line is the sender.
fn assemble_legacy(lines: &[OcrLine], known: &[String], g: &ChatGeom) -> Vec<ChatMsg> {
    let mut out: Vec<ChatMsg> = Vec::new();
    let mut cur: Option<ChatMsg> = None;
    let mut last_y = 0u32;
    for l in lines {
        if !(l.h >= g.min_h_loose && l.x >= g.left_text && l.x < g.right_icon) { continue; }
        let t = l.text.trim().to_string();
        if t.is_empty() { continue; }
        if is_system(&t) {
            if let Some(m) = cur.take() { if !m.text.is_empty() { out.push(m); } }
            out.push(ChatMsg::new(String::new(), t, false, true, l.y, "unknown".into()));
            last_y = l.y;
            continue;
        }
        let starts_new = cur.is_none() || l.y.saturating_sub(last_y) > g.line_gap;
        if starts_new {
            if let Some(m) = cur.take() { if !m.text.is_empty() { out.push(m); } }
            let mine = l.x > g.right_aligned_x;
            let sender = match looks_like_name(&t, known) {
                Some((name, _)) => name,
                None => if t.chars().count() <= 20 { t.clone() } else { "?".into() },
            };
            let text = if sender == "?" { t.clone() } else { String::new() };
            cur = Some(ChatMsg::new(sender, text, mine, false, l.y, "unknown".into()));
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
    out
}

/// Installed OCR languages, refreshed at most once a minute (a pack installed mid-session is picked up).
fn ocr_langs() -> Vec<String> {
    static CACHE: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((t, v)) = c.as_ref() { if t.elapsed() < Duration::from_secs(60) { return v.clone(); } }
    let v = available_languages();
    *c = Some((Instant::now(), v.clone()));
    v
}

/// Sender → OCR language that read their last bubble best (only set when a non-default language won).
static SENDER_LANG: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

pub fn preferred_lang(sender: &str) -> Option<String> {
    SENDER_LANG.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&sender.to_lowercase()).cloned())
}

fn set_preferred_lang(sender: &str, lang: Option<&str>) {
    if sender.is_empty() || sender == "?" { return; }
    let mut g = SENDER_LANG.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    match lang { Some(l) => { m.insert(sender.to_lowercase(), l.to_string()); } None => { m.remove(&sender.to_lowercase()); } }
}

/// Order in which to try alternative OCR languages for a bubble: the sender's cached winner first.
pub fn lang_order(installed: &[String], default_lang: Option<&str>, preferred: Option<&str>) -> Vec<String> {
    let mut v: Vec<String> = installed.iter().filter(|l| Some(l.as_str()) != default_lang).cloned().collect();
    if let Some(p) = preferred { if let Some(i) = v.iter().position(|l| l == p) { let x = v.remove(i); v.insert(0, x); } }
    v
}

/// OCR one bubble with `lang`; returns (name line, text) in that language.
fn ocr_bubble(f: &Frame, b: &Bubble, g: &ChatGeom, lang: &str) -> Option<(String, String)> {
    let (c, w, h) = crop_bgra(f, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
    let res = ocr_bgra(&u, uw, uh, Some(lang)).ok()?;
    let mut lines: Vec<OcrLine> = res.lines.into_iter()
        .map(|l| OcrLine { text: l.text, x: b.x0 + l.x / 2, y: b.y0 + l.y / 2, w: l.w / 2, h: l.h / 2 })
        .filter(|l| l.x >= g.left_text.max(b.x0) && l.x < g.right_icon.min(b.x1) && l.h >= g.min_h_bubble)
        .collect();
    lines.sort_by_key(|l| l.y);
    let name = lines.iter().filter(|l| l.y < b.y0 + g.name_zone).map(|l| l.text.trim()).collect::<Vec<_>>().join(" ");
    let text = lines.iter().filter(|l| l.y >= b.y0 + g.name_zone).map(|l| l.text.trim()).collect::<Vec<_>>().join(" ");
    Some((name, text))
}

pub fn read_chat(f: &Frame, known: &[String]) -> anyhow::Result<Vec<ChatMsg>> {
    Ok(read_chat_detailed(f, known)?.msgs)
}

pub fn read_chat_detailed(f: &Frame, known: &[String]) -> anyhow::Result<ChatRead> {
    let g = ChatGeom::for_frame(f.width, f.height);
    let r = g.panel;
    let sx = f.width as f32 / REF_W as f32;
    let bubbles = find_bubbles(f, r);
    let (c, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
    let res = ocr_bgra(&u, uw, uh, None)?;
    let default_lang = res.lang.clone();
    let lines: Vec<OcrLine> = res.lines.into_iter()
        .map(|l| OcrLine { text: l.text, x: r.x + l.x / 2, y: r.y + l.y / 2, w: l.w / 2, h: l.h / 2 })
        .collect();
    let (assembled, mut drops) = assemble(&lines, &bubbles, known, &g);
    let installed = if bubbles.is_empty() { Vec::new() } else { ocr_langs() };

    let mut msgs = Vec::with_capacity(assembled.len());
    for (mut m, bi) in assembled {
        if m.system { msgs.push(m); continue; }
        let mut p = plausibility(&m.text);
        if let Some(b) = bi.map(|i| bubbles[i]) {
            m.bubble_hash = dhash(&f.bgra, f.width, Rect::new(b.x0, b.y0, (b.x1 - b.x0).max(9), (b.y1 - b.y0).max(8)));
            // Other OCR languages for bubbles that read badly (or whose sender wrote in another language before).
            let preferred = preferred_lang(&m.sender);
            let alts = lang_order(&installed, default_lang.as_deref(), preferred.as_deref());
            let weak = m.text.is_empty() || p.score < 0.7 || preferred.is_some();
            if !b.cut_top && weak && !alts.is_empty() {
                let mut best: Option<(String, String, String, f32)> = None; // (lang, name, text, score)
                for lang in &alts {
                    let Some((name, text)) = ocr_bubble(f, &b, &g, lang) else { continue };
                    if text.is_empty() { continue; }
                    let s = plausibility(&text).score;
                    if best.as_ref().map(|x| s > x.3).unwrap_or(true) { best = Some((lang.clone(), name, text, s)); }
                    if s >= 0.85 { break; }
                }
                let base = if m.text.is_empty() { 0.0 } else { p.score };
                match best {
                    Some((lang, name, text, s)) if s > base + 0.1 => {
                        // The other language's name line only replaces ours when ours matched no known player.
                        if looks_like_name(&m.sender, known).is_none() {
                            if let Some((n, _)) = looks_like_name(&name, known) { m.sender = n; } else if !name.is_empty() && name.chars().count() <= 20 { m.sender = name; }
                        }
                        m.text = text;
                        m.ocr_lang = Some(lang.clone());
                        m.unreadable = false;
                        p = plausibility(&m.text);
                        set_preferred_lang(&m.sender, Some(&lang));
                    }
                    _ => { if preferred.is_some() && p.score >= 0.7 { set_preferred_lang(&m.sender, None); } }
                }
            }
            // Icon colour: left of a left bubble (x≈385–470) or right of a right bubble (x≈1350–1440), level with the name line.
            let icon = if m.mine { Rect::new(r.x + (1010.0 * sx) as u32, m.y.saturating_sub((5.0 * sx) as u32), (80.0 * sx) as u32, (80.0 * sx) as u32) }
                       else { Rect::new(r.x + (40.0 * sx) as u32, m.y.saturating_sub((5.0 * sx) as u32), (80.0 * sx) as u32, (80.0 * sx) as u32) };
            let body = Rect::new(icon.x + (20.0 * sx) as u32, icon.y + (30.0 * sx) as u32, (40.0 * sx) as u32, (45.0 * sx) as u32);
            if body.y + body.h < f.height && body.x + body.w < f.width { m.color = color_name(body_color_in(f, body, false, false).0).to_string(); }
        } else {
            let icon = if m.mine { Rect::new(r.x + (1010.0 * sx) as u32, m.y.saturating_sub((5.0 * sx) as u32), (80.0 * sx) as u32, (80.0 * sx) as u32) }
                       else { Rect::new(r.x + (40.0 * sx) as u32, m.y.saturating_sub((5.0 * sx) as u32), (80.0 * sx) as u32, (80.0 * sx) as u32) };
            let body = Rect::new(icon.x + (20.0 * sx) as u32, icon.y + (30.0 * sx) as u32, (40.0 * sx) as u32, (45.0 * sx) as u32);
            if body.y + body.h < f.height && body.x + body.w < f.width { m.color = color_name(body_color_in(f, body, false, false).0).to_string(); }
        }
        m.plausibility = p.score;
        // Garbage in every language we have: still a message (someone said something), flagged for the hint.
        if !m.text.is_empty() && p.letters >= 6 && p.score < 0.6 && p.weird_words >= 2 { m.unreadable = true; }
        if looks_like_cyrillic_misread(&m.text) { m.script_hint = Some("cyrillic".into()); m.cyrillic_guess = Some(cyrillic_from_lookalike(&m.text)); m.unreadable = true; }
        if m.unreadable { drops.push(ChatDrop { why: if m.text.is_empty() { "unreadableEmpty" } else { "unreadableGarbage" }, y: m.y, text: m.text.clone() }); }
        msgs.push(m);
    }
    // The empty-bubble drop from `assemble` is superseded by the unreadable entry above.
    drops.retain(|d| d.why != "bubbleWithoutText");
    Ok(ChatRead { msgs, drops, bubbles: bubbles.len() })
}

#[cfg(test)]
mod pure_tests {
    use super::*;

    fn geom() -> ChatGeom { ChatGeom::for_frame(1920, 1080) }
    fn line(text: &str, x: u32, y: u32, h: u32) -> OcrLine { OcrLine { text: text.into(), x, y, w: 200, h } }

    #[test]
    fn short_lowercase_cyrillic_line_inside_a_bubble_is_kept() {
        // "кто" is x-height only (≈ 19 px): the old 23 px floor dropped it and with it the whole bubble.
        let b = Bubble { x0: 360, x1: 1345, y0: 470, y1: 580, cut_top: false, mine: false };
        let lines = vec![line("SHUSH", 515, 485, 34), line("кто", 515, 535, 19)];
        let (msgs, drops) = assemble(&lines, &[b], &["SHUSH".to_string()], &geom());
        assert_eq!(msgs.len(), 1, "{msgs:?} {drops:?}");
        assert_eq!(msgs[0].0.sender, "SHUSH");
        assert_eq!(msgs[0].0.text, "кто");
        assert!(!msgs[0].0.unreadable);
    }

    #[test]
    fn bubble_with_unreadable_text_is_reported_not_dropped() {
        let b = Bubble { x0: 360, x1: 1345, y0: 470, y1: 580, cut_top: false, mine: false };
        let (msgs, drops) = assemble(&[line("SHUSH", 515, 485, 34)], &[b], &["SHUSH".to_string()], &geom());
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].0.unreadable);
        assert_eq!(msgs[0].0.sender, "SHUSH");
        assert!(drops.iter().any(|d| d.why == "bubbleWithoutText"));
    }

    #[test]
    fn names_showing_through_the_panel_outside_bubbles_are_dropped_but_system_lines_kept() {
        let b = Bubble { x0: 360, x1: 1345, y0: 172, y1: 284, cut_top: false, mine: false };
        let lines = vec![
            line("Bonsainew", 1135, 288, 30),
            line("SHUSH", 515, 188, 34), line("Hi", 515, 232, 32),
            line("SHUSH has voted. 3 remaining.", 515, 300, 28),
        ];
        let (msgs, drops) = assemble(&lines, &[b], &[], &geom());
        let texts: Vec<String> = msgs.iter().map(|(m, _)| format!("{}{}:{}", if m.system { "#" } else { "" }, m.sender, m.text)).collect();
        assert_eq!(texts, vec!["SHUSH:Hi".to_string(), "#:SHUSH has voted. 3 remaining.".to_string()]);
        assert!(drops.iter().any(|d| d.text == "Bonsainew"));
    }

    #[test]
    fn missing_name_line_gives_unknown_sender_not_a_fake_name() {
        let b = Bubble { x0: 478, x1: 1460, y0: 320, y1: 432, cut_top: false, mine: true };
        let (msgs, _) = assemble(&[line("hello", 1245, 378, 32)], &[b], &[], &geom());
        assert_eq!(msgs[0].0.sender, "?");
        assert_eq!(msgs[0].0.text, "hello");
        assert!(msgs[0].0.mine);
    }

    #[test]
    fn without_bubbles_the_legacy_grouping_is_used() {
        let lines = vec![line("SHUSH", 515, 188, 34), line("How are u", 515, 232, 32)];
        let (msgs, _) = assemble(&lines, &[], &[], &geom());
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].0.text, "How are u");
    }

    #[test]
    fn alternative_languages_put_the_senders_winner_first_and_skip_the_default() {
        let installed = vec!["en-US".to_string(), "de-DE".to_string(), "ru".to_string()];
        assert_eq!(lang_order(&installed, Some("en-US"), None), vec!["de-DE", "ru"]);
        assert_eq!(lang_order(&installed, Some("en-US"), Some("ru")), vec!["ru", "de-DE"]);
        assert!(lang_order(&["en-US".to_string()], Some("en-US"), None).is_empty());
    }

    #[test]
    fn sender_language_cache_round_trips() {
        set_preferred_lang("Саша", Some("ru"));
        assert_eq!(preferred_lang("саша").as_deref(), Some("ru"));
        set_preferred_lang("Саша", None);
        assert_eq!(preferred_lang("Саша"), None);
    }
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
        assert!(msgs.iter().all(|m| !m.unreadable), "{msgs:?}");
    }

    #[test]
    fn finds_the_four_lobby_bubbles_from_pixels() {
        let f = load("lobby_chat");
        let g = ChatGeom::for_frame(f.width, f.height);
        let b = find_bubbles(&f, g.panel);
        assert_eq!(b.len(), 4, "{b:?}");
        assert_eq!(b.iter().map(|b| b.mine).collect::<Vec<_>>(), vec![false, true, false, true], "{b:?}");
        assert!(b.iter().all(|b| !b.cut_top), "{b:?}");
    }

    #[test]
    fn reads_the_meeting_chat() {
        let f = load("meeting_chat");
        let msgs = read_chat(&f, &[]).unwrap();
        assert!(msgs.len() >= 3, "{msgs:?}");
        assert!(msgs.iter().any(|m| m.text.to_lowercase().contains("vent")), "{msgs:?}");
    }

    /// A fixture-shaped bubble with Cyrillic text rendered by GDI+ and read by the installed OCR.
    /// With only en-US installed the bubble must come back flagged unreadable (Cyrillic hint), never vanish.
    #[test]
    fn cyrillic_bubble_is_reported_even_without_the_russian_ocr_pack() {
        let mut f = load("lobby_chat");
        // Paste the synthetic Cyrillic text line into the first SHUSH bubble, over "Hi".
        let path = format!("{}/fixtures/text/cyrillic_line.png", env!("CARGO_MANIFEST_DIR"));
        let img = image::open(&path).expect("cyrillic fixture").to_rgba8();
        let (w, h) = img.dimensions();
        for y in 0..h { for x in 0..w {
            let p = img.get_pixel(x, y);
            let (fx, fy) = (512 + x, 226 + y);
            let i = ((fy * f.width + fx) * 4) as usize;
            f.bgra[i] = p[2]; f.bgra[i + 1] = p[1]; f.bgra[i + 2] = p[0];
        } }
        let known = vec!["SHUSH".to_string(), "BigBingus".to_string()];
        let msgs = read_chat(&f, &known).unwrap();
        let first = msgs.iter().find(|m| m.sender == "SHUSH" && m.y < 300).unwrap_or_else(|| panic!("{msgs:?}"));
        let has_ru = available_languages().iter().any(|l| l.starts_with("ru"));
        if has_ru {
            assert!(first.text.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c)), "{first:?}");
        } else {
            assert!(first.unreadable, "{first:?}");
            assert_eq!(first.script_hint.as_deref(), Some("cyrillic"), "{first:?}");
            assert!(first.cyrillic_guess.as_deref().unwrap_or("").starts_with("кто"), "{first:?}");
        }
    }
}
