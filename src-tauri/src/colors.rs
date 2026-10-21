//! Player color classification by nearest palette entry in CIELAB.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

fn srgb_to_lab(rgb: [u8; 3]) -> [f32; 3] {
    let f = |c: u8| { let c = c as f32 / 255.0; if c > 0.04045 { ((c + 0.055) / 1.055).powf(2.4) } else { c / 12.92 } };
    let (r, g, b) = (f(rgb[0]), f(rgb[1]), f(rgb[2]));
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y =  r * 0.2126 + g * 0.7152 + b * 0.0722;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    let g = |t: f32| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (g(x), g(y), g(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// Nearest palette color and the ΔE distance. Callers should treat ΔE > ~18 as Unknown.
pub fn classify(rgb: [u8; 3]) -> (PlayerColor, f32) {
    let lab = srgb_to_lab(rgb);
    let mut best = (PlayerColor::Unknown, f32::MAX);
    for (c, p) in PALETTE {
        let l = srgb_to_lab(*p);
        let d = ((lab[0]-l[0]).powi(2) + (lab[1]-l[1]).powi(2) + (lab[2]-l[2]).powi(2)).sqrt();
        if d < best.1 { best = (*c, d); }
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
    fn shaded_red_is_still_red() {
        assert_eq!(classify([0xA0, 0x10, 0x10]).0, PlayerColor::Red);
    }
}
