/** Compact "what you can check on this map" chips (engine/mapChecks.ts). Hidden when the map has no info. */
import type { MapData } from '../../types/game';
import { mapChecks } from '../../engine/mapChecks';

export function MapChecks({ map }: { map: MapData }) {
  const checks = mapChecks(map, { maxCovers: 2 });
  if (checks.length === 0) return null;
  return (
    <div className="map-checks" title="What you can walk to and check on this map">
      {checks.map(c => (
        <span key={c.kind} className={`mc mc-${c.kind}`} title={c.detail}>
          <span className="mc-i">{c.icon}</span>{c.label}
        </span>
      ))}
    </div>
  );
}
