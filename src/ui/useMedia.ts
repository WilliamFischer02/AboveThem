import { useEffect, useState } from 'react';

/** Live `matchMedia` result (false where matchMedia is unavailable). */
export function useMedia(query: string): boolean {
  const get = () => { try { return window.matchMedia(query).matches; } catch { return false; } };
  const [on, setOn] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return; }
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return on;
}

/** Same breakpoint as the two-column layout in styles.css. */
export const WIDE = '(min-width: 820px)';
