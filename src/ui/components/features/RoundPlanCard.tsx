/** Round card (crew, alive, task list read): my tasks as a route, dead-end tasks inside the no-kill window. */
import { useMemo } from 'react';
import { useMatch } from '../../../state/store';
import { roundPlan } from '../../../engine/features/roundPlan';
import { fmt } from '../../../engine/evidence';
import { roomName } from '../../../engine/features/util';

export function RoundPlanCard() {
  const m = useMatch(s => s.match);
  const round = useMatch(s => s.clock.round);
  const plan = useMemo(() => (m ? roundPlan(m, Math.max(0, round)) : null), [m, round]);
  if (!m || !plan || m.myRole === 'impostor' || !m.myTasks?.length) return null;
  if (plan.stops.length === 0 && plan.unplaced.length === 0) return null;
  return (
    <details className="feat-card" open={m.phase.phase === 'roundStart'}>
      <summary>
        <span className="feat-title">🧭 Route</span>
        <span className="feat-sub">{plan.stops.length} stops{plan.start ? ` from ${roomName(m, plan.start)}` : ''} · no kills before {fmt(plan.safeUntil)}</span>
      </summary>
      <ol className="feat-list" style={{ paddingLeft: 18 }}>
        {plan.stops.map(s => (
          <li key={s.taskId} className={s.safe ? 'feat-ok' : undefined} title={`arrive ~${fmt(s.arrive)}, done ~${fmt(s.finish)}`}>
            {s.name} · {roomName(m, s.room)}{s.deadEnd && <span className="feat-sub"> (dead end{s.safe ? ', safe now' : ''})</span>}
            <span className="feat-sub"> ~{fmt(s.finish)}</span>
            {s.note && <div className="feat-sub">{s.note}</div>}
          </li>
        ))}
      </ol>
      {plan.unplaced.length > 0 && <div className="feat-sub">Location unknown: {plan.unplaced.join(', ')}</div>}
      {plan.tips.map((t, i) => <div key={i} className="feat-sub">• {t}</div>)}
    </details>
  );
}
