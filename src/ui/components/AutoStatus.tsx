import { useAuto } from '../App';
import { sinceLabel } from '../../input/eventHelpers';

/**
 * Only what the player must act on: the game window is missing, screen reading broke (and since when),
 * or we could not tell which crewmate is them.
 */
export function AutoStatus() {
  const auto = useAuto();
  if (!auto) return null;
  const h = auto.health;
  return (
    <div className="row small auto-status">
      {auto.captureOk === false && h?.captureLostAt != null && (
        <span className="status-err" title={h.captureError ?? undefined}>
          Capture lost since {sinceLabel(h.captureLostAt)} — retrying every 8 s.{h.captureError ? ` (${h.captureError.slice(0, 80)})` : ''}
        </span>
      )}
      {auto.captureOk === false && h?.captureLostAt == null && <span className="status-err">Among Us window not found. Open the game and this fills in by itself.</span>}
      {auto.captureOk === null && <span className="muted">looking for the game…</span>}
      {h?.watcherDownAt != null && <span className="status-err">Screen reader stopped since {sinceLabel(h.watcherDownAt)} ({h.watcherProblem ?? 'restarting'}) — manual input still works.</span>}
      {auto.meGuessed && <span className="status-err">Which crewmate is you? Click it in the roster.</span>}
    </div>
  );
}
