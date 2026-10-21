/**
 * In-game player palette: body colour + shadow colour per crewmate colour.
 * Values are the commonly published approximations of the game's palette
 * (docs/GAME_INTEGRATION.md §3.2); shadows are eyeballed from the sprites.
 * UI only — the OCR colour classifier lives in src-tauri/src/colors.rs.
 */
import type { PlayerColor } from '../types/game';

export interface Swatch { body: string; shadow: string; label: string; key: string }

export const PALETTE: Record<Exclude<PlayerColor, 'unknown'>, Swatch> = {
  red:    { body: '#C51111', shadow: '#7A0838', label: 'Red',    key: 'r' },
  blue:   { body: '#132ED1', shadow: '#09158E', label: 'Blue',   key: 'b' },
  green:  { body: '#117F2D', shadow: '#0A4D2E', label: 'Green',  key: 'g' },
  pink:   { body: '#ED54BA', shadow: '#AB2BAD', label: 'Pink',   key: 'p' },
  orange: { body: '#EF7D0D', shadow: '#B33E15', label: 'Orange', key: 'o' },
  yellow: { body: '#F5F557', shadow: '#C38822', label: 'Yellow', key: 'y' },
  black:  { body: '#3F474E', shadow: '#1E1F26', label: 'Black',  key: 'k' },
  white:  { body: '#D6E0F0', shadow: '#8394BF', label: 'White',  key: 'w' },
  purple: { body: '#6B2FBB', shadow: '#3B177C', label: 'Purple', key: 'u' },
  brown:  { body: '#71491E', shadow: '#5E2615', label: 'Brown',  key: 'n' },
  cyan:   { body: '#38FEDC', shadow: '#24A8BE', label: 'Cyan',   key: 'c' },
  lime:   { body: '#50EF39', shadow: '#15A742', label: 'Lime',   key: 'l' },
  maroon: { body: '#6B2B3C', shadow: '#410F1A', label: 'Maroon', key: 'm' },
  rose:   { body: '#ECC0D3', shadow: '#DE82A8', label: 'Rose',   key: 's' },
  banana: { body: '#F0E7A8', shadow: '#D2BC89', label: 'Banana', key: 'a' },
  gray:   { body: '#708496', shadow: '#465664', label: 'Gray',   key: 'e' },
  tan:    { body: '#928776', shadow: '#51413E', label: 'Tan',    key: 't' },
  coral:  { body: '#EC7578', shadow: '#B44362', label: 'Coral',  key: 'x' },
};

export const COLOR_IDS = Object.keys(PALETTE) as Array<keyof typeof PALETTE>;

export const swatch = (c: PlayerColor): Swatch =>
  c === 'unknown' ? { body: '#555', shadow: '#333', label: '?', key: '?' } : PALETTE[c];

/** Black or white text for legibility on a body colour. */
export function textOn(hex: string): '#000' | '#fff' {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? '#000' : '#fff';
}
