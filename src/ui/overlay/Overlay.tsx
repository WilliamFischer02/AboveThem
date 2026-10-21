/**
 * In-game overlay (second Tauri window, `?overlay=1`). Transparent, click-through.
 * It has no store of its own: the main window pushes `OverlaySnapshot`s over the
 * `overlay://state` event; the clock is computed locally from the snapshot.
 */
import { useEffect, useState } from 'react';
import type { OverlaySnapshot } from './snapshot';
import { Crewmate } from '../components/Crewmate';
import { fmt } from '../../engine/evidence';
import { keyLabel } from '../../input/hotkeys';

export function Overlay() {
  const [snap, setSnap] = useState<OverlaySnapshot | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let un: (() => void) | null = null;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      un = await listen<OverlaySnapshot>('overlay://state', e => setSnap(e.payload));
    })();
    const t = setInterval(() => tick(x => x + 1), 250);
    return () => { un?.(); clearInterval(t); };
  }, []);

  if (!snap) return <div className="ov"><div className="ov-box ov-dim">AboveThem overlay — waiting for the app…</div></div>;

  const now = Date.now();
  const t = snap.roundStartWall === null ? 0 : Math.max(0, ((snap.frozenAtWall ?? now) - snap.roundStartWall) / 1000);
  const phaseLabel = snap.phase === 'lobby' ? 'LOBBY' : snap.phase === 'gameOver' ? 'GAME OVER' : snap.phase.startsWith('meeting') ? 'MEETING' : snap.phase === 'ejection' ? 'VOTED' : 'ROUND';
  const pendingColor = snap.pending ? snap.colors.find(c => c.code === snap.pending) : undefined;
  return (
    <div className="ov">
      <div className="ov-box ov-clock">
        <span className="ov-time">R{snap.round + 1} {fmt(t)}</span>
        <span className="ov-phase">{phaseLabel}</span>
        <span className="ov-count">{snap.alive} alive · {snap.impLeft} imp</span>
      </div>

      {(snap.pending || snap.toast) && (
        <div className={`ov-box ov-toast ${snap.pending ? 'pending' : ''}`}>
          {snap.pending
            ? <><b>{pendingColor ? pendingColor.name : keyLabel(snap.pending)}</b> ▸ room / action?</>
            : snap.toast}
        </div>
      )}

      <div className="ov-box">
        <div className="ov-legend">
          {snap.slots.map(sl => (
            <span key={sl.key} className="ov-k" style={{ opacity: sl.dead ? 0.45 : 1 }}><kbd>{sl.key}</kbd><Crewmate color={sl.color} size={18} state={sl.dead ? 'dead' : 'alive'} />{sl.name}</span>
          ))}
        </div>
        <div className="ov-legend ov-rooms">
          {snap.rooms.map(r => <span key={r.key} className="ov-k"><kbd>{r.key}</kbd>{r.name}</span>)}
        </div>
        <div className="ov-legend ov-actions">
          <span className="ov-k"><kbd>.</kbd>with me</span><span className="ov-k"><kbd>v</kbd>visual</span><span className="ov-k"><kbd>!</kbd>vent</span>
          <span className="ov-k"><kbd>k</kbd>kill</span><span className="ov-k"><kbd>+</kbd>sus</span><span className="ov-k"><kbd>-</kbd>clear</span>
          <span className="ov-k"><kbd>␣</kbd>body</span><span className="ov-k"><kbd>/</kbd>me</span><span className="ov-k"><kbd>z</kbd>undo</span>
        </div>
        <div className="ov-hint">hold {snap.prefix} for both keys</div>
      </div>

      {snap.recent.length > 0 && (
        <div className="ov-box ov-recent">
          {snap.recent.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
