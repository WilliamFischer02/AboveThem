import { useMemo, useState } from 'react';
import type { ClaimType, EvidenceItem, MeetingScript, PlayerId, SuspectScore } from '../../types/game';
import { useMatch } from '../../state/store';
import { newId } from '../../state/events';
import { verifyClaims } from '../../engine/contradictions';
import { Crewmate } from './Crewmate';

function Why({ ids, evidence }: { ids: string[]; evidence: Map<string, EvidenceItem> }) {
  const [open, setOpen] = useState(false);
  const items = ids.map(id => evidence.get(id)).filter((e): e is EvidenceItem => !!e);
  if (items.length === 0) return null;
  return (
    <>
      <button className="why-btn" onClick={() => setOpen(o => !o)}>{open ? '▾ why' : '▸ why'}</button>
      {open && (
        <div className="why">
          {items.map(e => <span key={e.id}>{e.weight > 0 ? '+' : ''}{e.weight === 99 ? '∞' : e.weight === -99 ? '−∞' : e.weight.toFixed(1)} · {e.label}{e.shaky ? ' (unverified map data)' : ''}</span>)}
        </div>
      )}
    </>
  );
}

export function MeetingPanel({ script, scores, ghost = false }: { script: MeetingScript; scores: SuspectScore[]; ghost?: boolean }) {
  const match = useMatch(s => s.match)!;
  const evidence = useMemo(() => new Map(scores.flatMap(s => s.evidence).map(e => [e.id, e])), [scores]);
  const name = (id: string) => (id === 'all' ? 'everyone' : match.players[id]?.name ?? id);
  const target = script.vote.target;
  return (
    <section className="panel">
      <h3>Meeting {script.meeting + 1}</h3>
      <div className="headline" style={{ marginBottom: 8 }}>{script.headline}</div>
      {ghost && <div className="muted small">You can't talk or vote. The ranking keeps updating from what you log; use it to pick your signal.</div>}
      {!ghost && <div className="col">
        <h3>Say</h3>
        {script.say.map((s, i) => <div key={i} className="script-line"><span className="text">{s.text}</span><Why ids={s.why} evidence={evidence} /></div>)}
        <h3>Ask</h3>
        {script.ask.map((q, i) => (
          <div key={i} className="script-line">
            <span className="text"><b>{name(q.to)}:</b> {q.text}</span>
            <Why ids={q.why} evidence={evidence} />
          </div>
        ))}
        <h3>Vote</h3>
        <div className={`vote-card ${target === 'skip' ? 'skip' : 'go'}`}>
          {target !== 'skip' && <Crewmate color={match.players[target]?.color ?? 'unknown'} size={40} />}
          <div className="col" style={{ gap: 2 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{target === 'skip' ? 'SKIP' : `Vote ${name(target)}`} <span className="muted">({Math.round(script.vote.confidence * 100)}%)</span></div>
            <div className="small">{script.vote.reason}</div>
            {script.vote.alternative && <div className="small muted">alt: {name(script.vote.alternative)}</div>}
          </div>
        </div>
        {script.watch.length > 0 && (
          <>
            <h3>Watch for</h3>
            {script.watch.map((w, i) => <div key={i} className="script-line"><span className="text small">{w}</span></div>)}
          </>
        )}
      </div>}
      <ChatFeed />
      {!ghost && <ClaimEntry />}
      {!ghost && <VoteOutcome />}
    </section>
  );
}

function ChatFeed() {
  const match = useMatch(s => s.match)!;
  const meeting = match.phase.meeting ?? 0;
  const lines = match.chat.filter(c => c.meeting === meeting).slice(-8);
  if (lines.length === 0) return null;
  const name = (id: string) => match.players[id]?.name ?? (id === 'unknown' ? '?' : id);
  return (
    <div className="col" style={{ marginTop: 10 }}>
      <h3>Chat (read from screen)</h3>
      <div className="col" style={{ gap: 3 }}>
        {lines.map(c => {
          const claims = match.claims.filter(k => k.by === c.sender && k.meeting === c.meeting && k.text?.startsWith(c.original.slice(0, 20)) || false);
          return (
            <div key={c.id} className="tl">
              <span className="t">{name(c.sender)}</span>
              <span>{c.original}</span>
              <span className="muted small">{claims.map(k => k.type).join(' ') || ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CLAIM_TYPES: { t: ClaimType; label: string }[] = [
  { t: 'location', label: 'was in' }, { t: 'companion', label: 'was with' }, { t: 'task', label: 'did task' },
  { t: 'accusation', label: 'accuses' }, { t: 'clear', label: 'clears' }, { t: 'sighting', label: 'saw … in' },
];

function ClaimEntry() {
  const match = useMatch(s => s.match)!;
  const dispatch = useMatch(s => s.dispatch);
  const showToast = useMatch(s => s.showToast);
  const stamp = useMatch(s => s.stamp);
  const alive = Object.values(match.players).filter(p => p.status === 'alive');
  const [by, setBy] = useState<PlayerId>(alive.find(p => !p.isMe)?.id ?? '');
  const [type, setType] = useState<ClaimType>('location');
  const [room, setRoom] = useState(match.map.rooms[0]?.id ?? '');
  const [about, setAbout] = useState<PlayerId>('');
  const [task, setTask] = useState(match.map.tasks[0]?.id ?? '');
  const [t, setT] = useState('');
  const verdicts = useMemo(() => verifyClaims(match), [match]);
  const needsRoom = type === 'location' || type === 'task' || type === 'sighting';
  const needsAbout = type === 'companion' || type === 'accusation' || type === 'clear' || type === 'sighting';
  const submit = () => {
    if (!by) return;
    const secs = parseTime(t);
    dispatch({
      kind: 'claim',
      payload: {
        id: newId('c'), meeting: match.phase.meeting ?? 0, stamp: stamp(), by, type,
        room: needsRoom ? room : undefined, about: needsAbout && about ? about : undefined,
        taskId: type === 'task' ? task : undefined,
        timeWindow: secs !== null ? [Math.max(0, secs - 10), secs + 10] : undefined,
        verification: 'pending',
      },
    });
    showToast(`Logged claim by ${match.players[by].name}`, true);
  };
  return (
    <div className="col" style={{ marginTop: 10 }}>
      <h3>Log a chat claim</h3>
      <div className="row">
        <select className="input" value={by} onChange={e => setBy(e.target.value)}>
          {alive.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input" value={type} onChange={e => setType(e.target.value as ClaimType)}>
          {CLAIM_TYPES.map(c => <option key={c.t} value={c.t}>{c.label}</option>)}
        </select>
        {needsAbout && (
          <select className="input" value={about} onChange={e => setAbout(e.target.value)}>
            <option value="">— player —</option>
            {Object.values(match.players).filter(p => p.id !== by).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {type === 'task' && (
          <select className="input" value={task} onChange={e => setTask(e.target.value)}>
            {match.map.tasks.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
          </select>
        )}
        {needsRoom && (
          <select className="input" value={room} onChange={e => setRoom(e.target.value)}>
            {match.map.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <input className="input" style={{ width: 70 }} placeholder="t 0:45" value={t} onChange={e => setT(e.target.value)} />
        <button className="btn sm primary" onClick={submit}>Log</button>
      </div>
      {match.claims.filter(c => c.meeting === (match.phase.meeting ?? 0)).length > 0 && (
        <div className="col" style={{ gap: 3 }}>
          {match.claims.filter(c => c.meeting === (match.phase.meeting ?? 0)).map(c => (
            <div key={c.id} className="tl">
              <span className="t">{verdicts.get(c.id) === 'contradicted' ? '✗' : verdicts.get(c.id) === 'confirmed' ? '✓' : '…'}</span>
              <span>{match.players[c.by]?.name} {CLAIM_TYPES.find(x => x.t === c.type)?.label} {c.about ? match.players[c.about]?.name : ''} {c.taskId ? match.map.tasks.find(x => x.id === c.taskId)?.name : ''} {c.room ? match.map.rooms.find(r => r.id === c.room)?.name : ''}</span>
              <span className="muted small">{verdicts.get(c.id)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseTime(s: string): number | null {
  const m = s.trim().match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  const n = Number(s.trim());
  return s.trim() && Number.isFinite(n) ? n : null;
}

function VoteOutcome() {
  const match = useMatch(s => s.match)!;
  const dispatch = useMatch(s => s.dispatch);
  const setPhase = useMatch(s => s.setPhase);
  const showToast = useMatch(s => s.showToast);
  const alive = Object.values(match.players).filter(p => p.status === 'alive');
  const [ejected, setEjected] = useState<string>('skip');
  const [wasImp, setWasImp] = useState<'yes' | 'no' | 'unknown'>(match.settings.confirmEjectsOn ? 'no' : 'unknown');
  const meeting = match.phase.meeting ?? 0;
  const submit = () => {
    const player = ejected === 'skip' ? null : ejected;
    const wasImpostor = player && match.settings.confirmEjectsOn ? wasImp === 'yes' : null;
    dispatch({ kind: 'ejection', payload: { meeting, player, wasImpostor } });
    setPhase('ejection');
    showToast(player ? `${match.players[player].name} ejected${wasImpostor === true ? ' — impostor' : wasImpostor === false ? ' — not impostor' : ''}` : 'No one ejected', true);
  };
  return (
    <div className="col" style={{ marginTop: 10 }}>
      <h3>Vote result</h3>
      <div className="row">
        <select className="input" value={ejected} onChange={e => setEjected(e.target.value)}>
          <option value="skip">skipped / tie</option>
          {alive.map(p => <option key={p.id} value={p.id}>{p.name} ejected</option>)}
        </select>
        {ejected !== 'skip' && match.settings.confirmEjectsOn && (
          <select className="input" value={wasImp} onChange={e => setWasImp(e.target.value as 'yes' | 'no')}>
            <option value="no">was NOT the impostor</option>
            <option value="yes">WAS the impostor</option>
          </select>
        )}
        <button className="btn sm danger" onClick={submit}>Record</button>
      </div>
    </div>
  );
}
