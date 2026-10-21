import type { CSSProperties } from 'react';
import type { PlayerColor } from '../../types/game';
import { swatch } from '../palette';
import { useMatch } from '../../state/store';

/** The player's real in-game headshot when one was captured, else the drawn crewmate. */
export function PlayerIcon({ id, color, size = 40, state = 'alive', title }: { id: string; color: PlayerColor; size?: number; state?: 'alive' | 'dead' | 'ejected' | 'disconnected'; title?: string }) {
  const avatar = useMatch(s => s.avatars[id]);
  if (!avatar) return <Crewmate color={color} size={size} state={state} title={title} />;
  const grey = state !== 'alive';
  return (
    <span className="avatar" style={{ width: size * 1.45, height: size, position: 'relative', display: 'inline-block' }} title={title}>
      <img src={avatar} alt={title ?? ''} style={{ width: size * 1.45, height: size, objectFit: 'cover', objectPosition: 'center', borderRadius: 10, border: '2px solid #0b0b0b', background: swatch(color).shadow, filter: grey ? 'grayscale(0.85) brightness(0.7)' : undefined, display: 'block' }} />
      {state === 'dead' && (
        <svg viewBox="0 0 64 64" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: size * 1.45, height: size }}>
          <g stroke="#E8232A" strokeWidth="7" strokeLinecap="round"><line x1="12" y1="12" x2="52" y2="52" /><line x1="52" y1="12" x2="12" y2="52" /></g>
        </svg>
      )}
    </span>
  );
}

/**
 * Our own drawing of the classic bean-shaped crewmate (no game assets are
 * shipped). Body + shadow come from the palette; `state` mirrors the vote grid:
 * alive = normal, dead = greyed with a red X, ejected = greyed + faded.
 */
export function Crewmate({
  color, size = 40, state = 'alive', style, title,
}: { color: PlayerColor; size?: number; state?: 'alive' | 'dead' | 'ejected' | 'disconnected'; style?: CSSProperties; title?: string }) {
  const s = swatch(color);
  const grey = state !== 'alive';
  return (
    <svg
      width={size} height={size} viewBox="0 0 64 64" style={{ display: 'block', ...style }}
      aria-label={title ?? s.label} role="img"
    >
      <g style={grey ? { filter: 'grayscale(0.85)', opacity: state === 'ejected' ? 0.35 : 0.55 } : undefined}>
        {/* backpack */}
        <rect x="7" y="22" width="13" height="24" rx="5" fill={s.shadow} stroke="#0b0b0b" strokeWidth="3" />
        {/* legs */}
        <path d="M20 50 L20 59 Q20 61 22 61 L30 61 L30 50 Z" fill={s.body} stroke="#0b0b0b" strokeWidth="3" strokeLinejoin="round" />
        <path d="M36 50 L36 59 Q36 61 38 61 L48 61 L48 50 Z" fill={s.body} stroke="#0b0b0b" strokeWidth="3" strokeLinejoin="round" />
        {/* body (bean) */}
        <path
          d="M18 20 C18 8 28 4 36 5 C50 6 54 18 54 28 L54 48 C54 54 50 56 46 56 L26 56 C20 56 18 52 18 46 Z"
          fill={s.body} stroke="#0b0b0b" strokeWidth="3" strokeLinejoin="round"
        />
        {/* shading on the lower-left of the body */}
        <path d="M21 30 C21 40 24 50 30 54 L26 54 C21 54 19 51 19 46 L19 34 Z" fill={s.shadow} opacity="0.85" />
        {/* visor */}
        <ellipse cx="42" cy="23" rx="13" ry="8.5" fill="#9ACAD5" stroke="#0b0b0b" strokeWidth="3" />
        <ellipse cx="47" cy="20.5" rx="5" ry="2.4" fill="#FFFFFF" opacity="0.9" />
        <path d="M31 26 C33 30 40 31 52 28 L52 29 C44 33 34 32 31 28 Z" fill="#5B8FA3" opacity="0.6" />
      </g>
      {state === 'dead' && (
        <g stroke="#E8232A" strokeWidth="6" strokeLinecap="round">
          <line x1="14" y1="14" x2="52" y2="52" />
          <line x1="52" y1="14" x2="14" y2="52" />
        </g>
      )}
      {state === 'ejected' && (
        <g stroke="#9aa0ad" strokeWidth="5" strokeLinecap="round" opacity="0.9">
          <line x1="14" y1="14" x2="52" y2="52" />
          <line x1="52" y1="14" x2="14" y2="52" />
        </g>
      )}
    </svg>
  );
}
