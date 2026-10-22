import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatch } from '../../state/store';
import { scoreAll } from '../../engine/suspicion';
import { buildMeetingScript } from '../../engine/meetingScript';
import { headline } from '../../engine/headline';
import { fmt } from '../../engine/suspicion';
import { Roster } from '../components/Roster';
import { Timeline } from '../components/Timeline';
import { MeetingPanel } from '../components/MeetingPanel';
import { Toast } from '../components/Toast';
import { ChatDock } from '../components/ChatDock';
import { HeadlineBar } from '../components/HeadlineBar';
import { Popover } from '../components/Popover';
import { useHotkeys, myRoomNow } from '../../input/useHotkeys';
import { buildConfig, keyLabel, ACTION_KEYS, FIRST_SPECIAL } from '../../input/hotkeys';
import { PALETTE, COLOR_IDS } from '../palette';
import { useOverlay } from '../overlay/useOverlay';
import { CapturePanel } from '../components/CapturePanel';
import { AutoStatus } from '../components/AutoStatus';
import { useAuto } from '../App';
import { GhostPanel } from '../components/GhostPanel';
import { ImpostorPanel } from '../components/ImpostorPanel';
import { usePref } from '../prefs';

function useNow(ms = 500) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

export function MatchScreen() {
  const match = useMatch(s => s.match)!;
  const stamp = useMatch(s => s.stamp);
  const diskError = useMatch(s => s.diskError);
  const hk = useHotkeys();
  const ov = useOverlay(hk.pending);
  const auto = useAuto();
  const [focus, setFocus] = usePref<boolean>('focusMode', false);
  useNow();

  const scores = useMemo(() => scoreAll(match), [match]);
  const hl = useMemo(() => headline(match, scores), [match, scores]);
  const meeting = match.phase.meeting ?? 0;
  const inMeeting = match.phase.phase === 'meetingDiscussion' || match.phase.phase === 'meetingVoting';
  const script = useMemo(() => (inMeeting ? buildMeetingScript(match, scores, meeting) : null), [match, scores, meeting, inMeeting]);
  const st = stamp();
  const phase = match.phase.phase;
  const ghost = match.players[match.me]?.status !== 'alive';
  const impostor = match.myRole === 'impostor';
  const myRoomId = myRoomNow(match);
  const myRoom = myRoomId ? match.map.rooms.find(r => r.id === myRoomId)?.name ?? myRoomId : null;
  const outcome = match.phase.outcome;
  const playing = phase !== 'lobby' && phase !== 'gameOver';
  const inRound = phase === 'round' || phase === 'roundStart' || phase === 'ejection';
  // Screen reading is not driving phases → keep the manual phase buttons one click away (fail soft).
  const manualPhases = !auto || auto.captureOk !== true;

  // Phase pill: the game's own colours — teal/red role reveal, blue victory, red defeat.
  const pill = phase === 'lobby' ? ['lobby', '⌂ LOBBY']
    : phase === 'gameOver' ? [outcome === 'victory' ? 'victory' : outcome === 'defeat' ? 'defeat' : 'over', outcome === 'victory' ? '★ VICTORY' : outcome === 'defeat' ? '✖ DEFEAT' : 'GAME OVER']
    : phase === 'roundStart' ? [impostor ? 'roleimp' : 'rolecrew', impostor ? 'IMPOSTOR' : 'CREWMATE']
    : inMeeting ? ['meeting', '🔔 MEETING'] : phase === 'ejection' ? ['ejection', '🗳 VOTED'] : ['round', '▶ ROUND'];

  return (
    <div className={`shell ${impostor ? 'impostor' : ''} ${focus ? 'focus' : ''}`}>
      <header className="topbar">
        <div className="brand" title="AboveThem">Above<span>Them</span></div>
        {impostor && <span className="badge imp role-pill wide-only">IMPOSTOR</span>}
        <span className={`phase-pill ${pill[0]}`} key={phase + (outcome ?? '')}>
          {pill[1]}
          {playing && <span className="clock">R{st.round + 1} {fmt(st.t)}</span>}
          {myRoom && <span className="pill-room">· {myRoom}</span>}
        </span>
        <span className="right" />
        {!ghost && playing && (
          <button className="btn xs ghost icon-btn" title="I just got killed: switch to ghost mode" onClick={() => useMatch.getState().dispatch({ kind: 'player', payload: { id: match.me, status: 'dead', aliveLockMeeting: undefined } })}>☠</button>
        )}
        <MoreMenu ov={ov} focus={focus} setFocus={setFocus} inMeeting={inMeeting} />
      </header>
      <div className={`content layout ${inRound || phase === 'lobby' ? 'with-dock-mini' : 'with-dock'} ${script || ghost || impostor ? 'has-side' : ''}`}>
        <div className="area-status">
          {auto && (auto.captureOk === false || auto.meGuessed) && <AutoStatus />}
          {diskError && <div className="status-line">disk: {diskError}</div>}
          {hk.error && <div className="status-line">hotkeys: {hk.error}</div>}
          {ov.error && <div className="status-line">overlay: {ov.error}</div>}
          {!focus && match.myTasks && match.myTasks.length > 0 && !ghost && (
            <div className="row small tasks-line">
              {match.myTasks.map((t, i) => <span key={i} className={`badge ${t.matched ? 'dim' : ''}`} title={t.room}>{t.name}{t.progress ? ' ' + t.progress : ''}</span>)}
            </div>
          )}
        </div>
        {!script && playing && !impostor && (
          <div className="area-head">
            <HeadlineBar h={hl} scores={scores} right={manualPhases ? <PhaseButtons inMeeting={inMeeting} /> : undefined} />
          </div>
        )}
        <div className="area-side">
          {ghost && !focus && <GhostPanel />}
          {impostor && !ghost && <ImpostorPanel scores={scores} inMeeting={inMeeting} />}
          {script && !impostor && <MeetingPanel script={script} scores={scores} ghost={ghost} />}
          {script && impostor && !ghost && <details className="fold panel tight"><summary>What the crew engine sees (their likely vote)</summary><MeetingPanel script={script} scores={scores} ghost={true} /></details>}
          {script && manualPhases && <div className="row"><PhaseButtons inMeeting={inMeeting} /></div>}
        </div>
        <div className="area-main">
          {!focus && <Tips />}
          {/* features */}
          <Roster scores={scores} />
        </div>
        {!focus && (
          <div className="area-folds">
            <details className="fold panel tight"><summary>Timeline</summary><Timeline /></details>
            <details className="fold panel tight"><summary>Screen reading</summary><CapturePanel knownNames={Object.values(match.players).map(p => p.name)} /></details>
            {!ghost && <CheatSheet />}
          </div>
        )}
      </div>
      <ChatDock mini={inRound || phase === 'lobby'} />
      <Toast pending={hk.pending} />
    </div>
  );
}

/** The manual phase fallbacks that matter right now (only shown when screen reading is off). */
function PhaseButtons({ inMeeting }: { inMeeting: boolean }) {
  const phase = useMatch(s => s.match!.phase.phase);
  const setPhase = useMatch(s => s.setPhase);
  return (
    <span className="phase-btns">
      {(phase === 'lobby' || phase === 'ejection' || phase === 'roundStart' || phase === 'gameOver') && <button className="btn xs primary" onClick={() => setPhase('round')}>▶ Round</button>}
      {phase === 'round' && <button className="btn xs danger" title="Body reported" onClick={() => setPhase('meetingDiscussion', { reason: 'body' })}>☠ Body</button>}
      {phase === 'round' && <button className="btn xs warn" title="Emergency meeting" onClick={() => setPhase('meetingDiscussion', { reason: 'button' })}>🔔 Meeting</button>}
      {inMeeting && <button className="btn xs" onClick={() => setPhase('ejection')}>🗳 Voting done</button>}
    </span>
  );
}

/** Everything that is not a primary action lives here: one "⋯" in the top bar. */
function MoreMenu({ ov, focus, setFocus, inMeeting }: { ov: ReturnType<typeof useOverlay>; focus: boolean; setFocus: (v: boolean) => void; inMeeting: boolean }) {
  const match = useMatch(s => s.match)!;
  const setPhase = useMatch(s => s.setPhase);
  const closeMatch = useMatch(s => s.closeMatch);
  const auto = useAuto();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const phase = match.phase.phase;
  const alive = Object.values(match.players).filter(p => p.status === 'alive').length;
  const impLeft = match.settings.impostorCount - match.ejections.filter(e => e.wasImpostor).length;
  const run = (f: () => void) => () => { f(); setOpen(false); };
  return (
    <>
      <button ref={ref} className={`btn xs ghost icon-btn ${open ? 'on' : ''}`} title="More: phases, overlay, focus mode, roster tools" onClick={() => setOpen(o => !o)}>⋯</button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={300}>
          <div className="menu-title">{match.map.name} · {alive} alive · {impLeft} imp left</div>
          <div className="menu-sec">Phase (if screen reading missed it)</div>
          <div className="menu-acts">
            {(phase === 'lobby' || phase === 'ejection' || phase === 'roundStart' || phase === 'gameOver') && <button className="btn sm primary" onClick={run(() => setPhase('round'))}>▶ Round start</button>}
            {phase === 'round' && <button className="btn sm danger" onClick={run(() => setPhase('meetingDiscussion', { reason: 'body' }))}>☠ Body reported</button>}
            {phase === 'round' && <button className="btn sm warn" onClick={run(() => setPhase('meetingDiscussion', { reason: 'button' }))}>🔔 Emergency</button>}
            {inMeeting && <button className="btn sm" onClick={run(() => setPhase('ejection'))}>🗳 Voting done</button>}
            {phase !== 'gameOver' && phase !== 'lobby' && <button className="btn sm ghost" onClick={run(() => setPhase('gameOver'))}>🏁 Game over</button>}
          </div>
          <div className="menu-sec">View</div>
          <div className="menu-acts">
            <button className={`btn sm ${focus ? 'primary' : ''}`} title="Hide everything but the headline and the roster" onClick={run(() => setFocus(!focus))}>◎ Focus {focus ? 'on' : 'off'}</button>
            <button className={`btn sm ${ov.visible ? 'primary' : ''}`} title="Transparent legend + clock on top of the game" onClick={run(ov.toggle)}>▣ Overlay {ov.visible ? 'on' : 'off'}</button>
          </div>
          <div className="menu-sec">Roster</div>
          <div className="menu-acts">
            <button className="btn sm" title="Re-read the vote grid and fix names (works while the meeting screen is up)" onClick={run(async () => { const msg = await auto?.rescanNames(); if (msg) useMatch.getState().showToast(msg); })}>↻ Rescan names</button>
            <button className="btn sm warn" title="Wrong people carried over: keep only me, refill from the lobby / next meeting" onClick={run(() => auto?.resetRoster())}>⟲ Reset roster</button>
          </div>
          <div className="menu-more">
            <button className="btn xs ghost" onClick={run(() => { try { localStorage.removeItem('abovethem.ui.tipsDone'); } catch { /* ignore */ } location.reload(); })}>? show tips again</button>
            <button className="btn xs ghost right" onClick={run(closeMatch)}>✕ Close match</button>
          </div>
        </Popover>
      )}
    </>
  );
}

const TIPS = [
  'Tap SUS or CLR — then optionally tap why. Wait 3 s or press Enter for a plain mark.',
  'Tap the % bar on a card to see why it says that.',
  'Tap a card for rooms, tasks, vents and kills. ⋯ (top right) has the rest.',
];

/** First-run coach marks: 3 tips max, dismissable, remembered. */
function Tips() {
  const [done, setDone] = usePref<boolean>('tipsDone', false);
  const [i, setI] = useState(0);
  if (done) return null;
  return (
    <div className="tip">
      <span className="tip-n">TIP {i + 1}/{TIPS.length}</span>
      <span className="tip-t">{TIPS[i]}</span>
      {i < TIPS.length - 1 ? <button className="btn xs" onClick={() => setI(i + 1)}>next</button> : <button className="btn xs primary" onClick={() => setDone(true)}>got it</button>}
      <button className="btn xs ghost" title="Don't show tips again" onClick={() => setDone(true)}>✕</button>
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
