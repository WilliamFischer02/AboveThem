//! Regions of interest in 1920x1080-normalised coordinates. See docs/GAME_INTEGRATION.md §3.
//! Values here are placeholders — the Calibrate screen overwrites them per resolution.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect { pub x: u32, pub y: u32, pub w: u32, pub h: u32 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Regions {
    pub task_list: Rect,
    pub role_card: Rect,
    pub vote_grid: Rect,
    pub chat_panel: Rect,
    pub chat_input: Rect,
    pub meeting_header: Rect,
    pub eject_text: Rect,
    pub map_name: Rect,
    pub sabotage_banner: Rect,
}

impl Default for Regions {
    fn default() -> Self {
        // UNVERIFIED placeholders. Confirm with screenshots in Phase 2.
        Self {
            task_list:       Rect { x: 20,   y: 20,  w: 420,  h: 320 },
            role_card:       Rect { x: 560,  y: 380, w: 800,  h: 320 },
            vote_grid:       Rect { x: 300,  y: 150, w: 1000, h: 700 },
            chat_panel:      Rect { x: 1300, y: 150, w: 560,  h: 700 },
            chat_input:      Rect { x: 1300, y: 860, w: 560,  h: 60 },
            meeting_header:  Rect { x: 560,  y: 80,  w: 800,  h: 70 },
            eject_text:      Rect { x: 360,  y: 480, w: 1200, h: 120 },
            map_name:        Rect { x: 760,  y: 40,  w: 400,  h: 60 },
            sabotage_banner: Rect { x: 560,  y: 120, w: 800,  h: 90 },
        }
    }
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
}
