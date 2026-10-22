/**
 * Round card (task bar = Always only): one tap when the player you are watching finishes a task —
 * "bar moved" (soft clear) or "didn't move". Defaults to whoever you placed last; tap a name to switch.
 */
import { useState } from 'react';
import type { PlayerId } from '../../../types/game';
import { useMatch } from '../../../state/store';
import { watchedPlayer, taskBarObservation } from '../../../engine/features/taskCheck';
import { roomName, pname } from '../../../engine/features/util';
import { myRoomNow } from '../../../input/useHotkeys';
import { swatch } from '../../palette';
import { useTick } from './shared';
import { RoomChips } from './Pickers';

export function TaskBarCard() {
  useTick(1000);
  const m = useMatch(s => s.match);
  const stamp = useMatch(s => s.stamp);
  const observe = useMatch(s => s.observe);
  const [pick, setPick] = useState<PlayerId | null>(null);
  const [choosing, setChoosing] = useState(false);
  if (!m || m.settings.taskBarMode !== 'always') return null;
  const auto = watchedPlayer(m, stamp());
  const player = pick ?? auto?.player ?? null;
  const room = (player && auto?.player === player ? auto.room : null) ?? myRoomNow(m);
  const log = (moved: boolean) => {
    if (!player || !room) return;
    observe(taskBarObservation(player, room, moved), `${pname(m, player)}: task bar ${moved ? 'MOVED' : 'did not move'} (${roomName(m, room)})`);
    setPick(null);
  };
  return (
    <div className="feat-card" title="Multi-stage tasks only move the bar on their last stage; two people finishing at once muddies it.">
      <div className="feat-row">
        <span className="feat-title">▮ Task bar</span>
        <span className="feat-line" onClick={() => setChoosing(c => !c)} style={{ cursor: 'pointer' }} title="tap to pick who you are watching">
          {player ? <>watching <b>{pname(m, player)}</b>{room ? ` · ${roomName(m, room)}` : ' · log your room first'}</> : 'tap to pick who you watch'} ▾
        </span>
        <span className="right feat-row">
          <button className="btn xs primary" disabled={!player || !room} onClick={() => log(true)} title="Bar jumped as they finished (single-stage task)">moved ✓</button>
          <button className="btn xs danger" disabled={!player || !room} onClick={() => log(false)} title="They 'finished' and the bar stayed put">still ✗</button>
        </span>
      </div>
      {player && !room && !choosing && <RoomChips label="Which room are you both in?" />}
      {choosing && (
        <div className="feat-grid" style={{ marginTop: 4 }}>
          {Object.values(m.players).filter(p => !p.isMe && p.status === 'alive').map(p => (
            <div key={p.id} className={`feat-tap ${player === p.id ? 'on' : ''}`} onClick={() => { setPick(p.id); setChoosing(false); }}>
              <span className="feat-dot" style={{ background: swatch(p.color).body }} />{p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
