/**
 * Round card (crew, alive): my tasks as a route, dead-end tasks inside the no-kill window.
 * Works with screen reading off: tasks can be tapped in (MyTasksPicker) and the start room logged
 * with one tap (RoomChips) when neither the screen nor the map data gives one.
 */
import { useMemo, useState } from 'react';
import { useMatch } from '../../../state/store';
import { roundPlan } from '../../../engine/features/roundPlan';
import { fmt } from '../../../engine/evidence';
import { roomName } from '../../../engine/features/util';
import { MyTasksPicker, RoomChips } from './Pickers';

export function RoundPlanCard() {
  const m = useMatch(s => s.match);
  const round = useMatch(s => s.clock.round);
  const [editing, setEditing] = useState(false);
  const plan = useMemo(() => (m ? roundPlan(m, Math.max(0, round)) : null), [m, round]);
  if (!m || !plan || m.myRole === 'impostor') return null;
  const noTasks = !m.myTasks?.length;
  return (
    <details className="feat-card" open={m.phase.phase === 'roundStart' || editing}>
      <summary>
        <span className="feat-title">🧭 Route</span>
        {noTasks
          ? <span className="feat-sub">tap to enter your tasks</span>
          : <span className="feat-sub">{plan.stops.length} stops{plan.start ? ` from ${roomName(m, plan.start)}` : ''} · no kills before {fmt(plan.safeUntil)}</span>}
      </summary>
      {noTasks || editing ? <MyTasksPicker onDone={() => setEditing(false)} /> : (
        <>
          {!plan.start && <RoomChips label="Where are you? (starts the route)" />}
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
          {plan.tips.filter(t => !/Log your room/.test(t)).map((t, i) => <div key={i} className="feat-sub">• {t}</div>)}
          <button className="btn xs ghost" style={{ marginTop: 3 }} onClick={() => setEditing(true)}>edit my tasks</button>
        </>
      )}
    </details>
  );
}
