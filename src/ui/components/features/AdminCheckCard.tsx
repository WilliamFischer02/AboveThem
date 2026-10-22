/** Meeting card: admin reads that clash with chat location claims (or icons nobody accounts for). */
import { useMemo } from 'react';
import { useMatch } from '../../../state/store';
import { adminChecks } from '../../../engine/features/security';

export function AdminCheckCard() {
  const m = useMatch(s => s.match);
  const checks = useMemo(() => (m ? adminChecks(m).filter(c => c.round === m.phase.round) : []), [m]);
  if (!m || checks.length === 0) return null;
  return (
    <div className="feat-card">
      <div className="feat-title">🗺 Admin check</div>
      <ul className="feat-list">
        {checks.map((c, i) => <li key={i} className={c.verdict === 'tooManyClaims' ? 'feat-bad' : 'feat-warn'} title={`refs: ${c.refs.join(', ')}`}>{c.line}</li>)}
      </ul>
    </div>
  );
}
