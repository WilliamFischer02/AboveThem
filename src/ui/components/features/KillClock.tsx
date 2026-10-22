/** Round card: when can the first kill of this round happen; next kill of a killer I saw. */
import { useMatch } from '../../../state/store';
import { killClock } from '../../../engine/features/killWindow';
import { fmt } from '../../../engine/evidence';
import { useTick, Who } from './shared';

export function KillClock() {
  useTick(500);
  const m = useMatch(s => s.match);
  const stamp = useMatch(s => s.stamp);
  if (!m) return null;
  const now = stamp();
  const c = killClock(m, now);
  const imp = m.myRole === 'impostor';
  return (
    <div className="feat-card" title={`Kill cooldown ${c.cooldownSec}s this round${c.round === 0 ? ' (short first cooldown at game start — UNVERIFIED value)' : ''}. Restarts after every meeting.`}>
      <div className="feat-row">
        <span className="feat-title">⏱ {imp ? 'Kill ready' : 'Kills possible'}</span>
        {c.ready
          ? <span className="feat-big feat-bad">now <span className="feat-sub">since {fmt(c.firstKillAt)}</span></span>
          : <span className="feat-big feat-ok">in {fmt(c.readyIn)} <span className="feat-sub">at {fmt(c.firstKillAt)}</span></span>}
      </div>
      {c.seenKillers.map(k => (
        <div key={k.ref} className="feat-line">
          <Who m={m} id={k.player} /> killed at {fmt(k.killedAt)} → next kill no earlier than <b>{fmt(k.nextAt)}</b>
          {now.t >= k.nextAt ? <span className="feat-bad"> (ready)</span> : <span className="feat-ok"> (in {fmt(k.nextAt - now.t)})</span>}
        </div>
      ))}
    </div>
  );
}
