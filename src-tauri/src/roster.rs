//! Vote-grid reader: the meeting panel → roster (name, colour, alive/dead, reporter).
//!
//! Each cell: crewmate icon on the left (a red X is drawn over it when dead),
//! name text to the right. Names are OCR'd at 2×; colour is the dominant
//! saturated hue in the icon box classified by `colors.rs`; "dead" is the share
//! of strongly red pixels in the icon box (the X is #E8232A-ish on a grey card).

use crate::capture::{crop_bgra, upscale_bgra, Frame};
use crate::colors::{classify, PlayerColor};
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

/// A cell is "occupied" when its green level badge ("Lv N", top-left of the card) is present.
/// Card backgrounds vary with cosmetics (space, dark), so the badge is the stable marker.
fn cell_occupied(f: &Frame, cell: Rect) -> bool {
    let sx = f.width as f32 / REF_W as f32;
    let r = Rect::new(cell.x + (8.0 * sx) as u32, cell.y + (6.0 * sx) as u32, (44.0 * sx) as u32, (44.0 * sx) as u32);
    let (buf, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let green = buf.chunks_exact(4).filter(|p| { let (b, g, rr) = (p[0] as i32, p[1] as i32, p[2] as i32); g > 110 && g > rr + 40 && g > b + 40 }).count() as f32;
    green / (w * h) as f32 > 0.12
}

/// Share of "red X" pixels in the icon box.
fn red_share(f: &Frame, cell: Rect) -> f32 {
    let (ix, iy, iw, ih) = VoteCell::ICON;
    let sx = f.width as f32 / REF_W as f32;
    let r = Rect::new(cell.x + (ix as f32 * sx) as u32, cell.y + (iy as f32 * sx) as u32, (iw as f32 * sx) as u32, (ih as f32 * sx) as u32);
    let (buf, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    // Dead cards are drawn with a dark overlay: the X measures ~R132 G61 B53 on William's
    // frames, while alive icons have ~0 pixels with R>110 and R − max(G,B) > 45 (hat glints ≤ 0.5 %).
    let mut red = 0u32;
    for px in buf.chunks_exact(4) {
        let (b, g, rr) = (px[0] as i32, px[1] as i32, px[2] as i32);
        if rr > 110 && rr - g.max(b) > 45 { red += 1; }
    }
    red as f32 / (w * h) as f32
}

/// Dominant saturated colour in the icon box, excluding the red X and near-grey pixels.
fn icon_color(f: &Frame, cell: Rect, dead: bool) -> (PlayerColor, f32) {
    let (ix, iy, iw, ih) = VoteCell::ICON;
    let sx = f.width as f32 / REF_W as f32;
    let r = Rect::new(cell.x + (ix as f32 * sx) as u32, cell.y + (iy as f32 * sx) as u32, (iw as f32 * sx) as u32, (ih as f32 * sx) as u32);
    let (buf, _, _) = crop_bgra(f, r.x, r.y, r.w, r.h);
    // Vote by classified palette colour, weighted by closeness; the visor (#9ACAD5) and outlines are skipped by ΔE.
    let mut votes: std::collections::HashMap<PlayerColor, (u32, f32)> = Default::default();
    for px in buf.chunks_exact(4) {
        // Undo the dead-card dimming (~50 % black overlay) before classifying.
        let boost = |v: u8| if dead { (v as u16 * 2).min(255) as u8 } else { v };
        let rgb = [boost(px[2]), boost(px[1]), boost(px[0])];
        let max = rgb.iter().max().copied().unwrap() as i32;
        let min = rgb.iter().min().copied().unwrap() as i32;
        if max - min < 40 && max > 60 { continue; } // grey card / outlines (keeps black/white crewmates via ΔE below)
        if dead && (rgb[0] as i32) - (rgb[1].max(rgb[2]) as i32) > 90 && rgb[1] > 90 { continue; } // the X (orange-red), keeps #C51111 red bodies
        let (c, d) = classify(rgb);
        if d > 35.0 || c == PlayerColor::Unknown { continue; }
        let e = votes.entry(c).or_insert((0, 0.0));
        e.0 += 1; e.1 += d;
    }
    votes.into_iter().max_by_key(|(_, (n, _))| *n).map(|(c, (n, d))| (c, d / n as f32)).unwrap_or((PlayerColor::Unknown, 99.0))
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
        let raw = ocr.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" ").trim().to_string();
        // Occupancy = a name was read (empty cells are flat panel grey and OCR to nothing).
        if raw.chars().filter(|c| c.is_alphanumeric()).count() < 2 { continue; }
        let _ = cell_occupied(f, cell); // secondary signal, kept for the calibration UI
        let (name, name_confidence) = match fuzzy_best(&raw, known_names.iter().map(String::as_str)) {
            Some((n, score)) if score >= 0.6 => (n.to_string(), score),
            _ => (raw.clone(), if known_names.is_empty() { 0.8 } else { 0.4 }),
        };
        let dead = red_share(f, cell) > 0.10;
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
        assert!(r.entries.iter().any(|e| e.reporter && e.name.contains("Big")), "reporter badge: {:?}", r.entries.iter().map(|e| (e.name.clone(), e.reporter)).collect::<Vec<_>>());
        // Colours: use the fully faded-in frame (frame 1 is mid fade-in and uniformly dim).
        let f2 = load_fixture("meeting_vote_grid_2");
        let r2 = read_vote_grid(&f2, &[]).expect("read");
        let by = |n: &str| r2.entries.iter().find(|e| e.name.contains(n)).unwrap();
        assert_eq!(by("SHUSH").color, "blue");
        assert_eq!(by("Timetrast").color, "cyan");
        // Vote-grid icons are shaded half-bodies behind hats/pets: only strong hues are reliable.
        // Warm colours (orange/yellow/banana/brown) blur together here — names stay the identity key
        // and the user fixes a colour with one click (see docs/handoff.md, Phase 2 gaps).
        assert!(by("Waxscarce").color != "unknown");
        assert!(["red", "maroon", "coral"].contains(&by("Bonsainew").color.as_str()), "dead card colour is best-effort: {}", by("Bonsainew").color);
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

