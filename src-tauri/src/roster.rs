//! Vote-grid reader: the meeting panel → roster (name, colour, alive/dead, reporter).
//!
//! Each cell: crewmate icon on the left (a red X is drawn over it when dead),
//! name text to the right. Names are OCR'd at 2×; colour is the dominant
//! saturated hue in the icon box classified by `colors.rs`; "dead" is the share
//! of strongly red pixels in the icon box (the X is #E8232A-ish on a grey card).

use crate::capture::{crop_bgra, upscale_bgra, Frame};
use crate::colors::{PlayerColor, PALETTE};
use crate::ocr::{fuzzy_best, ocr_bgra};
use crate::regions::{Rect, VoteCell, REF_H, REF_W};

#[derive(Clone, Debug, serde::Serialize, PartialEq)]
pub struct RosterEntry {
    pub index: u32,
    pub name: String,
    /// 0..1 OCR plausibility (1 = exact vocabulary match when a vocabulary was given).
    pub name_confidence: f32,
    pub color: String,
    pub color_delta_e: f32,
    pub dead: bool,
    pub reporter: bool,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct RosterRead {
    pub entries: Vec<RosterEntry>,
    pub ocr_ms: u64,
}

fn cell_in_frame(index: u32, f: &Frame) -> Rect {
    let (sx, sy) = (f.width as f32 / REF_W as f32, f.height as f32 / REF_H as f32);
    VoteCell::rect(index).scaled(sx, sy)
}

/// A cell is "occupied" when its level badge ("Lv N", a teal-green circle at the card's top-left)
/// is present. Measured share of badge-coloured pixels: 0.20–0.33 alive, ~0.10 dead (dimmed), 0.00 empty.
fn cell_occupied(f: &Frame, cell: Rect) -> bool {
    let sx = f.width as f32 / REF_W as f32;
    let r = Rect::new(cell.x + (8.0 * sx) as u32, cell.y + (6.0 * sx) as u32, (44.0 * sx) as u32, (44.0 * sx) as u32);
    let (buf, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let green = buf.chunks_exact(4).filter(|p| { let (b, g, rr) = (p[0] as i32, p[1] as i32, p[2] as i32); g > 100 && g > rr + 30 && g > b + 10 }).count() as f32;
    green / (w * h) as f32 > 0.05
}

/// Names are white (grey when dead) with a black outline over arbitrary card art. Keep pixels that
/// are bright relative to the crop's brightest and nearly neutral; render them black on white.
fn white_text_mask(bgra: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut max_l = 0u32;
    for px in bgra.chunks_exact(4) { let l = (px[0] as u32 + px[1] as u32 + px[2] as u32) / 3; if l > max_l { max_l = l; } }
    let thr = (max_l as f32 * 0.78) as u32;
    let mut out = vec![255u8; (w * h * 4) as usize];
    for (i, px) in bgra.chunks_exact(4).enumerate() {
        let (b, g, r) = (px[0] as i32, px[1] as i32, px[2] as i32);
        let l = ((b + g + r) / 3) as u32;
        let neutral = (r - g).abs() < 28 && (g - b).abs() < 28 && (r - b).abs() < 28;
        if l >= thr && neutral { out[i * 4] = 0; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0; }
    }
    out
}

/// The dead X: a dim orange-red band (R≈128 G≈64 B≈48 on real frames) drawn along the two
/// diagonals of the icon box. Counting band pixels *near the diagonals* separates it from red
/// bodies, hats and card art (measured: dead ≥ 1500, alive ≤ ~150 at 1080p).
fn dead_x_score(f: &Frame, cell: Rect) -> u32 {
    let (ix, iy, iw, ih) = VoteCell::ICON;
    let sx = f.width as f32 / REF_W as f32;
    let r = Rect::new(cell.x + (ix as f32 * sx) as u32, cell.y + (iy as f32 * sx) as u32, (iw as f32 * sx) as u32, (ih as f32 * sx) as u32);
    let (buf, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let mut diag = 0u32;
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            let (b, g, rr) = (buf[i] as i32, buf[i + 1] as i32, buf[i + 2] as i32);
            if !(100..=175).contains(&rr) || !(40..=100).contains(&g) || !(25..=90).contains(&b) || rr - g < 35 { continue; }
            let u = x as f32 / w as f32;
            let v = y as f32 / h as f32;
            if (u - v).abs() < 0.09 || (u - (1.0 - v)).abs() < 0.09 { diag += 1; }
        }
    }
    // Normalise to the reference icon area so other resolutions use the same threshold.
    ((diag as f32) / (sx * sx)) as u32
}

/// How the game renders palette colours on vote-grid icons (measured on real frames):
/// alive ≈ 0.75·palette + 60 (a 25 % white lift); dead cards are dimmed to ≈ 0.6 of that.
fn grid_expected(p: [u8; 3], dead: bool) -> [f32; 3] {
    let alive = [0.75 * p[0] as f32 + 60.0, 0.75 * p[1] as f32 + 60.0, 0.75 * p[2] as f32 + 60.0];
    if !dead { return alive; }
    // Dead cards sit under a dark semi-transparent overlay: measured red (208,64,80) → (128,48,64).
    [0.45 * alive[0] + 20.0, 0.45 * alive[1] + 20.0, 0.45 * alive[2] + 20.0]
}

/// Body colour from the icon's body patch (below the visor, right of the backpack), by plain
/// RGB distance to the grid-rendered palette. Skips the X band on dead cards and outlines.
fn icon_color(f: &Frame, cell: Rect, dead: bool) -> (PlayerColor, f32) {
    let (ix, iy, _, _) = VoteCell::ICON;
    let sx = f.width as f32 / REF_W as f32;
    // Lower half of the body only: hats and held signs sit above y≈45 of the icon box.
    let r = Rect::new(cell.x + ((ix + 28) as f32 * sx) as u32, cell.y + ((iy + 48) as f32 * sx) as u32, (46.0 * sx) as u32, (40.0 * sx) as u32);
    let (buf, _, _) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let mut votes: std::collections::HashMap<PlayerColor, (u32, f32)> = Default::default();
    for px in buf.chunks_exact(4) {
        let (b, g, rr) = (px[0] as f32, px[1] as f32, px[2] as f32);
        if rr.max(g).max(b) < 35.0 { continue; } // outline
        if dead && (100.0..=175.0).contains(&rr) && (40.0..=100.0).contains(&g) && (25.0..=90.0).contains(&b) && rr - g >= 35.0 { continue; } // the X
        let mut best = (PlayerColor::Unknown, f32::MAX);
        for (c, p) in PALETTE {
            let e = grid_expected(*p, dead);
            let d = ((rr - e[0]).powi(2) + (g - e[1]).powi(2) + (b - e[2]).powi(2)).sqrt();
            if d < best.1 { best = (*c, d); }
        }
        if best.1 > 42.0 { continue; } // hats, skins, card art, visor
        let e = votes.entry(best.0).or_insert((0, 0.0));
        e.0 += 1; e.1 += best.1;
    }
    votes.into_iter().max_by_key(|(_, (n, _))| *n).filter(|(_, (n, _))| *n >= 25).map(|(c, (n, d))| (c, d / n as f32)).unwrap_or((PlayerColor::Unknown, 99.0))
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

/// Read every occupied vote-grid cell. `known_names` (from the lobby or a previous read) snaps OCR output.
pub fn read_vote_grid(f: &Frame, known_names: &[String]) -> anyhow::Result<RosterRead> {
    let t0 = std::time::Instant::now();
    let mut entries = Vec::new();
    for index in 0..(VoteCell::ROWS * VoteCell::COLS) {
        let cell = cell_in_frame(index, f);
        if cell.x + cell.w > f.width || cell.y + cell.h > f.height { break; }
        let (nx, ny, nw, nh) = VoteCell::NAME;
        let sx = f.width as f32 / REF_W as f32;
        let name_rect = Rect::new(cell.x + (nx as f32 * sx) as u32, cell.y + (ny as f32 * sx) as u32, (nw as f32 * sx) as u32, (nh as f32 * sx) as u32);
        let (crop, cw, ch) = crop_bgra(f, name_rect.x, name_rect.y, name_rect.w, name_rect.h);
        let (up, uw, uh) = upscale_bgra(&crop, cw, ch, 2);
        let ocr = ocr_bgra(&up, uw, uh, None)?;
        let mut raw = ocr.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" ").trim().to_string();
        if raw.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
            // Busy cosmetic card art behind the name: keep only the (near-)white outlined glyphs.
            let bin = white_text_mask(&up, uw, uh);
            let ocr2 = ocr_bgra(&bin, uw, uh, None)?;
            raw = ocr2.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" ").trim().to_string();
        }
        // Occupancy: the level badge, or a readable name (single-letter names like "U" exist).
        let occupied = cell_occupied(f, cell);
        let readable = raw.chars().filter(|c| c.is_alphanumeric()).count() >= 1;
        if !occupied && !readable { continue; }
        if !readable { raw = format!("#{}", index + 1); }
        let placeholder = raw.starts_with('#');
        let (name, name_confidence) = match fuzzy_best(&raw, known_names.iter().map(String::as_str)) {
            Some((n, score)) if !placeholder && score >= 0.6 => (n.to_string(), score),
            _ => (raw.clone(), if placeholder { 0.2 } else if known_names.is_empty() { 0.8 } else { 0.4 }),
        };
        let dead = dead_x_score(f, cell) >= 700;
        let (color, delta) = icon_color(f, cell, dead);
        entries.push(RosterEntry { index, name, name_confidence, color: color_name(color).to_string(), color_delta_e: delta, dead, reporter: false });
    }
    // The reporter/caller has a megaphone badge at the cell's top-right; approximate with a red-ish badge check.
    for e in entries.iter_mut() {
        let cell = cell_in_frame(e.index, f);
        let sx = f.width as f32 / REF_W as f32;
        let badge = Rect::new(cell.x + (455.0 * sx) as u32, cell.y.saturating_sub((8.0 * sx) as u32), (40.0 * sx) as u32, (40.0 * sx) as u32);
        let (buf, w, h) = crop_bgra(f, badge.x, badge.y, badge.w, badge.h);
        let red = buf.chunks_exact(4).filter(|p| p[2] > 180 && p[1] < 100 && p[0] < 100).count() as f32 / (w * h) as f32;
        e.reporter = red > 0.04;
    }
    Ok(RosterRead { entries, ocr_ms: t0.elapsed().as_millis() as u64 })
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn load_fixture(name: &str) -> Frame {
        let path = format!("{}/fixtures/screens/1920x1080/{name}.png", env!("CARGO_MANIFEST_DIR"));
        let img = image::open(&path).expect("fixture png").to_rgba8();
        let (w, h) = img.dimensions();
        let mut bgra = img.into_raw();
        for px in bgra.chunks_exact_mut(4) { px.swap(0, 2); }
        Frame { width: w, height: h, bgra, t_wall_ms: 0, seq: 1 }
    }

    #[test]
    fn reads_the_real_vote_grid() {
        let f = load_fixture("meeting_vote_grid");
        let r = read_vote_grid(&f, &[]).expect("read");
        let names: Vec<&str> = r.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(r.entries.len(), 10, "{names:?}");
        for expected in ["SHUSH", "Waxscarce", "BASHOLI", "Timetrast", "Flushbevy", "Sensepast", "Pablio888", "Bonsainew"] {
            assert!(names.iter().any(|n| fuzzy_best(n, [expected]).unwrap().1 > 0.75), "missing {expected} in {names:?}");
        }
        let dead: Vec<&str> = r.entries.iter().filter(|e| e.dead).map(|e| e.name.as_str()).collect();
        assert_eq!(dead.len(), 2, "dead = {dead:?}");
        assert!(dead.iter().any(|n| n.contains("Bonsainew")));
        assert!(dead.iter().any(|n| n.contains("sekt")), "{dead:?}");
        assert!(r.entries.iter().any(|e| e.reporter && e.name.contains("Big")), "reporter badge: {:?}", r.entries.iter().map(|e| (e.name.clone(), e.reporter)).collect::<Vec<_>>());
        // Colours: use the fully faded-in frame (frame 1 is mid fade-in and uniformly dim).
        let f2 = load_fixture("meeting_vote_grid_2");
        let r2 = read_vote_grid(&f2, &[]).expect("read");
        let by = |n: &str| r2.entries.iter().find(|e| fuzzy_best(&e.name, [n]).unwrap().1 > 0.7).unwrap_or_else(|| panic!("{n} missing in {:?}", r2.entries.iter().map(|e| (e.name.clone(), e.color.clone(), e.dead)).collect::<Vec<_>>()));
        assert_eq!(by("SHUSH").color, "blue");
        assert_eq!(by("Timetrast").color, "cyan");
        assert_eq!(by("Waxscarce").color, "orange", "{:?}", r2.entries);
        assert_eq!(by("Flushbevy").color, "rose", "{:?}", r2.entries);
        assert_eq!(by("BASHOLI").color, "white", "{:?}", r2.entries);
        assert!(["red", "maroon"].contains(&by("Bonsainew").color.as_str()), "dead card (dark overlay, best-effort): {:?}", r2.entries);
        assert_eq!(by("BigBingus").color, "maroon", "{:?}", r2.entries);

        // 15-player frame from the second game, with heavy cosmetics and three dead.
        let f3 = load_fixture("meeting_vote_grid_3");
        let r3 = read_vote_grid(&f3, &[]).expect("read");
        assert_eq!(r3.entries.len(), 15, "{:?}", r3.entries.iter().map(|e| e.name.clone()).collect::<Vec<_>>());
        let dead3: Vec<&str> = r3.entries.iter().filter(|e| e.dead).map(|e| e.name.as_str()).collect();
        assert_eq!(dead3.len(), 3, "dead = {dead3:?}");
        for n in ["Nigabut", "kenze", "Oakutter"] { assert!(dead3.iter().any(|d| fuzzy_best(d, [n]).unwrap().1 > 0.7), "{n} not dead in {dead3:?}"); }
        let by3 = |n: &str| r3.entries.iter().find(|e| fuzzy_best(&e.name, [n]).unwrap().1 > 0.7).unwrap_or_else(|| panic!("{n} missing"));
        assert_eq!(by3("Alkylraven").color, "red");
        assert_eq!(by3("Bean").color, "orange");
        assert_eq!(by3("Grain Rain").color, "purple");
        assert_eq!(by3("BRATZY").color, "rose");
        // "LJ" (two letters over a starfield) may come back as the "#1" placeholder; the slot still identifies them.
        let lj = r3.entries.iter().find(|e| e.index == 0).unwrap();
        assert!(lj.name == "#1" || fuzzy_best(&lj.name, ["LJ"]).unwrap().1 > 0.5, "{:?}", lj);
        assert_eq!(lj.color, "banana");
        assert_eq!(by3("Caramel").color, "white");
        assert_eq!(by3("BigBingus").color, "maroon");
        // heaven holds a yellow "DUM" sign across the body: a cosmetic can still win. Known limit.
        assert!(["cyan", "yellow"].contains(&by3("heaven").color.as_str()), "{}", by3("heaven").color);
    }

    #[test]
    fn reads_role_card_and_lobby_code() {
        use crate::regions::Regions;
        let f = load_fixture("role_card");
        let reg = Regions::default().for_frame(f.width, f.height);
        let (c, w, h) = crop_bgra(&f, reg.role_card.x, reg.role_card.y, reg.role_card.w, reg.role_card.h);
        let (u, uw, uh) = upscale_bgra(&c, w, h, 1);
        let r = ocr_bgra(&u, uw, uh, None).unwrap();
        assert!(r.lines.iter().any(|l| l.text.contains("CREWMATE")), "{:?}", r.lines);
        let f = load_fixture("role_card_v2");
        let (c, w, h) = crop_bgra(&f, reg.role_card.x, reg.role_card.y, reg.role_card.w, reg.role_card.h);
        let r = ocr_bgra(&c, w, h, None).unwrap();
        let text = r.lines.iter().map(|l| l.text.clone()).collect::<Vec<_>>().join(" ");
        assert!(text.to_uppercase().contains("CREWMATE"), "{text}");

        let f = load_fixture("lobby");
        let (c, w, h) = crop_bgra(&f, reg.lobby_code.x, reg.lobby_code.y, reg.lobby_code.w, reg.lobby_code.h);
        let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
        let r = ocr_bgra(&u, uw, uh, None).unwrap();
        assert!(r.lines.iter().any(|l| l.text.contains("PFRXRG")), "{:?}", r.lines);
    }

    #[test]
    fn detects_chat_open_and_room_label() {
        use crate::regions::Regions;
        let f = load_fixture("meeting_chat");
        let reg = Regions::default().for_frame(f.width, f.height);
        let (c, w, h) = crop_bgra(&f, reg.chat_send.x, reg.chat_send.y, reg.chat_send.w, reg.chat_send.h);
        let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
        let r = ocr_bgra(&u, uw, uh, None).unwrap();
        assert!(r.lines.iter().any(|l| fuzzy_best(&l.text, ["Send"]).unwrap().1 > 0.7), "{:?}", r.lines);
        let f = load_fixture("round_room_label");
        let (c, w, h) = crop_bgra(&f, reg.room_label.x, reg.room_label.y, reg.room_label.w, reg.room_label.h);
        let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
        let r = ocr_bgra(&u, uw, uh, None).unwrap();
        assert!(r.lines.iter().any(|l| l.text.contains("Electrical")), "{:?}", r.lines);
    }

    #[test]
    fn reads_eject_text_and_meeting_header() {
        use crate::regions::Regions;
        let f = load_fixture("eject_text");
        let reg = Regions::default().for_frame(f.width, f.height);
        let (c, w, h) = crop_bgra(&f, reg.eject_text.x, reg.eject_text.y, reg.eject_text.w, reg.eject_text.h);
        let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
        let r = ocr_bgra(&u, uw, uh, None).unwrap();
        let text = r.lines.iter().map(|l| l.text.clone()).collect::<Vec<_>>().join(" ");
        assert!(fuzzy_best(&text, ["Flushbevy was An Im"]).unwrap().1 > 0.8, "{text}");

        let f = load_fixture("meeting_vote_grid");
        let (c, w, h) = crop_bgra(&f, reg.meeting_header.x, reg.meeting_header.y, reg.meeting_header.w, reg.meeting_header.h);
        let (u, uw, uh) = upscale_bgra(&c, w, h, 2);
        let r = ocr_bgra(&u, uw, uh, None).unwrap();
        let text = r.lines.iter().map(|l| l.text.clone()).collect::<Vec<_>>().join(" ");
        assert!(fuzzy_best(&text, ["Who Is The Impostor?"]).unwrap().1 > 0.8, "{text}");
    }
}

