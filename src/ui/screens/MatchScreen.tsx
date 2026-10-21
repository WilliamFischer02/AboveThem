import { useEffect, useMemo, useState } from 'react';
import { useMatch } from '../../state/store';
import { scoreAll } from '../../engine/suspicion';
import { buildMeetingScript } from '../../engine/meetingScript';
import { fmt } from '../../engine/suspicion';
import { Roster } from '../components/Roster';
import { Timeline } from '../components/Timeline';
import { MeetingPanel } from '../components/MeetingPanel';
import { Toast } from '../components/Toast';
import { useHotkeys, myRoomNow } from '../../input/useHotkeys';
import { buildConfig, keyLabel, ACTION_KEYS, FIRST_SPECIAL } from '../../input/hotkeys';
import { PALETTE, COLOR_IDS } from '../palette';
import { useOverlay } from '../overlay/useOverlay';
import { CapturePanel } from '../components/CapturePanel';
import { AutoStatus } from '../components/AutoStatus';
import { useAuto } from '../App';
import { GhostPanel } from '../components/GhostPanel';

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
  const matchId = useMatch(s => s.matchId);
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
  const myRoomId = myRoomNow(match);
  const myRoom = myRoomId ? match.map.rooms.find(r => r.id === myRoomId)?.name ?? myRoomId : null;
  const alive = Object.values(match.players).filter(p => p.status === 'alive').length;
  const impLeft = match.settings.impostorCount - match.ejections.filter(e => e.wasImpostor).length;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Above<span>Them</span></div>
        <span className="muted small">{match.map.name} · {alive} alive · {impLeft} imp</span>
        <span className={`phase-pill right ${phase === 'lobby' ? 'lobby' : phase === 'gameOver' ? 'over' : inMeeting ? 'meeting' : phase === 'ejection' ? 'ejection' : 'round'}`} key={phase}>
          {phase === 'lobby' ? '⌂ LOBBY' : phase === 'gameOver' ? 'GAME OVER' : inMeeting ? '🔔 MEETING' : phase === 'ejection' ? '🗳 VOTED' : '▶ ROUND'}
          {phase !== 'lobby' && phase !== 'gameOver' && <span className="clock">R{st.round + 1} {fmt(st.t)}</span>}
          {myRoom && <span className="muted small">· {myRoom}</span>}
        </span>
      </header>
      <div className="content">
        <div className="row">
          {(phase === 'lobby' || phase === 'ejection' || phase === 'roundStart') && <button className="btn primary" onClick={() => setPhase('round')}>▶ Round start</button>}
          {phase === 'round' && <button className="btn danger" onClick={() => setPhase('meetingDiscussion', { reason: 'body' })}>☠ Body reported</button>}
          {phase === 'round' && <button className="btn warn" onClick={() => setPhase('meetingDiscussion', { reason: 'button' })}>🔔 Emergency meeting</button>}
          {inMeeting && <button className="btn" onClick={() => setPhase('ejection')}>Voting done</button>}
          {phase !== 'gameOver' && phase !== 'lobby' && <button className="btn ghost sm" onClick={() => setPhase('gameOver')}>Game over</button>}
          <button className="btn sm right" title="Re-read the vote grid and fix names (works while the meeting screen is up)" onClick={async () => { const msg = await auto?.rescanNames(); if (msg) useMatch.getState().showToast(msg); }}>↻ Rescan names</button>
          <button className={`btn sm ${ov.visible ? 'primary' : ''}`} onClick={ov.toggle} title="Transparent legend + clock on top of the game">{ov.visible ? 'Overlay on' : 'Overlay'}</button>
          <button className="btn ghost sm" onClick={closeMatch}>Close match</button>
        </div>
        <AutoStatus />
        {match.myTasks && match.myTasks.length > 0 && (
          <div className="row small tasks-line">
            <span className="muted">my tasks:</span>
            {match.myTasks.map((t, i) => <span key={i} className={`badge ${t.matched ? 'dim' : ''}`} title={t.room}>{t.name}{t.progress ? ' ' + t.progress : ''}</span>)}
          </div>
        )}
        <div className="row small">
          <span className={hk.registered === 'global' ? 'status-ok' : 'muted'}>
            hotkeys: {hk.registered === 'global' ? 'global (work while Among Us is focused)' : hk.registered === 'window' ? 'window only' : 'off'}
          </span>
          {hk.error && <span className="status-err">{hk.error}</span>}
          {ov.error && <span className="status-err">overlay: {ov.error}</span>}
          {diskError && <span className="status-err">disk: {diskError}</span>}
          {matchId && <span className="muted right">log: matches/{matchId}.ndjson</span>}
        </div>
        {ghost && <GhostPanel />}
        {script && <MeetingPanel script={script} scores={scores} ghost={ghost} />}
        <Roster scores={scores} />
        <Timeline />
        <details className="fold panel tight"><summary>Screen reading (auto)</summary><CapturePanel knownNames={Object.values(match.players).map(p => p.name)} /></details>
        {!ghost && <CheatSheet />}
      </div>
      <Toast pending={hk.pending} />
    </div>
  );
}

function CheatSheet() {
  const match = useMatch(s => s.match)!;
  const cfg = buildConfig(match.map);
  return (
    <details className="cheat panel tight">
      <summary>Hotkeys ({cfg.prefix} + key, then key)</summary>
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
