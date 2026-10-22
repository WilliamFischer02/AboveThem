//! Regions of interest in 1920×1080 reference coordinates. See docs/GAME_INTEGRATION.md §3.
//!
//! Defaults below were measured on William's real 1920×1080 frames (2026-10-21,
//! game v19s). Other resolutions are scaled from these; the Calibrate screen
//! (Phase 2.2) will let the user drag them and persist per resolution.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect { pub x: u32, pub y: u32, pub w: u32, pub h: u32 }

impl Rect {
    pub const fn new(x: u32, y: u32, w: u32, h: u32) -> Self { Self { x, y, w, h } }
    pub fn scaled(&self, sx: f32, sy: f32) -> Self {
        Self { x: (self.x as f32 * sx) as u32, y: (self.y as f32 * sy) as u32, w: (self.w as f32 * sx).max(1.0) as u32, h: (self.h as f32 * sy).max(1.0) as u32 }
    }
}

/// Vote-grid cell geometry at the reference resolution (measured). Cells are laid out
/// column-major left→right, top→bottom: index = row * 3 + col.
pub struct VoteCell;
impl VoteCell {
    pub const COLS: u32 = 3;
    pub const ROWS: u32 = 5;
    pub const X0: u32 = 205;
    pub const Y0: u32 = 213;
    pub const COL_PITCH: u32 = 522;
    pub const ROW_PITCH: u32 = 137;
    pub const W: u32 = 485;
    pub const H: u32 = 107;
    /// Crewmate icon box inside a cell (x, y, w, h), where the dead red X is drawn.
    pub const ICON: (u32, u32, u32, u32) = (10, 10, 120, 90);
    /// Name text box inside a cell.
    pub const NAME: (u32, u32, u32, u32) = (140, 28, 330, 55);
    pub fn rect(index: u32) -> Rect {
        let (row, col) = (index / Self::COLS, index % Self::COLS);
        Rect::new(Self::X0 + col * Self::COL_PITCH, Self::Y0 + row * Self::ROW_PITCH, Self::W, Self::H)
    }
}

pub const REF_W: u32 = 1920;
pub const REF_H: u32 = 1080;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Regions {
    /// Own task list, top-left during a round (lines every 40 px from y≈148).
    pub task_list: Rect,
    /// "TOTAL TASKS COMPLETED" bar.
    pub task_bar: Rect,
    /// Role reveal text ("CREWMATE" / "IMPOSTOR") at round start.
    pub role_card: Rect,
    /// Lobby chat bubbles (chat window open).
    pub chat_panel: Rect,
    /// Chat input box (green when focused).
    pub chat_input: Rect,
    /// Lobby right-hand panel: ROOM CODE / ROOM SETTINGS / map name / capacity.
    pub lobby_settings: Rect,
    pub lobby_code: Rect,
    pub map_name: Rect,
    /// Meeting panel: up to 15 player cells, 3 columns, 137 px row pitch, 522 px column pitch.
    pub vote_grid: Rect,
    /// "Who Is The Impostor?" / "Emergency Meeting" banner text.
    pub meeting_header: Rect,
    /// "<name> was (not) An Impostor." — animated; OCR only once the text is stable.
    pub eject_text: Rect,
    /// "Voting Begins In: 3s" / "Voting Ends In: 119s".
    pub voting_timer: Rect,
    /// UNVERIFIED placeholder (no sabotage captured yet).
    pub sabotage_banner: Rect,
    /// Transient room-name popup at the bottom centre when entering a room ("Electrical").
    pub room_label: Rect,
    /// The chat "Send" button — present whenever the chat panel is open (lobby or meeting).
    pub chat_send: Rect,
    /// Full-screen "DEAD BODY REPORTED" / "EMERGENCY MEETING" banner text.
    pub meeting_banner: Rect,
    /// Lobby announcements, bottom-left: "# Impostors set to 2", "Kill Cooldown set to 30.0s"...
    pub settings_feed: Rect,
    /// Chat character counter "0/100" above the input — second chat-open signal.
    pub chat_counter: Rect,
    /// Bottom-right action buttons: USE / REPORT for crew, KILL / SABOTAGE (/ VENT) for impostors.
    pub action_buttons: Rect,
    /// Lobby button at the bottom centre: "WAITING FOR HOST" (guest) / "START" (host). Visible even when
    /// the room-code panel is closed, so it is the primary lobby marker.
    pub lobby_button: Rect,
}

impl Default for Regions {
    fn default() -> Self {
        Self {
            task_list:       Rect::new(20, 100, 800, 220),
            task_bar:        Rect::new(20, 25, 850, 60),
            // Two layouts seen: "CREWMATE" banner near the top (y≈116) and "Your role is / Crewmate" centred (y≈380-440).
            role_card:       Rect::new(300, 60, 1320, 460),
            chat_panel:      Rect::new(345, 160, 1130, 620),
            chat_input:      Rect::new(350, 795, 1140, 100),
            lobby_settings:  Rect::new(1460, 200, 440, 560),
            lobby_code:      Rect::new(1500, 205, 380, 110), // includes the "ROOM CODE" title so a 6-cap name can't fake it
            map_name:        Rect::new(1500, 345, 380, 90),
            // Measured on meeting_vote_grid.png / eject_text.png (2026-10-21).
            vote_grid:       Rect::new(200, 205, 1540, 680),
            meeting_header:  Rect::new(600, 100, 760, 90),
            eject_text:      Rect::new(300, 490, 1320, 100),
            voting_timer:    Rect::new(1300, 915, 430, 60),
            // UNVERIFIED placeholder (no sabotage captured yet).
            sabotage_banner: Rect::new(560, 120, 800, 90),
            room_label:      Rect::new(600, 950, 720, 60),
            chat_send:       Rect::new(1280, 800, 220, 100),
            meeting_banner:  Rect::new(300, 250, 1320, 160),
            settings_feed:   Rect::new(0, 840, 900, 200),
            chat_counter:    Rect::new(1370, 750, 140, 50),
            action_buttons:  Rect::new(1380, 960, 540, 115),
            lobby_button:    Rect::new(700, 860, 520, 105),
        }
    }
}

impl Regions {
    /// Scale the reference regions to a frame size (uniform UI scaling, letterboxing ignored for now).
    pub fn for_frame(&self, width: u32, height: u32) -> Regions {
        let (sx, sy) = (width as f32 / REF_W as f32, height as f32 / REF_H as f32);
        Regions {
            task_list: self.task_list.scaled(sx, sy),
            task_bar: self.task_bar.scaled(sx, sy),
            role_card: self.role_card.scaled(sx, sy),
            chat_panel: self.chat_panel.scaled(sx, sy),
            chat_input: self.chat_input.scaled(sx, sy),
            lobby_settings: self.lobby_settings.scaled(sx, sy),
            lobby_code: self.lobby_code.scaled(sx, sy),
            map_name: self.map_name.scaled(sx, sy),
            vote_grid: self.vote_grid.scaled(sx, sy),
            meeting_header: self.meeting_header.scaled(sx, sy),
            eject_text: self.eject_text.scaled(sx, sy),
            voting_timer: self.voting_timer.scaled(sx, sy),
            sabotage_banner: self.sabotage_banner.scaled(sx, sy),
            room_label: self.room_label.scaled(sx, sy),
            chat_send: self.chat_send.scaled(sx, sy),
            meeting_banner: self.meeting_banner.scaled(sx, sy),
            settings_feed: self.settings_feed.scaled(sx, sy),
            chat_counter: self.chat_counter.scaled(sx, sy),
            action_buttons: self.action_buttons.scaled(sx, sy),
            lobby_button: self.lobby_button.scaled(sx, sy),
        }
    }

    pub fn get(&self, name: &str) -> Option<Rect> {
        Some(match name {
            "task_list" => self.task_list, "task_bar" => self.task_bar, "role_card" => self.role_card,
            "chat_panel" => self.chat_panel, "chat_input" => self.chat_input, "lobby_settings" => self.lobby_settings,
            "lobby_code" => self.lobby_code, "map_name" => self.map_name, "vote_grid" => self.vote_grid,
            "meeting_header" => self.meeting_header, "eject_text" => self.eject_text, "voting_timer" => self.voting_timer, "sabotage_banner" => self.sabotage_banner,
            "room_label" => self.room_label, "chat_send" => self.chat_send, "meeting_banner" => self.meeting_banner, "settings_feed" => self.settings_feed, "chat_counter" => self.chat_counter, "action_buttons" => self.action_buttons, "lobby_button" => self.lobby_button,
            _ => return None,
        })
    }

    pub const NAMES: &'static [&'static str] = &[
        "task_list", "task_bar", "role_card", "chat_panel", "chat_input", "lobby_settings", "lobby_code", "map_name",
        "vote_grid", "meeting_header", "eject_text", "voting_timer", "sabotage_banner", "room_label", "chat_send", "meeting_banner", "settings_feed", "chat_counter", "action_buttons", "lobby_button",
    ];
}

/// Cheap perceptual hash so OCR only runs when an ROI actually changed.
pub fn dhash(bgra: &[u8], width: u32, r: Rect) -> u64 {
    // 9x8 grayscale downsample → 64-bit horizontal gradient hash.
    let mut bits = 0u64;
    let mut i = 0;
    for gy in 0..8 {
        let mut prev = 0u32;
        for gx in 0..9 {
            let px = r.x + (gx * r.w) / 9;
            let py = r.y + (gy * r.h) / 8;
            let idx = ((py * width + px) * 4) as usize;
            let (b, g, rr) = (bgra[idx] as u32, bgra[idx + 1] as u32, bgra[idx + 2] as u32);
            let lum = (rr * 299 + g * 587 + b * 114) / 1000;
            if gx > 0 { if lum > prev { bits |= 1 << i; } i += 1; }
            prev = lum;
        }
    }
    bits
}

pub fn hamming(a: u64, b: u64) -> u32 { (a ^ b).count_ones() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dhash_is_stable_and_sensitive() {
        let w = 64; let h = 64;
        let mut img = vec![0u8; (w * h * 4) as usize];
        let r = Rect { x: 0, y: 0, w, h };
        let h0 = dhash(&img, w, r);
        assert_eq!(h0, dhash(&img, w, r));
        for y in 0..h { for x in 32..w { let i = ((y * w + x) * 4) as usize; img[i] = 255; img[i+1] = 255; img[i+2] = 255; } }
        assert!(hamming(h0, dhash(&img, w, r)) > 0);
    }
    #[test]
    fn regions_scale_with_frame() {
        let r = Regions::default().for_frame(960, 540);
        assert_eq!(r.task_list.x, 10);
        assert_eq!(r.task_list.w, 400);
        assert!(Regions::NAMES.iter().all(|n| Regions::default().get(n).is_some()));
    }
}
