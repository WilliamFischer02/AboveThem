/**
 * Anchored popover rendered in a portal at a fixed position, so no `overflow:hidden` /
 * scroll container can clip it and it never trails off the right edge of a thin window.
 *
 * Placement: below the anchor, left-aligned with it; clamped into the viewport with an
 * 8 px margin; flipped above the anchor when there is more room there; if it is taller than
 * both, it is pinned to the top margin and scrolls internally (max-height = viewport − 16).
 * Re-placed on resize, on any scroll (capture), and when its own size changes.
 * Closes on outside mousedown and on Escape.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { place, type Placement } from '../placement';


export function Popover({ anchorRef, onClose, children, width = 340, className = '' }: {
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Placement | null>(null);

  const update = useCallback(() => {
    const a = anchorRef.current, el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    const next = place(r, { w: el.offsetWidth, h: el.scrollHeight }, window.innerWidth, window.innerHeight, width);
    setPos(p => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.maxHeight === next.maxHeight ? p : next));
  }, [anchorRef, width]);

  useLayoutEffect(() => { update(); });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(update) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro?.disconnect();
    };
  }, [anchorRef, onClose, update]);

  return createPortal(
    <div
      ref={ref}
      className={`menu pop ${className}`}
      role="dialog"
      style={{
        position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999,
        width: pos?.width ?? width, maxHeight: pos?.maxHeight, overflowY: 'auto',
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
