/** Small helpers shared by the feature cards. */
import { useEffect, useState } from 'react';
import type { MatchState, PlayerId } from '../../../types/game';
import { swatch } from '../../palette';
import '../../features.css';

/** Re-render every `ms` (the round clock moves even when the store does not). */
export function useTick(ms = 500) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

/** Coloured dot + name for a player. */
export function Who({ m, id }: { m: MatchState; id: PlayerId }) {
  const p = m.players[id];
  return (
    <span className="feat-row" style={{ display: 'inline-flex', gap: 4 }}>
      <span className="feat-dot" style={{ background: swatch(p?.color ?? 'unknown').body }} />
      <span>{p?.name ?? id}</span>
    </span>
  );
}
