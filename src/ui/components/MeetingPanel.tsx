import { useMemo, useState } from 'react';
import type { ClaimType, EvidenceItem, MeetingScript, PlayerId, SuspectScore } from '../../types/game';
import { useMatch } from '../../state/store';
import { newId } from '../../state/events';
import { verifyClaims } from '../../engine/contradictions';
import { pushTally } from '../../engine/chatClaims';
import { PlayerIcon } from './Crewmate';
import { copyText } from '../clipboard';
import { headline } from '../../engine/headline';
import { HeadlineBar } from './HeadlineBar';
import { PairChip } from './PairChip';

function Why({ ids, evidence, note }: { ids: string[]; evidence: Map<string, EvidenceItem>; note?: string }) {
  const [open, setOpen] = useState(false);
  const items = ids.map(id => evidence.get(id)).filter((e): e is EvidenceItem => !!e);
  if (items.length === 0 && !note) return null;
  return (
    <>
      <button className="why-btn" onClick={() => setOpen(o => !o)}>{open ? '▾ why' : '▸ why'}</button>
      {open && (
        <div className="why">
          {note && <span>🗺 {note}</span>}
          {items.map(e => <span key={e.id}>{e.weight > 0 ? '+' : ''}{e.weight === 99 ? '∞' : e.weight === -99 ? '−∞' : e.weight.toFixed(1)} · {e.label}{e.shaky ? ' (unverified map data)' : ''}</span>)}
        </div>
      )}
    </>
  );
}

/** Copies exactly the sentence (no "to:" label, no prefix) so it can be pasted into the game chat as is. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const showToast = useMatch(s => s.showToast);
  return (
    <button className={`btn xs copy-btn ${done ? 'done' : ''}`} title="Copy to clipboard"
      onClick={async e => { e.stopPropagation(); const ok = await copyText(text); setDone(ok); if (!ok) showToast('Could not copy'); setTimeout(() => setDone(false), 1200); }}>
      {done ? '✓' : '⧉'}
    </button>
  );
}

/** One suggested line: the sentence, a copy button, and (optionally) who it is aimed at + why. */
function Line({ text, to, why, evidence, note }: { text: string; to?: string; why: string[]; evidence: Map<string, EvidenceItem>; note?: string }) {
  return (
    <div className="script-line">
      <div className="col">
        <span className="text">{to && <span className="to">{to}</span>}{text}</span>
        <Why ids={why} evidence={evidence} note={note} />
      </div>
      <CopyButton text={text} />
    </div>
  );
}

export function MeetingPanel({ script, scores, ghost = false }: { script: MeetingScript; scores: SuspectScore[]; ghost?: boolean }) {
  const match = useMatch(s => s.match)!;
  const evidence = useMemo(() => new Map(scores.flatMap(s => s.evidence).map(e => [e.id, e])), [scores]);
  const name = (id: string) => (id === 'all' ? 'everyone' : match.players[id]?.name ?? id);
  const target = script.vote.target;
  const hl = useMemo(() => headline(match, scores), [match, scores]);
  return (
    <section className="panel">
      {/* The vote recommendation lives inside the header (it IS the headline's vote — one source of truth). */}
      <HeadlineBar h={hl} scores={scores} big label={`Meeting ${script.meeting + 1}`} vote={script.vote} />
      <PairChip />
      <PushTally recommended={target} />
      {!ghost && <div className="col">
        {script.say.length > 0 && <h3>Say</h3>}
        {script.say.map((s, i) => <Line key={'s' + i} text={s.text} why={s.why} evidence={evidence} />)}
        {script.ask.length > 0 && <h3>Ask</h3>}
        {script.ask.map((q, i) => <Line key={'a' + i} text={q.text} to={q.to === 'all' ? undefined : name(q.to)} why={q.why} evidence={evidence} note={q.note} />)}
        {script.watch.length > 0 && (
          <details className="fold"><summary>Watch for</summary>
            {script.watch.map((w, i) => <div key={i} className="script-line"><span className="text small">{w}</span></div>)}
          </details>
        )}
      </div>}
      {!ghost && (
        <details className="fold" style={{ marginTop: 8 }}><summary>Log a claim / record the vote by hand</summary>
          <div className="manual-grid">
            <ClaimEntry />
            <VoteOutcome />
          </div>
        </details>
      )}
    </section>
  );
}

/** Who the room is pushing right now vs. what the evidence says. Updates live as chat is read. */
function PushTally({ recommended }: { recommended: string }) {
  const match = useMatch(s => s.match)!;
  const meeting = match.phase.meeting ?? 0;
  const tally = pushTally(match, meeting);
  if (tally.length === 0) return null;
  const name = (id: string) => match.players[id]?.name ?? id;
  return (
    <div className="col" style={{ gap: 4 }}>
      <h3>Room momentum</h3>
      {tally.slice(0, 4).map(t => {
        const agree = t.target === recommended;
        const skipRec = recommended === 'skip';
        return (
          <div key={t.target} className={`tl push ${agree ? 'agree' : skipRec ? 'neutral' : 'disagree'}`}>
            <span className="t"><PlayerIcon id={t.target} color={match.players[t.target]?.color ?? 'unknown'} size={22} /></span>
            <span><b>{name(t.target)}</b> · pushed by {t.accusers.map(name).join(', ') || '—'}{t.defenders.length ? ` · defended by ${t.defenders.map(name).join(', ')}` : ''}</span>
            <span className="small" style={{ fontWeight: 700 }}>{agree ? '✓ matches evidence' : skipRec ? 'no evidence either way' : '✗ evidence says otherwise'}</span>
          </div>
        );
      })}
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
  const mine = match.claims.filter(c => c.meeting === (match.phase.meeting ?? 0));
  return (
    <div className="col">
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
      {mine.length > 0 && (
        <div className="col" style={{ gap: 3 }}>
          {mine.map(c => (
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
    <div className="row">
      <span className="muted small">vote result:</span>
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
  );
}
