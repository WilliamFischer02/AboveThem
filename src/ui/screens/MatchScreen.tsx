import { useEffect, useMemo, useState } from 'react';
import { useMatch } from '../../state/store';
import { scoreAll } from '../../engine/suspicion';
import { buildMeetingScript } from '../../engine/meetingScript';
import { fmt } from '../../engine/suspicion';
import { Roster } from '../components/Roster';
import { Timeline } from '../components/Timeline';
import { MeetingPanel } from '../components/MeetingPanel';
import { Toast } from '../components/Toast';
import { useHotkeys } from '../../input/useHotkeys';
import { buildConfig, keyLabel, ACTION_KEYS, FIRST_SPECIAL } from '../../input/hotkeys';
import { PALETTE, COLOR_IDS } from '../palette';

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
  useNow();

  const scores = useMemo(() => scoreAll(match), [match]);
  const meeting = match.phase.meeting ?? 0;
  const inMeeting = match.phase.phase === 'meetingDiscussion' || match.phase.phase === 'meetingVoting';
  const script = useMemo(() => (inMeeting ? buildMeetingScript(match, scores, meeting) : null), [match, scores, meeting, inMeeting]);
  const st = stamp();
  const phase = match.phase.phase;
  const alive = Object.values(match.players).filter(p => p.status === 'alive').length;
  const impLeft = match.settings.impostorCount - match.ejections.filter(e => e.wasImpostor).length;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Above<span>Them</span></div>
        <span className="muted small">{match.map.name} · {alive} alive · {impLeft} imp</span>
        <span className="right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
          {phase === 'lobby' ? 'LOBBY' : phase === 'gameOver' ? 'GAME OVER' : `R${st.round + 1} ${fmt(st.t)}`}
          {inMeeting && <span className="muted"> · meeting</span>}
        </span>
      </header>
      <div className="content">
        <div className="row">
          {(phase === 'lobby' || phase === 'ejection' || phase === 'roundStart') && <button className="btn primary" onClick={() => setPhase('round')}>▶ Round start</button>}
          {phase === 'round' && <button className="btn danger" onClick={() => setPhase('meetingDiscussion', { reason: 'body' })}>☠ Body reported</button>}
          {phase === 'round' && <button className="btn warn" onClick={() => setPhase('meetingDiscussion', { reason: 'button' })}>🔔 Emergency meeting</button>}
          {inMeeting && <button className="btn" onClick={() => setPhase('ejection')}>Voting done</button>}
          {phase !== 'gameOver' && phase !== 'lobby' && <button className="btn ghost sm" onClick={() => setPhase('gameOver')}>Game over</button>}
          <button className="btn ghost sm right" onClick={closeMatch}>Close match</button>
        </div>
        <div className="row small">
          <span className={hk.registered === 'global' ? 'status-ok' : 'muted'}>
            hotkeys: {hk.registered === 'global' ? 'global (work while Among Us is focused)' : hk.registered === 'window' ? 'window only' : 'off'}
          </span>
          {hk.error && <span className="status-err">{hk.error}</span>}
          {diskError && <span className="status-err">disk: {diskError}</span>}
          {matchId && <span className="muted right">log: matches/{matchId}.ndjson</span>}
        </div>
        {script && <MeetingPanel script={script} scores={scores} />}
        <Roster scores={scores} />
        <Timeline />
        <CheatSheet />
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
