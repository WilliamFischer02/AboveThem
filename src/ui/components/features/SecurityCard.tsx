/**
 * Round card: log what the security consoles show, in a tap or two.
 *  Admin  — tap a room to +1 (right-click −1), then "Log admin".
 *  Cams / door log — pick the spot once (sticky), then tap a player: a sighting there.
 *  Vitals — tap who shows dead, then "Log vitals" (also marks them dead in the roster).
 */
import { useState } from 'react';
import type { PlayerId, RoomId } from '../../../types/game';
import { useMatch } from '../../../state/store';
import { securityFor, adminObservation, remoteSighting, vitalsObservation, newlyDeadFromVitals, type CamSpot } from '../../../engine/features/security';
import { roomName, pname } from '../../../engine/features/util';
import { swatch } from '../../palette';

type Tab = 'admin' | 'cams' | 'vitals' | 'door';

export function SecurityCard() {
  const m = useMatch(s => s.match);
  const observe = useMatch(s => s.observe);
  const dispatch = useMatch(s => s.dispatch);
  const [tab, setTab] = useState<Tab | null>(null);
  const [counts, setCounts] = useState<Record<RoomId, number>>({});
  const [spot, setSpot] = useState<string | null>(null);
  const [dead, setDead] = useState<Set<PlayerId>>(new Set());
  if (!m) return null;
  const sec = securityFor(m);
  const rooms = m.map.rooms;
  const tabs: [Tab, string][] = [];
  if (sec.admin) tabs.push(['admin', '🗺 Admin']);
  if (sec.cams) tabs.push(['cams', '📹 Cams']);
  if (sec.vitals) tabs.push(['vitals', '💓 Vitals']);
  if (sec.doorLog) tabs.push(['door', '🚪 Door log']);
  if (tabs.length === 0) return null;
  const active = tab ?? tabs[0][0];
  const others = Object.values(m.players).filter(p => !p.isMe && p.status === 'alive');
  const spots: CamSpot[] = active === 'cams' && Array.isArray(sec.cams) ? sec.cams : rooms.map(r => ({ id: r.id, label: r.name, room: r.id }));
  const curSpot = spots.find(s => s.id === spot) ?? null;
  const noRooms = rooms.length === 0;

  const logAdmin = () => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    observe(adminObservation(counts), `Admin: ${Object.entries(counts).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${roomName(m, r)}`).join(', ') || 'empty'} (${total})`);
    setCounts({});
  };
  const logRemote = (p: PlayerId) => {
    if (!curSpot?.room) return;
    const o = remoteSighting(m, p, curSpot.room, active === 'door' ? 'doorLog' : 'cams', curSpot.label);
    if (o) observe(o, `${pname(m, p)} on ${active === 'door' ? 'door log' : 'cams'}: ${curSpot.label}`);
  };
  const logVitals = () => {
    const list = [...dead];
    for (const p of newlyDeadFromVitals(m, list)) dispatch({ kind: 'player', payload: { id: p, status: 'dead' } });
    observe(vitalsObservation(m, list), `Vitals: ${list.length ? list.map(p => pname(m, p)).join(', ') + ' dead' : 'everyone alive'}`);
    setDead(new Set());
  };

  return (
    <details className="feat-card">
      <summary>
        <span className="feat-title">🖥 Security</span>
        <span className="feat-sub">{tabs.map(t => t[1]).join(' · ')}{!sec._verified && ' (map data unverified)'}</span>
      </summary>
      <div className="feat-row" style={{ marginBottom: 5 }}>
        {tabs.map(([id, label]) => <button key={id} className={`btn xs ${active === id ? 'primary' : 'ghost'}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {active === 'admin' && (noRooms ? <div className="feat-sub">No room data for {m.map.name} yet.</div> : (
        <>
          <div className="feat-grid">
            {rooms.map(r => (
              <div key={r.id} className={`feat-tap ${counts[r.id] ? 'on' : ''}`} title="click +1 · right-click −1"
                onClick={() => setCounts(c => ({ ...c, [r.id]: (c[r.id] ?? 0) + 1 }))}
                onContextMenu={e => { e.preventDefault(); setCounts(c => ({ ...c, [r.id]: Math.max(0, (c[r.id] ?? 0) - 1) })); }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span><span className="n">{counts[r.id] || ''}</span>
              </div>
            ))}
          </div>
          <div className="feat-row" style={{ marginTop: 5 }}>
            <button className="btn sm primary" onClick={logAdmin}>Log admin</button>
            <button className="btn xs ghost" onClick={() => setCounts({})}>clear</button>
            <span className="feat-sub">icons are anonymous — logged as counts, checked against claims in the meeting</span>
          </div>
        </>
      ))}

      {(active === 'cams' || active === 'door') && (noRooms ? <div className="feat-sub">No room data for {m.map.name} yet — cams/door-log sightings need real rooms.</div> : (
        <>
          <div className="feat-sub" style={{ marginBottom: 3 }}>{curSpot ? <>Spot: <b>{curSpot.label}</b>{curSpot.room && curSpot.room !== curSpot.id ? ` (logged as ${roomName(m, curSpot.room)})` : ''} — now tap who you see</> : 'Pick where you are looking'}</div>
          <div className="feat-grid">
            {spots.map(s => <div key={s.id} className={`feat-tap ${spot === s.id ? 'on' : ''} ${s.room ? '' : 'dim'}`} onClick={() => s.room && setSpot(s.id)}>{s.label}</div>)}
          </div>
          {curSpot && (
            <div className="feat-grid" style={{ marginTop: 5 }}>
              {others.map(p => (
                <div key={p.id} className="feat-tap" onClick={() => logRemote(p.id)}>
                  <span className="feat-dot" style={{ background: swatch(p.color).body }} />{p.name}
                </div>
              ))}
            </div>
          )}
        </>
      ))}

      {active === 'vitals' && (
        <>
          <div className="feat-sub" style={{ marginBottom: 3 }}>Tap everyone vitals shows DEAD, then log (pins kill windows).</div>
          <div className="feat-grid">
            {Object.values(m.players).filter(p => !p.isMe).map(p => (
              <div key={p.id} className={`feat-tap ${dead.has(p.id) ? 'on' : ''} ${p.status !== 'alive' ? 'dim' : ''}`}
                onClick={() => setDead(d => { const n = new Set(d); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
                <span className="feat-dot" style={{ background: swatch(p.color).body }} />{p.name}{dead.has(p.id) && <span className="n">☠</span>}
              </div>
            ))}
          </div>
          <div className="feat-row" style={{ marginTop: 5 }}>
            <button className="btn sm primary" onClick={logVitals}>Log vitals</button>
          </div>
        </>
      )}
    </details>
  );
}
