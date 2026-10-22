/** Meeting card: each task claim (and visual-task clear) checked against the map, my list and what I watched. */
import { useMemo } from 'react';
import { useMatch } from '../../../state/store';
import { taskClaimChecks, type TaskVerdict } from '../../../engine/features/taskCheck';
import { copyText } from '../../clipboard';

const STYLE: Record<TaskVerdict, [string, string]> = {
  fake: ['bad', 'FAKE'], clearInvalid: ['bad', 'clear invalid'], suspect: ['warn', 'doubtful'],
  checkable: ['warn', 'ask'], confirmed: ['ok', 'confirmed'], plausible: ['', 'plausible'],
};

export function TaskClaimsCard() {
  const m = useMatch(s => s.match);
  const showToast = useMatch(s => s.showToast);
  const meeting = m?.phase.meeting ?? 0;
  const checks = useMemo(() => (m ? taskClaimChecks(m).filter(c => m.claims.find(x => x.id === c.claimId)?.meeting === meeting) : []), [m, meeting]);
  if (!m || checks.length === 0) return null;
  const bad = checks.filter(c => c.verdict === 'fake' || c.verdict === 'clearInvalid' || c.verdict === 'suspect').length;
  return (
    <details className="feat-card" open={bad > 0}>
      <summary>
        <span className="feat-title">🔧 Task claims</span>
        <span className="feat-sub">{checks.length} checked</span>
        {bad > 0 && <span className="feat-pill bad">{bad} don't add up</span>}
      </summary>
      {checks.map(c => (
        <div key={c.claimId} className="feat-line" title={`refs: ${c.refs.join(', ')}${c.check ? ` · check ${c.check}` : ''}`}>
          <span className={`feat-pill ${STYLE[c.verdict][0]}`}>{STYLE[c.verdict][1]}</span> {c.line}
          {c.ask && <button className="btn xs ghost" style={{ marginLeft: 4 }} title="Copy this question for chat" onClick={async () => { if (await copyText(c.ask!)) showToast(`Copied: ${c.ask}`); }}>ask ⧉</button>}
        </div>
      ))}
    </details>
  );
}
