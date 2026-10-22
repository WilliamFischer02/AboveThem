/** Meeting card: alive / dead / impostors left, what a wrong vote or a skip costs, votes needed. */
import { useMemo } from 'react';
import { useMatch } from '../../../state/store';
import { meetingMath } from '../../../engine/features/meetingMath';

export function MeetingMathCard() {
  const m = useMatch(s => s.match);
  const r = useMemo(() => (m ? meetingMath(m) : null), [m]);
  if (!m || !r) return null;
  const pill = r.danger === 'critical' ? ['bad', '⚠ CRITICAL VOTE'] : r.danger === 'careful' ? ['warn', 'careful'] : ['ok', 'room to skip'];
  const imp = r.impostors.min === r.impostors.max ? `${r.impostors.max}` : `${r.impostors.min}–${r.impostors.max}`;
  return (
    <details className="feat-card" open={r.danger === 'critical'}>
      <summary>
        <span className="feat-title">🧮 Count</span>
        <span><b>{r.alive}</b> alive · <b>{r.dead}</b> dead · <b className="feat-bad">{imp}</b> imp</span>
        <span className={`feat-pill ${pill[0]}`}>{pill[1]}</span>
        <span className="feat-sub right" title="Votes on one name that guarantee the ejection">{r.guaranteedEject} votes = out</span>
      </summary>
      <ul className="feat-list">
        {r.lines.map((l, i) => <li key={i} className={l.startsWith('CRITICAL') ? 'feat-bad' : undefined}>{l}</li>)}
      </ul>
      {r.impostors.why.length > 0 && <div className="feat-sub" style={{ marginTop: 3 }}>impostors: {r.impostors.why.join('; ')}</div>}
    </details>
  );
}
