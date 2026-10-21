import { useAuto } from '../App';

/** One line: is the game being read automatically right now? */
export function AutoStatus() {
  const auto = useAuto();
  if (!auto) return null;
  const w = auto.watcher;
  const m = w?.markers ?? {};
  const seen = Object.entries(m).filter(([, v]) => v).map(([k]) => k.replace('_', ' ')).join(', ');
  return (
    <div className="row small auto-status">
      <span className={auto.captureOk ? 'status-ok' : auto.captureOk === false ? 'status-err' : 'muted'}>
        {auto.captureOk ? '● reading the game' : auto.captureOk === false ? '○ Among Us window not found — open the game' : '… looking for the game'}
      </span>
      {w?.running && <span className="muted">phase {w.phase ?? '?'} · sees: {seen || 'nothing'} · OCR {w.last_ocr_ms} ms</span>}
      {auto.lobbyCode && <span className="muted">lobby {auto.lobbyCode}</span>}
      {auto.meGuessed && <span className="status-err">which crewmate is you? click it in the roster</span>}
    </div>
  );
}
