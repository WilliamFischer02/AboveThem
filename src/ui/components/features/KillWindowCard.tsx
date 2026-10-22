/** Meeting card: for each body this round, who could / could not have been at the body in the kill window. */
import { useMemo } from 'react';
import { useMatch } from '../../../state/store';
import { killWindows, doubleKills } from '../../../engine/features/killWindow';
import { fmt } from '../../../engine/evidence';
import { roomName } from '../../../engine/features/util';
import { Who } from './shared';

export function KillWindowCard() {
  const m = useMatch(s => s.match);
  const windows = useMemo(() => (m ? killWindows(m, m.phase.round) : []), [m]);
  const doubles = useMemo(() => (m ? doubleKills(m, windows) : []), [m, windows]);
  if (!m || windows.length === 0) return null;
  return (
    <>
      {doubles.map(d => <div key={d.a + d.b} className="feat-card feat-line feat-bad" title={`refs: ${d.refs.join(', ')}`}>⚔ {d.line}</div>)}
      {windows.map(w => (
        <details key={w.bodyId} className="feat-card" open>
          <summary>
            <span className="feat-title">☠ Kill window</span>
            <span><Who m={m} id={w.victim} /> · {roomName(m, w.room)} · <b>{fmt(w.lo)}–{fmt(w.hi)}</b></span>
            <span className="feat-pill bad" title="Players the window cannot rule out">{w.could.length} could</span>
            {w.couldNot.length > 0 && <span className="feat-pill ok" title="Physically could not have been at the body">{w.couldNot.length} could not</span>}
          </summary>
          <div className="feat-sub">
            from {w.lowerBy === 'lastSeenAlive' ? `last seen alive ${fmt(w.lo)}` : `kill cooldown (${fmt(w.lo)})`} to {w.upperBy === 'vitals' ? `vitals showed dead ${fmt(w.hi)}` : `report ${fmt(w.hi)}`}
          </div>
          <div className="feat-line" style={{ marginTop: 4 }}>
            <b className="feat-bad">Could have killed:</b>{' '}
            {w.could.length === 0 ? 'nobody I can place' : w.could.map((p, i) => (
              <span key={p.player} title={p.reasons.map(r => `${r.label} [${r.refs.join(', ')}]`).join('\n') || 'nothing logged rules them out'}>
                {i > 0 && ', '}<Who m={m} id={p.player} />
                {p.openFraction < 0.999 && <span className="feat-sub"> ({p.feasible.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ')})</span>}
              </span>
            ))}
          </div>
          {w.couldNot.length > 0 && (
            <div className="feat-line">
              <b className="feat-ok">Could not:</b>{' '}
              {w.couldNot.map((p, i) => (
                <span key={p.player} title={p.reasons.map(r => `[${r.refs.join(', ')}]`).join(' ')}>
                  {i > 0 && ', '}<Who m={m} id={p.player} /> <span className="feat-sub">({p.reasons.map(r => r.label).join('; ')})</span>
                </span>
              ))}
            </div>
          )}
        </details>
      ))}
    </>
  );
}
