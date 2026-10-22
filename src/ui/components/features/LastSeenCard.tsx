/** "Where was everyone": last room + time + company per player, with staleness and their claim. */
import { useMatch } from '../../../state/store';
import { lastSeenBoard, unplacedThisRound, type LastSeen } from '../../../engine/features/lastSeen';
import { fmt } from '../../../engine/evidence';
import { roomName, pname } from '../../../engine/features/util';
import { useTick, Who } from './shared';

const KIND: Record<NonNullable<LastSeen['kind']>, string> = {
  seen: 'seen', withMe: 'with me', withMeNow: 'WITH ME', leftMe: 'left me', task: 'task', vent: 'VENTED', kill: 'KILLED', reported: 'at report', dead: 'dead',
};

export function LastSeenCard({ open }: { open?: boolean }) {
  useTick(1000);
  const m = useMatch(s => s.match);
  const stamp = useMatch(s => s.stamp);
  if (!m) return null;
  const now = stamp();
  const board = lastSeenBoard(m, now);
  const unplaced = unplacedThisRound(board, now.round);
  const placed = board.filter(e => e.status === 'alive' && e.round === now.round).length;
  return (
    <details className="feat-card" open={open}>
      <summary>
        <span className="feat-title">👁 Last seen</span>
        <span className="feat-sub">{placed} placed this round{unplaced.length ? ` · ${unplaced.length} unplaced` : ''}</span>
      </summary>
      <table className="feat-table">
        <tbody>
          {board.map(e => (
            <tr key={e.player} className={`feat-stale-${e.staleness}`} title={e.ref ? `from ${e.ref}` : 'nothing logged'}>
              <td><Who m={m} id={e.player} />{e.status !== 'alive' && <span className="feat-sub"> ({e.status})</span>}</td>
              <td>{e.room ? <>{roomName(m, e.room)}{e.heading && <span className="feat-sub"> → {roomName(m, e.heading)}</span>}</> : <span className="feat-sub">never seen</span>}</td>
              <td className="feat-sub">
                {e.t !== null && (e.round === now.round ? `${fmt(e.t)}${e.ageSec ? ` (${Math.round(e.ageSec)}s ago)` : ''}` : `R${(e.round ?? 0) + 1}`)}
                {e.kind && <span> · {KIND[e.kind]}</span>}
              </td>
              <td className="feat-sub">{e.with.filter(w => w !== e.player).map(w => (w === m.me ? 'me' : pname(m, w))).join(', ')}</td>
              <td className="feat-sub" title={e.claim?.text}>{e.claim ? `says ${roomName(m, e.claim.room)}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unplaced.length > 0 && <div className="feat-sub" style={{ marginTop: 3 }}>Nobody I saw can place: {unplaced.map(p => pname(m, p)).join(', ')} — ask them first.</div>}
    </details>
  );
}
