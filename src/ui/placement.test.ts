import { describe, expect, it } from 'vitest';
import { place } from './placement';

const anchor = (left: number, top: number, w = 160, h = 56) => ({ left, top, right: left + w, bottom: top + h });

describe('popover placement (bug 1: menu trailing off a thin window)', () => {
  it('fits a 380 px window: width shrinks to viewport − 16 and stays inside', () => {
    // card in the right column of a 380 px window
    const p = place(anchor(200, 100), { w: 340, h: 300 }, 380, 900, 340);
    expect(p.width).toBe(340);
    expect(p.left).toBe(380 - 340 - 8);
    expect(p.left + p.width).toBeLessThanOrEqual(380 - 8);
    expect(p.top).toBe(160); // below the anchor
  });

  it('never exceeds the viewport width even when the preferred width is wider', () => {
    const p = place(anchor(10, 10), { w: 500, h: 100 }, 300, 600, 500);
    expect(p.width).toBe(284);
    expect(p.left).toBe(8);
  });

  it('flips above the anchor when there is no room below', () => {
    const p = place(anchor(20, 700), { w: 300, h: 300 }, 400, 800, 300);
    expect(p.top).toBe(700 - 4 - 300);
  });

  it('pins to the top margin and scrolls when taller than both sides', () => {
    const p = place(anchor(20, 300), { w: 300, h: 2000 }, 400, 700, 300);
    expect(p.top).toBe(8);
    expect(p.maxHeight).toBe(684);
  });
});
