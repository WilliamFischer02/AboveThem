import { useEffect, useMemo, useState } from 'react';
import { useMatch } from '../../state/store';
import { scoreAll } from '../../engine/suspicion';
import { buildMeetingScript } from '../../engine/meetingScript';
import { fmt } from '../../engine/suspicion';
import { Roster } from '../components/Roster';
import { Timeline } from '../components/Timeline';
import { MeetingPanel } from '../components/MeetingPanel';
import { Toast } from '../components/Toast';
import { ChatDock } from '../components/ChatDock';
import { useHotkeys, myRoomNow } from '../../input/useHotkeys';
import { buildConfig, keyLabel, ACTION_KEYS, FIRST_SPECIAL } from '../../input/hotkeys';
import { PALETTE, COLOR_IDS } from '../palette';
import { useOverlay } from '../overlay/useOverlay';
import { CapturePanel } from '../components/CapturePanel';
import { AutoStatus } from '../components/AutoStatus';
import { useAuto } from '../App';
import { GhostPanel } from '../components/GhostPanel';
import { ImpostorPanel } from '../components/ImpostorPanel';
import { FeatureSlots } from '../components/features/FeatureSlots'; // features

function useNow(ms = 500) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

export function MatchScreen() {
  const match = useMatch(s => s.match)!;
  const stamp = useMatch(s => s.stamp);
  const setPhase = useMatch(s => s.setPhase);
  const closeMatch = useMatch(s => s.closeMatch);
  const diskError = useMatch(s => s.diskError);
  const hk = useHotkeys();
  const ov = useOverlay(hk.pending);
  const auto = useAuto();
  useNow();

  const scores = useMemo(() => scoreAll(match), [match]);
  const meeting = match.phase.meeting ?? 0;
  const inMeeting = match.phase.phase === 'meetingDiscussion' || match.phase.phase === 'meetingVoting';
  const script = useMemo(() => (inMeeting ? buildMeetingScript(match, scores, meeting) : null), [match, scores, meeting, inMeeting]);
  const st = stamp();
  const phase = match.phase.phase;
  const ghost = match.players[match.me]?.status !== 'alive';
  const impostor = match.myRole === 'impostor';
  const myRoomId = myRoomNow(match);
  const myRoom = myRoomId ? match.map.rooms.find(r => r.id === myRoomId)?.name ?? myRoomId : null;
  const alive = Object.values(match.players).filter(p => p.status === 'alive').length;
  const impLeft = match.settings.impostorCount - match.ejections.filter(e => e.wasImpostor).length;
  const outcome = match.phase.outcome;

  // Phase pill: the game's own colours — teal/red role reveal, blue victory, red defeat.
  const pill = phase === 'lobby' ? ['lobby', '⌂ LOBBY']
    : phase === 'gameOver' ? [outcome === 'victory' ? 'victory' : outcome === 'defeat' ? 'defeat' : 'over', outcome === 'victory' ? '★ VICTORY' : outcome === 'defeat' ? '✖ DEFEAT' : 'GAME OVER']
    : phase === 'roundStart' ? [impostor ? 'roleimp' : 'rolecrew', impostor ? 'IMPOSTOR' : 'CREWMATE']
    : inMeeting ? ['meeting', '🔔 MEETING'] : phase === 'ejection' ? ['ejection', '🗳 VOTED'] : ['round', '▶ ROUND'];

  return (
    <div className={`shell ${impostor ? 'impostor' : ''}`}>
      <header className="topbar">
        <div className="brand">Above<span>Them</span></div>
        {impostor && <span className="badge imp role-pill">IMPOSTOR</span>}
        <span className="muted small">{match.map.name} · {alive} alive · {impLeft} imp</span>
        {!ghost && phase !== 'lobby' && phase !== 'gameOver' && (
          <button className="btn xs ghost" title="I just got killed: switch to ghost mode" onClick={() => useMatch.getState().dispatch({ kind: 'player', payload: { id: match.me, status: 'dead', aliveLockMeeting: undefined } })}>☠ I'm dead</button>
        )}
        <span className={`phase-pill right ${pill[0]}`} key={phase + (outcome ?? '')}>
          {pill[1]}
          {phase !== 'lobby' && phase !== 'gameOver' && <span className="clock">R{st.round + 1} {fmt(st.t)}</span>}
          {myRoom && <span className="muted small">· {myRoom}</span>}
        </span>
      </header>
      <div className="content with-dock">
        {auto && (auto.captureOk === false || auto.meGuessed) && <AutoStatus />}
        {diskError && <div className="status-line">disk: {diskError}</div>}
        {hk.error && <div className="status-line">hotkeys: {hk.error}</div>}
        {match.myTasks && match.myTasks.length > 0 && !ghost && (
          <div className="row small tasks-line">
            {match.myTasks.map((t, i) => <span key={i} className={`badge ${t.matched ? 'dim' : ''}`} title={t.room}>{t.name}{t.progress ? ' ' + t.progress : ''}</span>)}
          </div>
        )}
        {ghost && <GhostPanel />}
        {impostor && !ghost && <ImpostorPanel scores={scores} inMeeting={inMeeting} />}
        {script && !impostor && <MeetingPanel script={script} scores={scores} ghost={ghost} />}
        {script && impostor && !ghost && <details className="fold panel tight"><summary>What the crew engine sees (their likely vote)</summary><MeetingPanel script={script} scores={scores} ghost={true} /></details>}
        {/* features */}<FeatureSlots />
        <Roster scores={scores} />
        <details className="fold panel tight"><summary>Timeline</summary><Timeline /></details>
        <details className="fold panel tight"><summary>Controls</summary>
          <div className="toolrow" style={{ marginTop: 6 }}>
            {(phase === 'lobby' || phase === 'ejection' || phase === 'roundStart' || phase === 'gameOver') && <button className="btn sm primary" onClick={() => setPhase('round')}>▶ Round start</button>}
            {phase === 'round' && <button className="btn sm danger" onClick={() => setPhase('meetingDiscussion', { reason: 'body' })}>☠ Body reported</button>}
            {phase === 'round' && <button className="btn sm warn" onClick={() => setPhase('meetingDiscussion', { reason: 'button' })}>🔔 Emergency</button>}
            {inMeeting && <button className="btn sm" onClick={() => setPhase('ejection')}>Voting done</button>}
            {phase !== 'gameOver' && phase !== 'lobby' && <button className="btn ghost sm" onClick={() => setPhase('gameOver')}>Game over</button>}
            <button className="btn sm" title="Re-read the vote grid and fix names (works while the meeting screen is up)" onClick={async () => { const msg = await auto?.rescanNames(); if (msg) useMatch.getState().showToast(msg); }}>↻ Rescan names</button>
            <button className="btn sm warn" title="Wrong people carried over: keep only me, refill from the lobby / next meeting" onClick={() => auto?.resetRoster()}>⟲ Reset roster</button>
            <button className={`btn sm ${ov.visible ? 'primary' : ''}`} onClick={ov.toggle} title="Transparent legend + clock on top of the game">{ov.visible ? 'Overlay on' : 'Overlay'}</button>
            <button className="btn ghost sm" onClick={closeMatch}>Close match</button>
          </div>
          {ov.error && <div className="status-line">overlay: {ov.error}</div>}
        </details>
        <details className="fold panel tight"><summary>Screen reading</summary><CapturePanel knownNames={Object.values(match.players).map(p => p.name)} /></details>
        {!ghost && <CheatSheet />}
      </div>
      <ChatDock />
      <Toast pending={hk.pending} />
    </div>
  );
}

function CheatSheet() {
  const match = useMatch(s => s.match)!;
  const hk = useHotkeys();
  const cfg = buildConfig(match.map);
  return (
    <details className="cheat panel tight">
      <summary>Hotkeys ({cfg.prefix} + key, then key) · {hk.registered === 'global' ? 'global' : hk.registered === 'window' ? 'window only' : 'off'}</summary>
      <div className="cheat-grid">
        {COLOR_IDS.map(c => <span key={c}><span className="key">{PALETTE[c].key}</span> {PALETTE[c].label}</span>)}
      </div>
      <div className="cheat-grid">
        {match.map.rooms.map(r => <span key={r.id}><span className="key">{r.key}</span> {r.name}</span>)}
      </div>
      <div className="cheat-grid">
        {Object.entries(ACTION_KEYS).map(([k, a]) => <span key={k}><span className="key">{keyLabel(k)}</span> {a}</span>)}
        <span><span className="key">{keyLabel(FIRST_SPECIAL.body)}</span>+room: body</span>
        <span><span className="key">{keyLabel(FIRST_SPECIAL.myRoom)}</span>+room: my room</span>
        <span><span className="key">{keyLabel(FIRST_SPECIAL.undo)}</span> undo</span>
      </div>
    </details>
  );
}
