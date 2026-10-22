import { useMatch, describe } from '../../state/store';
import { effective, type MatchEvent } from '../../state/events';
import { fmt } from '../../engine/suspicion';

function stampOf(e: MatchEvent): string {
  if (e.kind === 'observation' || e.kind === 'claim') return `r${e.payload.stamp.round + 1} ${fmt(e.payload.stamp.t)}`;
  if (e.kind === 'phase') return `r${e.payload.round + 1}`;
  if (e.kind === 'ejection' || e.kind === 'vote') return `m${e.payload.meeting + 1}`;
  return '';
}

/** features: Admin / Vitals / Doorlog reads get a monitor marker (their text comes from store.describe). */
const isMonitor = (e: MatchEvent) => e.kind === 'observation' && (e.payload.type === 'adminRead' || e.payload.type === 'vitalsRead' || e.payload.type === 'doorLogRead');

const isHard = (e: MatchEvent) => e.kind === 'observation' && (e.payload.type === 'sawVent' || e.payload.type === 'sawKill' || e.payload.type === 'bodyFound');

export function Timeline() {
  const log = useMatch(s => s.log);
  const match = useMatch(s => s.match);
  const undo = useMatch(s => s.undo);
  if (!match) return null;
  const name = (id: string) => match.players[id]?.name ?? id;
  const room = (id: string) => match.map.rooms.find(r => r.id === id)?.name ?? id;
  const items = effective(log).filter(e => e.kind !== 'init' && e.kind !== 'settings' && e.kind !== 'player').reverse();
  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3>Timeline</h3>
        <button className="btn xs right" onClick={undo} disabled={items.length === 0}>Undo last</button>
      </div>
      <div className="timeline">
        {items.length === 0 && <div className="muted small">Nothing logged yet. Prefix + colour, then room.</div>}
        {items.map((e, i) => (
          <div key={items.length - i} className={`tl ${isHard(e) ? 'hard' : ''} ${e.kind === 'phase' ? 'phase' : ''}`}>
            <span className="t">{stampOf(e)}</span>
            <span>{isMonitor(e) ? '🖥 ' : ''}{prettify(describe(e), name, room)}</span>
            <span className="muted small">{e.kind === 'observation' ? e.payload.source : e.kind}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Replace raw ids in a describe() line with display names. */
function prettify(line: string, name: (id: string) => string, room: (id: string) => string): string {
  return line.replace(/\b[a-zA-Z][a-zA-Z0-9]*\b/g, w => {
    const n = name(w); if (n !== w) return n;
    const r = room(w); if (r !== w) return r;
    return w;
  });
}
