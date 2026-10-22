/**
 * Meeting card: my monitor reads (Admin / Vitals / MIRA Doorlog) against this round's chat claims.
 * Admin count logic is ours (adminChecks: too many claimants / unaccounted icons); single-claim
 * contradictions for all three monitors come from the maps agent's mapChecks.monitorContradiction.
 */
import { useMemo } from 'react';
import { useMatch } from '../../../state/store';
import { adminChecks, monitorChecks } from '../../../engine/features/security';
import { pname } from '../../../engine/features/util';

const ICON: Record<'admin' | 'vitals' | 'doorLog', string> = { admin: '🗺', vitals: '💓', doorLog: '🚪' };

export function AdminCheckCard() {
  const m = useMatch(s => s.match);
  const lines = useMemo(() => {
    if (!m) return [];
    const round = m.phase.round;
    const ours = adminChecks(m).filter(c => c.round === round);
    const out = ours.map(c => ({ key: `a${c.readId}${c.room}`, icon: ICON.admin, text: c.line, bad: c.verdict === 'tooManyClaims', shaky: false, refs: c.refs }));
    for (const f of monitorChecks(m)) {
      const read = m.observations.find(o => o.id === f.readId);
      if (!read || read.stamp.round !== round) continue;
      // Our admin count check already names the same claim against the same read.
      if (f.kind === 'admin' && ours.some(c => c.readId === f.readId && f.claimIds.every(id => c.refs.includes(id)))) continue;
      out.push({ key: `m${f.readId}${f.claimIds.join('')}`, icon: ICON[f.kind], text: `${pname(m, f.player)}: ${f.check.text}`, bad: !f.check.shaky, shaky: f.check.shaky, refs: [f.readId, ...f.claimIds] });
    }
    return out;
  }, [m]);
  if (!m || lines.length === 0) return null;
  return (
    <div className="feat-card">
      <div className="feat-title">🖥 Monitor check</div>
      <ul className="feat-list">
        {lines.map(l => <li key={l.key} className={l.bad ? 'feat-bad' : 'feat-warn'} title={`refs: ${l.refs.join(', ')}${l.shaky ? ' · evidence, not proof' : ''}`}>{l.icon} {l.text}</li>)}
      </ul>
    </div>
  );
}
