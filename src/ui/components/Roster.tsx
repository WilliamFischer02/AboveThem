import { useEffect, useRef, useState } from 'react';
import type { Player, PlayerColor, PlayerId, RoomId, SuspectScore } from '../../types/game';
import { useMatch } from '../../state/store';
import { Crewmate, PlayerIcon } from './Crewmate';
import { myRoomNow, roomName, withMeNow } from '../../input/useHotkeys';
import { PALETTE, COLOR_IDS } from '../palette';
import { useAuto } from '../App';
import { isTauri } from '../../state/persist';

type MenuMode = 'main' | 'seen' | 'victim' | 'kill' | 'color' | 'rename';

export function Roster({ scores }: { scores: SuspectScore[] }) {
  const match = useMatch(s => s.match);
  const dispatch = useMatch(s => s.dispatch);
  const auto = useAuto();
  const [open, setOpen] = useState<PlayerId | null>(null);
  if (!match) return null;
  if (auto?.meGuessed) {
    const pick = (id: PlayerId) => { dispatch({ kind: 'me', payload: { id } }); if (id !== 'me' && match.players['me']) dispatch({ kind: 'removePlayer', payload: { id: 'me' } }); auto.setMeGuessed(false); };
    return (
      <section className="panel">
        <h3>Which crewmate is you?</h3>
        <div className="roster">
          {Object.values(match.players).filter(p => p.id !== 'me').map(p => (
            <div key={p.id} className="chip" onClick={() => pick(p.id)}>
              <PlayerIcon id={p.id} color={p.color} size={46} state={p.status === 'alive' ? 'alive' : 'dead'} />
              <div className="name">{p.name}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }
  const byId = Object.fromEntries(scores.map(s => [s.player, s]));
  const rank = (p: Player) => (p.isMe ? -1e9 : p.status !== 'alive' ? 1e9 : -(byId[p.id]?.logOdds ?? 0));
  const players = Object.values(match.players).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const prime = scores.find(s => s.verdict === 'unknown' || s.verdict === 'softClear');
  const primeId = prime && prime.evidence.some(e => e.weight > 0) ? prime.player : null;
  const lastObs = match.observations[match.observations.length - 1];
  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3>Roster</h3>
        <span className="muted small right">click a crewmate to log</span>
      </div>
      <div className="roster">
        {players.map(p => (
          <Chip key={p.id} p={p} score={byId[p.id]} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onClose={() => setOpen(null)}
            prime={p.id === primeId} flashKey={lastObs && 'player' in lastObs && lastObs.player === p.id ? lastObs.id : lastObs && lastObs.type === 'sawKill' && lastObs.killer === p.id ? lastObs.id : null} />
        ))}
      </div>
    </section>
  );
}

function Chip({ p, score, open, onToggle, onClose, prime, flashKey }: { p: Player; score?: SuspectScore; open: boolean; onToggle: () => void; onClose: () => void; prime?: boolean; flashKey?: string | null }) {
  const match = useMatch(s => s.match)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open, onClose]);

  const withMe = !p.isMe && withMeNow(match, p.id);
  const verdict = p.isMe ? null : score?.verdict ?? (p.status === 'alive' ? 'unknown' : null);
  const hasEvidence = !!score && score.evidence.some(e => e.category !== 'hard' || e.weight < -50 || e.weight > 50);
  const pct = score && hasEvidence ? Math.round(score.probability * 100) : null;
  const cleared = verdict === 'certainCrew' || verdict === 'hardClear' || p.knownRole === 'crew';
  const state = p.status === 'alive' ? 'alive' : p.status === 'dead' ? 'dead' : p.status === 'ejected' ? 'ejected' : 'disconnected';
  return (
    <div ref={ref} className={`chip ${p.isMe ? 'me' : ''} ${open ? 'menu-open' : ''} ${p.status !== 'alive' ? 'dead' : ''} ${prime && p.status === 'alive' ? 'prime' : ''} ${cleared && !p.isMe && p.status === 'alive' ? 'cleared' : ''}`} onClick={onToggle} title={PALETTE[p.color as keyof typeof PALETTE]?.label}>
      {flashKey && <span className="flash" key={flashKey} />}
      <PlayerIcon id={p.id} color={p.color} size={46} state={state} />
      <div style={{ minWidth: 0 }}>
        <div className={`name ${p.name.length > 16 ? 'vlong' : p.name.length > 11 ? 'long' : ''} ${(p.isMe && match.myRole === 'impostor') || p.isPartner ? 'red-name' : ''}`} title={p.name}>{p.name}{p.isMe && <span className="muted small"> (me)</span>}</div>
        <div className="meta">
          {p.status !== 'alive' && <span className="badge dim">{p.status}</span>}
          {p.isPartner && <span className="badge imp">PARTNER</span>}
          {p.knownRole === 'impostor' && !p.isPartner && <span className="badge imp">IMPOSTOR</span>}
          {p.knownRole === 'crew' && !p.isMe && <span className="badge crew">CREW</span>}
          {verdict === 'certainImpostor' && p.knownRole !== 'impostor' && <span className="badge imp">IMPOSTOR</span>}
          {verdict === 'certainCrew' && p.knownRole !== 'crew' && <span className="badge crew">CLEAR</span>}
          {verdict === 'hardClear' && <span className="badge crew">CLEAR</span>}
          {verdict === 'softClear' && <span className="badge soft">SOFT</span>}
          {withMe && <span className="badge with">WITH ME</span>}
          {pct !== null && verdict !== 'certainCrew' && verdict !== 'certainImpostor' && <span className="pct">{pct}%</span>}
          {!p.isMe && <span className="key" title="hotkey: prefix + this key, then room">{p.slot !== undefined ? p.slot % 10 : PALETTE[p.color as keyof typeof PALETTE]?.key}</span>}
        </div>
      </div>
      {pct !== null && p.status === 'alive' && (
        <div className="bar"><i style={{ width: `${verdict === 'certainImpostor' ? 100 : verdict === 'certainCrew' || verdict === 'hardClear' ? 0 : pct}%` }} /></div>
      )}
      {!p.isMe && p.status === 'alive' && <QuickActions p={p} />}
      {open && <ChipMenu p={p} onClose={onClose} />}
    </div>
  );
}

/** One-click actions that cover ~80 % of what gets logged in a round. */
function QuickActions({ p }: { p: Player }) {
  const match = useMatch(s => s.match)!;
  const observe = useMatch(s => s.observe);
  const here = myRoomNow(match);
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); };
  const withMe = withMeNow(match, p.id);
  return (
    <div className="quick" onClick={stop} onMouseDown={stop}>
      <button className="btn xs" title={here ? `Seen in ${roomName(match, here)} (my room)` : 'Set your room first (prefix + / + room)'} disabled={!here}
        onClick={() => here && observe({ type: 'sighting', player: p.id, room: here }, `${p.name} in ${roomName(match, here)}`)}>👁 here</button>
      <button className={`btn xs ${withMe ? 'primary' : ''}`} onClick={() => observe({ type: 'withMe', player: p.id, room: here ?? match.map.rooms[0]?.id ?? 'unknown', on: !withMe }, !withMe ? `${p.name} with me` : `${p.name} left me`)}>{withMe ? '✓ with me' : 'with me'}</button>
      <button className="btn xs warn" onClick={() => observe({ type: 'manualMark', player: p.id, mark: 'sus' }, `${p.name} marked sus`)}>sus</button>
    </div>
  );
}

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
      <div className="colors" style={{ gridTemplateColumns: 'repeat(9, 1fr)' }}>
        {COLOR_IDS.map(c => (
          <div key={c} className={`color-pick ${p.color === c ? 'on' : ''}`} title={PALETTE[c].label} onClick={() => pick(c)} style={{ padding: 2 }}>
            <Crewmate color={c} size={24} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChipMenu({ p, onClose }: { p: Player; onClose: () => void }) {
  const match = useMatch(s => s.match)!;
  const observe = useMatch(s => s.observe);
  const dispatch = useMatch(s => s.dispatch);
  const [mode, setMode] = useState<MenuMode>('main');
  const [alone, setAlone] = useState(false);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const here = myRoomNow(match) ?? match.map.rooms[0]?.id ?? 'unknown';
  const done = () => { setMode('main'); onClose(); };
  const others = Object.values(match.players).filter(o => o.id !== p.id && o.status === 'alive');

  const rooms = (onPick: (r: RoomId) => void) => (
    <div className="grid">
      {match.map.rooms.map(r => (
        <button key={r.id} className="btn sm" onClick={() => onPick(r.id)}><span className="key">{r.key}</span>{r.name}</button>
      ))}
    </div>
  );

  if (p.isMe) {
    return (
      <div className="menu" onClick={stop} onMouseDown={stop}>
        <div className="muted small">Where am I?</div>
        {rooms(r => { observe({ type: 'myRoom', room: r }, `Me → ${roomName(match, r)}`); done(); })}
        <div className="row">
          <button className="btn sm" onClick={() => { dispatch({ kind: 'myRole', payload: { role: match.myRole === 'impostor' ? 'crew' : 'impostor' } }); done(); }}>
            I am {match.myRole === 'impostor' ? 'crew' : 'impostor'} this game
          </button>
        </div>
        <ColorPicker p={p} onDone={done} />
      </div>
    );
  }

  return (
    <div className="menu" onClick={stop} onMouseDown={stop}>
      {mode === 'main' && (
        <>
          <div className="muted small">{p.name} seen in… <label className="check small" style={{ marginLeft: 8 }}><input type="checkbox" checked={alone} onChange={e => setAlone(e.target.checked)} /> alone</label></div>
          {rooms(r => { observe({ type: 'sighting', player: p.id, room: r, alone }, `${p.name} in ${roomName(match, r)}${alone ? ' (alone)' : ''}`); done(); })}
          <div className="row">
            <button className="btn sm" onClick={() => { observe({ type: 'sawTask', player: p.id, room: here, visualConfirmed: true }, `${p.name} VISUAL task in ${roomName(match, here)}`); done(); }}>Saw visual task</button>
            <button className="btn sm" onClick={() => { observe({ type: 'sawTask', player: p.id, room: here, visualConfirmed: false }, `${p.name} at a task in ${roomName(match, here)}`); done(); }}>At a task</button>
          </div>
          <div className="row">
            <button className="btn sm danger" onClick={() => { observe({ type: 'sawVent', player: p.id, room: here }, `${p.name} VENTED`); done(); }}>Saw vent</button>
            <button className="btn sm danger" onClick={() => setMode('kill')}>Saw kill…</button>
          </div>
          <div className="row">
            <button className="btn sm warn" onClick={() => { observe({ type: 'manualMark', player: p.id, mark: 'sus' }, `${p.name} marked sus`); done(); }}>Mark sus</button>
            <button className="btn sm primary" onClick={() => { observe({ type: 'manualMark', player: p.id, mark: 'clear' }, `${p.name} marked clear`); done(); }}>Mark clear</button>
          </div>
          <div className="row">
            {p.status === 'alive' && <button className="btn sm ghost" onClick={() => setMode('victim')}>Found dead…</button>}
            {p.status === 'alive' && <button className="btn sm ghost" onClick={() => { dispatch({ kind: 'player', payload: { id: p.id, status: 'disconnected' } }); done(); }}>Disconnected</button>}
            {p.status !== 'alive' && <button className="btn sm ghost" onClick={() => { dispatch({ kind: 'player', payload: { id: p.id, status: 'alive' } }); done(); }}>Mark alive</button>}
            <button className="btn sm ghost" onClick={() => setMode('color')}><Crewmate color={p.color} size={16} /> colour…</button>
            <button className="btn sm ghost" onClick={() => setMode('rename')}>✎ rename</button>
            <button className="btn sm ghost" title="Not a real player (OCR junk)" onClick={() => { dispatch({ kind: 'removePlayer', payload: { id: p.id } }); done(); }}>✕ remove</button>
          </div>
          <div className="row">
            <span className="muted small">Chord: prefix + <span className="key">{PALETTE[p.color as keyof typeof PALETTE]?.key}</span> then room</span>
          </div>
        </>
      )}
      {mode === 'seen' && (
        <>
          <div className="muted small">{p.name} seen in…</div>
          {rooms(r => { observe({ type: 'sighting', player: p.id, room: r, alone }, `${p.name} in ${roomName(match, r)}${alone ? ' (alone)' : ''}`); done(); })}
          <div className="row">
            <label className="check small"><input type="checkbox" checked={alone} onChange={e => setAlone(e.target.checked)} /> alone</label>
            <button className="btn xs right" onClick={() => setMode('main')}>back</button>
          </div>
        </>
      )}
      {mode === 'victim' && (
        <>
          <div className="muted small">Body of {p.name} found in…</div>
          {rooms(r => { observe({ type: 'bodyFound', victim: p.id, room: r }, `Body: ${p.name} in ${roomName(match, r)}`); done(); })}
          <button className="btn xs" onClick={() => setMode('main')}>back</button>
        </>
      )}
      {mode === 'rename' && (
        <form className="row" onSubmit={e => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('n') as string).trim(); if (v) dispatch({ kind: 'player', payload: { id: p.id, name: v } }); done(); }}>
          <input className="input" name="n" defaultValue={p.name} autoFocus />
          <button className="btn sm primary" type="submit">Save</button>
          <button className="btn xs" type="button" onClick={() => setMode('main')}>back</button>
        </form>
      )}
      {mode === 'color' && (
        <>
          <ColorPicker p={p} onDone={done} />
          <button className="btn xs" onClick={() => setMode('main')}>back</button>
        </>
      )}
      {mode === 'kill' && (
        <>
          <div className="muted small">{p.name} killed whom? (in {roomName(match, here)})</div>
          <div className="grid">
            {others.map(o => (
              <button key={o.id} className="btn sm" onClick={() => { observe({ type: 'sawKill', killer: p.id, victim: o.id, room: here }, `${p.name} KILLED ${o.name}`); done(); }}>
                <Crewmate color={o.color} size={18} /> {o.name}
              </button>
            ))}
          </div>
          <button className="btn xs" onClick={() => setMode('main')}>back</button>
        </>
      )}
    </div>
  );
}
