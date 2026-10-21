import { useAuto } from '../App';

/** Only what the player must act on: the game window is missing, or we could not tell which crewmate is them. */
export function AutoStatus() {
  const auto = useAuto();
  if (!auto) return null;
  return (
    <div className="row small auto-status">
      {auto.captureOk === false && <span className="status-err">Among Us window not found. Open the game and this fills in by itself.</span>}
      {auto.captureOk === null && <span className="muted">looking for the game…</span>}
      {auto.meGuessed && <span className="status-err">Which crewmate is you? Click it in the roster.</span>}
    </div>
  );
}
