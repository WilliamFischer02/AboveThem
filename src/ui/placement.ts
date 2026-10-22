/** Pure popover placement math (no DOM): anchor rect + popover size + viewport → fixed position. */
const MARGIN = 8;

export interface Placement { left: number; top: number; maxHeight: number; width: number }


export function place(anchor: { left: number; top: number; bottom: number; right: number }, size: { w: number; h: number }, vw: number, vh: number, preferredWidth: number): Placement {
  const width = Math.max(120, Math.min(preferredWidth, vw - MARGIN * 2));
  const left = Math.min(Math.max(anchor.left, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
  const below = vh - anchor.bottom - MARGIN - 4;
  const above = anchor.top - MARGIN - 4;
  const h = size.h;
  let top: number;
  if (h <= below) top = anchor.bottom + 4;
  else if (h <= above) top = anchor.top - 4 - h;
  else if (below >= above) top = Math.max(MARGIN, Math.min(anchor.bottom + 4, vh - MARGIN - h));
  else top = MARGIN;
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - Math.min(h, vh - MARGIN * 2)));
  return { left, top, width, maxHeight: vh - MARGIN * 2 };
}

