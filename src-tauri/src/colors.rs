//! Player color classification by nearest palette entry in CIELAB.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PlayerColor {
    Red, Blue, Green, Pink, Orange, Yellow, Black, White, Purple, Brown, Cyan, Lime,
    Maroon, Rose, Banana, Gray, Tan, Coral, Unknown,
}

/// Approximate in-game sRGB values. Verify against screenshots (docs/GAME_INTEGRATION.md §3.2).
pub const PALETTE: &[(PlayerColor, [u8; 3])] = &[
    (PlayerColor::Red,    [0xC5, 0x11, 0x11]), (PlayerColor::Blue,   [0x13, 0x2E, 0xD1]),
    (PlayerColor::Green,  [0x11, 0x7F, 0x2D]), (PlayerColor::Pink,   [0xED, 0x54, 0xBA]),
    (PlayerColor::Orange, [0xEF, 0x7D, 0x0D]), (PlayerColor::Yellow, [0xF5, 0xF5, 0x57]),
    (PlayerColor::Black,  [0x3F, 0x47, 0x4E]), (PlayerColor::White,  [0xD6, 0xE0, 0xF0]),
    (PlayerColor::Purple, [0x6B, 0x2F, 0xBB]), (PlayerColor::Brown,  [0x71, 0x49, 0x1E]),
    (PlayerColor::Cyan,   [0x38, 0xFE, 0xDC]), (PlayerColor::Lime,   [0x50, 0xEF, 0x39]),
    (PlayerColor::Maroon, [0x6B, 0x2B, 0x3C]), (PlayerColor::Rose,   [0xEC, 0xC0, 0xD3]),
    (PlayerColor::Banana, [0xF0, 0xE7, 0xA8]), (PlayerColor::Gray,   [0x70, 0x84, 0x96]),
    (PlayerColor::Tan,    [0x92, 0x87, 0x76]), (PlayerColor::Coral,  [0xEC, 0x75, 0x78]),
];

/// Brightness-invariant colour direction: RGB divided by its max channel, plus saturation.
fn direction(rgb: [u8; 3]) -> ([f32; 3], f32) {
    let max = rgb.iter().copied().max().unwrap().max(1) as f32;
    let min = rgb.iter().copied().min().unwrap() as f32;
    ([rgb[0] as f32 / max, rgb[1] as f32 / max, rgb[2] as f32 / max], (max - min) / max)
}

/// Nearest palette colour and a distance (0 = exact; treat > ~35 as Unknown).
///
/// Sprites are shaded and vote cards are dimmed, so plain ΔE in Lab mislabels dark
/// bodies (dark blue → black/purple). Comparing the *direction* of the colour (RGB
/// normalised by its max channel) with a small saturation term is invariant to
/// uniform darkening and was validated on real vote-grid frames.
pub fn classify(rgb: [u8; 3]) -> (PlayerColor, f32) {
    let (d, s) = direction(rgb);
    let mut best = (PlayerColor::Unknown, f32::MAX);
    let obs_max = rgb.iter().copied().max().unwrap() as f32;
    for (c, p) in PALETTE {
        let (pd, ps) = direction(*p);
        let mut dist = ((d[0]-pd[0]).powi(2) + (d[1]-pd[1]).powi(2) + (d[2]-pd[2]).powi(2)).sqrt() * 100.0 + (s - ps).abs() * 30.0;
        // Shading/dimming only ever darkens: a pixel clearly brighter than the candidate cannot be
        // that candidate (separates brown/orange, maroon/red, black/gray/white, tan/banana).
        let pal_max = p.iter().copied().max().unwrap() as f32;
        let ratio = obs_max / pal_max;
        if ratio > 1.3 { dist += (ratio - 1.3) * 150.0; }
        if dist < best.1 { best = (*c, dist); }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_palette_matches() {
        for (c, p) in PALETTE { assert_eq!(classify(*p).0, *c); }
    }
    #[test]
    fn dimmed_and_shaded_bodies_keep_their_colour() {
        assert_eq!(classify([48, 96, 240]).0, PlayerColor::Blue);   // SHUSH's body on a real frame
        assert_eq!(classify([96, 240, 240]).0, PlayerColor::Cyan);  // Timetrast
        assert!(matches!(classify([240, 144, 72]).0, PlayerColor::Orange | PlayerColor::Coral)); // Waxscarce (icon shading)
        assert_eq!(classify([0x09, 0x15, 0x8E]).0, PlayerColor::Blue); // blue sprite shadow
        assert_eq!(classify([0x0A, 0x4D, 0x2E]).0, PlayerColor::Green); // green sprite shadow
        assert_eq!(classify([0x7A, 0x08, 0x38]).0, PlayerColor::Red);   // red sprite shadow (maroon-ish, still red)
    }
    #[test]
    fn shaded_red_is_still_red() {
        assert_eq!(classify([0xA0, 0x10, 0x10]).0, PlayerColor::Red);
    }
}
