/**
 * Vote tracker: matches the results screen, where each voter's icon sits under the name they
 * voted. Tap the name (or Skip) once — it stays selected — then tap every icon under it.
 * One tap per voter. Disabled when the lobby has anonymous votes (the screen hides who voted whom).
 */
import { useMemo, useState } from 'react';
import type { PlayerId } from '../../../types/game';
import { useMatch } from '../../../state/store';
import { voteMatrix, votedMeetings, meetingVotes, bandwagons, votingPairs, makeVote, type Target } from '../../../engine/features/voteAnalysis';
import { pname } from '../../../engine/features/util';
import { swatch } from '../../palette';

export function VoteTracker({ open }: { open?: boolean }) {
  const m = useMatch(s => s.match);
  const dispatch = useMatch(s => s.dispatch);
  const [target, setTarget] = useState<Target | null>(null);
  const meeting = m?.phase.meeting ?? 0;
  const mx = useMemo(() => (m ? voteMatrix(m, meeting) : null), [m, meeting]);
  const notes = useMemo(() => (m ? [...votingPairs(m).map(p => p.line), ...bandwagons(m).map(b => b.line)] : []), [m]);
  if (!m || !mx) return null;
  if (m.settings.anonymousVotes) {
    return <div className="feat-card feat-sub">🗳 Votes are anonymous in this lobby — only counts are visible, so there is nothing to attribute.</div>;
  }
  const alive = Object.values(m.players).filter(p => p.status === 'alive');
  const voted = meetingVotes(m, meeting);
  const tap = (voter: PlayerId) => { if (target) dispatch({ kind: 'vote', payload: makeVote(m, meeting, voter, target) }); };
  const label = (t: Target) => (t === 'skip' ? 'Skip' : t === 'none' ? '—' : pname(m, t));
  const meetings = votedMeetings(m);
  const t = mx.tally;

  return (
    <details className="feat-card" open={open}>
      <summary>
        <span className="feat-title">🗳 Votes</span>
        <span className="feat-sub">{mx.rows.length}/{alive.length} recorded{mx.rows.length ? ` · ${t.ejected ? `${label(t.ejected)} out` : t.reason === 'tie' ? 'tie → nobody' : 'skip → nobody'}` : ''}</span>
      </summary>
      <div className="feat-sub" style={{ marginBottom: 3 }}>1) tap the name that got votes (stays selected) · 2) tap each icon under it</div>
      <div className="feat-grid">
        {[...alive.map(p => p.id as Target), 'skip' as Target].map(id => (
          <div key={id} className={`feat-tap ${target === id ? 'on' : ''}`} onClick={() => setTarget(id)}>
            {id !== 'skip' && <span className="feat-dot" style={{ background: swatch(m.players[id]?.color ?? 'unknown').body }} />}
            {label(id)}<span className="n">{t.counts[id] || ''}</span>
          </div>
        ))}
      </div>
      {target && (
        <>
          <div className="feat-sub" style={{ margin: '5px 0 3px' }}>Who voted <b>{label(target)}</b>?</div>
          <div className="feat-grid">
            {alive.map(p => (
              <div key={p.id} className={`feat-tap ${voted.get(p.id) === target ? 'on' : voted.has(p.id) ? 'dim' : ''}`} onClick={() => tap(p.id)} title={voted.has(p.id) ? `currently: ${label(voted.get(p.id)!)}` : 'not recorded yet'}>
                <span className="feat-dot" style={{ background: swatch(p.color).body }} />{p.isMe ? 'me' : p.name}
              </div>
            ))}
          </div>
        </>
      )}
      {meetings.length > 0 && (
        <table className="feat-table" style={{ marginTop: 6 }}>
          <thead><tr><th>voter</th>{meetings.map(mt => <th key={mt}>M{mt + 1}</th>)}</tr></thead>
          <tbody>
            {[...new Set(m.votes.filter(v => v.known).map(v => v.voter))].map(voter => (
              <tr key={voter}>
                <td>{voter === m.me ? 'me' : pname(m, voter)}</td>
                {meetings.map(mt => { const tg = meetingVotes(m, mt).get(voter); return <td key={mt}>{tg ? label(tg) : ''}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notes.length > 0 && <ul className="feat-list" style={{ marginTop: 4 }}>{notes.map((n, i) => <li key={i} className="feat-warn">{n}</li>)}</ul>}
    </details>
  );
}
