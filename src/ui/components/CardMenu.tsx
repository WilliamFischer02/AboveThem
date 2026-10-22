/**
 * The menu behind a roster card (one click on the card). The room grid comes first because
 * "seen in <room>" is the most common log; rarer actions sit in one row of ghost buttons.
 * Rendered inside <Popover> (fixed, clamped), so it fits a 380 px window.
 */
import { useState } from 'react';
import type { Player, PlayerColor, RoomId } from '../../types/game';
import { useMatch } from '../../state/store';
import { Crewmate } from './Crewmate';
import { myRoomNow, roomName } from '../../input/useHotkeys';
import { PALETTE, COLOR_IDS } from '../palette';
import { useAuto } from '../App';
import { isTauri } from '../../state/persist';

type MenuMode = 'main' | 'victim' | 'kill' | 'color' | 'rename';

/** Adjust a player's colour (OCR guesses warm colours badly). Swaps with whoever already has it. */
function ColorPicker({ p, onDone }: { p: Player; onDone: () => void }) {
  const match = useMatch(s => s.match)!;
  const dispatch = useMatch(s => s.dispatch);
  const showToast = useMatch(s => s.showToast);
  const pick = (color: PlayerColor) => {
    if (color === p.color) { onDone(); return; }
    const other = Object.values(match.players).find(o => o.color === color && o.id !== p.id);
    if (other) dispatch({ kind: 'player', payload: { id: other.id, color: p.color, colorLocked: true } });
    dispatch({ kind: 'player', payload: { id: p.id, color, colorLocked: true } });
    // Teach the detector: this player's measured body pixels now mean `color`.
    const sample = useMatch.getState().bodySamples[p.id];
    if (sample && isTauri()) import('@tauri-apps/api/core').then(({ invoke }) => invoke('calibrate_color', { color, rgb: sample, lift: true })).then(() => showToast(`Colour detector calibrated: ${PALETTE[color as keyof typeof PALETTE].label}`)).catch(() => {});
    showToast(`${p.name} is ${PALETTE[color as keyof typeof PALETTE].label}${other ? `, ${other.name} is ${PALETTE[p.color as keyof typeof PALETTE]?.label ?? p.color}` : ''}`, true);
    onDone();
  };
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="muted small">{p.name}'s colour</div>
      <div className="colors color-grid">
        {COLOR_IDS.map(c => (
          <div key={c} className={`color-pick ${p.color === c ? 'on' : ''}`} title={PALETTE[c].label} onClick={() => pick(c)} style={{ padding: 2 }}>
            <Crewmate color={c} size={24} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardMenu({ p, onClose }: { p: Player; onClose: () => void }) {
  const match = useMatch(s => s.match)!;
  const auto = useAuto();
  const observe = useMatch(s => s.observe);
  const dispatch = useMatch(s => s.dispatch);
  const [mode, setMode] = useState<MenuMode>('main');
  const [alone, setAlone] = useState(false);
  const here = myRoomNow(match) ?? 'unknown'; // never invent a room (was rooms[0]); 'unknown' fails soft in the engine
  const done = () => { setMode('main'); onClose(); };
  const others = Object.values(match.players).filter(o => o.id !== p.id && o.status === 'alive');
  const back = <button className="btn xs" onClick={() => setMode('main')}>← back</button>;

  const rooms = (onPick: (r: RoomId) => void) => (
    <div className="grid">
      {match.map.rooms.map(r => (
        <button key={r.id} className="btn sm" onClick={() => onPick(r.id)}><span className="key">{r.key}</span>{r.name}</button>
      ))}
    </div>
  );

  if (p.isMe) {
    return (
      <div className="menu-body">
        <div className="menu-title">📍 Where am I?</div>
        {rooms(r => { observe({ type: 'myRoom', room: r }, `Me → ${roomName(match, r)}`); done(); })}
        <div className="row">
          <button className="btn sm ghost" onClick={() => { dispatch({ kind: 'myRole', payload: { role: match.myRole === 'impostor' ? 'crew' : 'impostor', locked: true } }); done(); }}>
            I am {match.myRole === 'impostor' ? 'crew' : 'impostor'} this game
          </button>
        </div>
        <ColorPicker p={p} onDone={done} />
      </div>
    );
  }

  return (
    <div className="menu-body">
      {mode === 'main' && (
        <>
          <div className="menu-title">👁 {p.name} seen in… <label className="check small right"><input type="checkbox" checked={alone} onChange={e => setAlone(e.target.checked)} /> alone</label></div>
          {rooms(r => { observe({ type: 'sighting', player: p.id, room: r, alone }, `${p.name} in ${roomName(match, r)}${alone ? ' (alone)' : ''}`); done(); })}
          <div className="menu-acts">
            <button className="btn sm primary" title={`Saw the visual task animation in ${roomName(match, here)}`} onClick={() => { observe({ type: 'sawTask', player: p.id, room: here, visualConfirmed: true }, `${p.name} VISUAL task in ${roomName(match, here)}`); done(); }}>✔ Visual task</button>
            <button className="btn sm" onClick={() => { observe({ type: 'sawTask', player: p.id, room: here, visualConfirmed: false }, `${p.name} at a task in ${roomName(match, here)}`); done(); }}>🔧 At a task</button>
            <button className="btn sm danger" onClick={() => { observe({ type: 'sawVent', player: p.id, room: here }, `${p.name} VENTED`); done(); }}>🕳 Vented</button>
            <button className="btn sm danger" onClick={() => setMode('kill')}>🔪 Killed…</button>
          </div>
          {(p.isPartner || p.knownRole === 'impostor' || match.myRole === 'impostor') && (
            <div className="row">
              {p.isPartner || p.knownRole === 'impostor'
                ? <button className="btn sm primary" title="The read was wrong: this player is not an impostor" onClick={() => { dispatch({ kind: 'player', payload: { id: p.id, isPartner: false, knownRole: match.myRole === 'impostor' ? 'crew' : 'unknown', roleLocked: true } }); done(); }}>{p.isPartner ? 'Not my partner — crew' : 'Not an impostor'}</button>
                : <button className="btn sm danger" onClick={() => { dispatch({ kind: 'player', payload: { id: p.id, isPartner: true, knownRole: 'impostor', roleLocked: true } }); done(); }}>This is my partner</button>}
            </div>
          )}
          <div className="menu-more">
            {p.status === 'alive' && <button className="btn xs ghost" onClick={() => setMode('victim')}>☠ found dead…</button>}
            {p.status === 'alive' && <button className="btn xs ghost" onClick={() => { dispatch({ kind: 'player', payload: { id: p.id, status: 'disconnected' } }); done(); }}>⏏ left</button>}
            {p.status !== 'alive' && <button className="btn xs ghost" onClick={() => { dispatch({ kind: 'player', payload: { id: p.id, status: 'alive' } }); done(); }}>↺ mark alive</button>}
            <button className="btn xs ghost" onClick={() => setMode('color')}><Crewmate color={p.color} size={14} /> colour</button>
            <button className="btn xs ghost" onClick={() => setMode('rename')}>✎ rename</button>
            <button className="btn xs ghost" title="Not a real player (OCR junk): never add this name again" onClick={() => { auto?.learnRemoved(p.name); dispatch({ kind: 'removePlayer', payload: { id: p.id } }); done(); }}>✕ remove</button>
            <span className="muted small right" title="Hotkey: hold the prefix, press this, then a room key">⌨ <span className="key">{PALETTE[p.color as keyof typeof PALETTE]?.key}</span></span>
          </div>
        </>
      )}
      {mode === 'victim' && (
        <>
          <div className="menu-title">☠ Body of {p.name} found in…</div>
          {rooms(r => { observe({ type: 'bodyFound', victim: p.id, room: r }, `Body: ${p.name} in ${roomName(match, r)}`); done(); })}
          {back}
        </>
      )}
      {mode === 'rename' && (
        <form className="row" onSubmit={e => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('n') as string).trim(); if (v && v !== p.name) { dispatch({ kind: 'player', payload: { id: p.id, name: v, nameLocked: true } }); auto?.learnRename(p.name, v); } done(); }}>
          <input className="input grow" name="n" defaultValue={p.name} autoFocus maxLength={24} />
          <button className="btn sm primary" type="submit">Save</button>
          {back}
        </form>
      )}
      {mode === 'color' && (
        <>
          <ColorPicker p={p} onDone={done} />
          {back}
        </>
      )}
      {mode === 'kill' && (
        <>
          <div className="menu-title">🔪 {p.name} killed whom? <span className="muted small">(in {roomName(match, here)})</span></div>
          <div className="grid">
            {others.map(o => (
              <button key={o.id} className="btn sm" onClick={() => { observe({ type: 'sawKill', killer: p.id, victim: o.id, room: here }, `${p.name} KILLED ${o.name}`); done(); }}>
                <Crewmate color={o.color} size={18} /> {o.name}
              </button>
            ))}
          </div>
          {back}
        </>
      )}
    </div>
  );
}
