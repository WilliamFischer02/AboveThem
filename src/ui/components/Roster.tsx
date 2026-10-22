/**
 * Roster: one horizontal card per living player (like the game's vote grid), sorted by
 * suspicion or by grid order (toggle, remembered). Each card:
 *   headshot · name + mark badge · suspicion meter (tap = why) · SUS / CLR / 👁 here / 👥 with me
 * SUS and CLR open a 3-second "why?" strip: pick a reason (1 click), or click the same
 * button again / press Enter / wait, and the plain mark is logged. Esc cancels.
 * Clicking the card body opens the full menu (room grid, task, vent, kill, rename…).
 * Dead / ejected / disconnected players collapse to a strip of small chips at the bottom.
 * Keyboard: ↑/↓ move between cards, Enter opens the card menu, Esc closes it.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ManualMarkObs, Player, PlayerId, SuspectScore, UserMark } from '../../types/game';
import { useMatch } from '../../state/store';
import { PlayerIcon } from './Crewmate';
import { Popover } from './Popover';
import { CardMenu } from './CardMenu';
import { SusMeter } from './SusMeter';
import { myRoomNow, roomName, withMeNow } from '../../input/useHotkeys';
import { PALETTE } from '../palette';
import { useAuto } from '../App';
import { userMarks } from '../../engine/rules';
// MERGE: suspicion-core ships the real src/engine/marks.ts (same exports); this branch has a stub.
import { CLEAR_REASONS, SUS_REASONS, markObservation, markToast, reasonInfo } from '../../engine/marks';
import { usePref } from '../prefs';

type SusId = (typeof SUS_REASONS)[number]['id'];
type ClearId = (typeof CLEAR_REASONS)[number]['id'];
type Reason = SusId | ClearId;
type StripMode = 'sus' | 'clear';
interface Strip { player: PlayerId; mode: StripMode; plain: boolean; seq: number }

export const STRIP_MS = 3000;
export type RosterSort = 'sus' | 'grid';

export function Roster({ scores }: { scores: SuspectScore[] }) {
  const match = useMatch(s => s.match);
  const dispatch = useMatch(s => s.dispatch);
  const observe = useMatch(s => s.observe);
  const auto = useAuto();
  const [open, setOpen] = useState<PlayerId | null>(null);
  const [sort, setSort] = usePref<RosterSort>('rosterSort', 'sus');
  const [strip, setStrip] = useState<Strip | null>(null);
  const stripRef = useRef<Strip | null>(null);
  stripRef.current = strip;
  const seq = useRef(0);

  const logMark = useCallback((player: PlayerId, mark: UserMark | 'neutral', reason?: Reason) => {
    const m = useMatch.getState().match;
    const name = m?.players[player]?.name ?? player;
    observe(markObservation(player, mark, reason) as Parameters<typeof observe>[0], markToast(name, mark, reason));
  }, [observe]);

  /** Close the strip; if it was a pending plain mark, log it. */
  const settle = useCallback((commitPlain: boolean) => {
    const s = stripRef.current;
    if (!s) return;
    // The card may have been merged / removed (or the match rolled over) while the strip was open.
    if (commitPlain && s.plain && useMatch.getState().match?.players[s.player]) logMark(s.player, s.mode);
    stripRef.current = null;
    setStrip(null);
  }, [logMark]);

  const openStrip = useCallback((player: PlayerId, mode: StripMode, plain: boolean) => {
    const cur = stripRef.current;
    if (cur && cur.player === player && cur.mode === mode) { settle(true); return; } // same button again = plain mark
    if (cur) settle(cur.player !== player); // another card: the pending mark counts; same card, other button: it was a misclick
    const next = { player, mode, plain, seq: ++seq.current };
    stripRef.current = next;
    setStrip(next);
  }, [settle]);

  // A new match (roll-over at a role card / lobby) drops a pending strip instead of committing it into the new game.
  const matchId = useMatch(s => s.matchId);
  useEffect(() => { stripRef.current = null; setStrip(null); }, [matchId]);

  // 3-second timeout → plain mark. Keyed on seq so a new strip restarts the clock.
  useEffect(() => {
    if (!strip) return;
    const t = setTimeout(() => settle(true), STRIP_MS);
    return () => clearTimeout(t);
  }, [strip?.seq, settle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter = plain mark now; Esc = cancel; 1-9 = pick that reason.
  useEffect(() => {
    if (!strip) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Enter') { e.preventDefault(); settle(true); }
      else if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      else if (/^[1-9]$/.test(e.key)) {
        const list = strip.mode === 'sus' ? SUS_REASONS : CLEAR_REASONS;
        const r = list[Number(e.key) - 1];
        if (r) { e.preventDefault(); stripRef.current = null; setStrip(null); logMark(strip.player, strip.mode, r.id); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [strip, settle, logMark]);

  if (!match) return null;

  if (auto?.meGuessed) {
    const pick = (id: PlayerId) => { dispatch({ kind: 'me', payload: { id } }); if (id !== 'me' && match.players['me']) dispatch({ kind: 'removePlayer', payload: { id: 'me' } }); auto.setMeGuessed(false); };
    return (
      <section className="panel">
        <h3>Which crewmate is you?</h3>
        <div className="gone-strip pick">
          {Object.values(match.players).filter(p => p.id !== 'me').map(p => (
            <button key={p.id} className="gone-chip big" onClick={() => pick(p.id)}>
              <PlayerIcon id={p.id} color={p.color} size={40} state={p.status === 'alive' ? 'alive' : 'dead'} />
              <span className="n">{p.name}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  const byId = Object.fromEntries(scores.map(s => [s.player, s]));
  const all = Object.values(match.players);
  const alive = all.filter(p => p.status === 'alive');
  const gone = all.filter(p => p.status !== 'alive');
  const susRank = (p: Player) => (p.isMe ? -1e9 : -(byId[p.id]?.logOdds ?? -50));
  const gridRank = (p: Player) => (p.slot ?? 99);
  const ordered = [...alive].sort((a, b) =>
    (sort === 'sus' ? susRank(a) - susRank(b) : gridRank(a) - gridRank(b)) || a.name.localeCompare(b.name));
  const prime = scores.find(s => s.verdict === 'unknown' || s.verdict === 'softClear');
  const primeId = prime && prime.evidence.some(e => e.weight > 0) && prime.probability >= 0.45 ? prime.player : null;
  const lastObs = match.observations[match.observations.length - 1];
  const marks = userMarks(match);
  const flashFor = (id: PlayerId) => (lastObs && 'player' in lastObs && lastObs.player === id ? lastObs.id : lastObs && lastObs.type === 'sawKill' && lastObs.killer === id ? lastObs.id : null);
  const toggle = (id: PlayerId) => setOpen(o => (o === id ? null : id));
  const close = () => setOpen(null);

  return (
    <section className="panel roster-panel">
      <div className="roster-head">
        <h3>Crew<ConfidenceDot /></h3>
        <span className="muted small" title={match.rosterSize ? `${match.rosterSize} players on screen (${match.rosterSizeSource === 'grid' ? 'vote grid' : 'lobby counter'})` : 'alive players'}>
          {alive.length} alive{match.rosterSize ? ` · ${all.filter(p => p.status !== 'disconnected').length}/${match.rosterSize}` : ''}
        </span>
        <button className="btn xs ghost right sort-btn" title={sort === 'sus' ? 'Sorted by suspicion — click for vote-grid order' : 'Vote-grid order — click to sort by suspicion'}
          onClick={() => setSort(sort === 'sus' ? 'grid' : 'sus')}>{sort === 'sus' ? '⇅ most sus' : '⇅ grid'}</button>
      </div>
      <div className="roster2" role="list">
        {ordered.map(p => {
          const mk = marks.get(p.id);
          const obs = mk ? (match.observations.find(o => o.id === mk.id) as (ManualMarkObs & { reason?: string }) | undefined) : undefined;
          return (
            <Card key={p.id} p={p} score={byId[p.id]} mark={mk?.mark} reason={obs?.reason}
              open={open === p.id} onToggle={() => toggle(p.id)} onClose={close}
              prime={p.id === primeId} flashKey={flashFor(p.id)}
              strip={strip && strip.player === p.id ? strip : null}
              onMarkButton={(mode) => {
                const cur = mk?.mark;
                const already = mode === 'sus' ? cur === 'sus' : cur === 'clear' || cur === 'hardClear';
                openStrip(p.id, mode, !already);
              }}
              onReason={(r) => { const s = stripRef.current; stripRef.current = null; setStrip(null); if (s) logMark(s.player, s.mode === 'clear' && mk?.mark === 'hardClear' ? 'hardClear' : s.mode, r); }}
              onHard={() => { stripRef.current = null; setStrip(null); logMark(p.id, 'hardClear'); }}
              onUnmark={() => { stripRef.current = null; setStrip(null); logMark(p.id, 'neutral'); }}
            />
          );
        })}
      </div>
      {gone.length > 0 && (
        <div className="gone-strip">
          {gone.map(p => <GoneChip key={p.id} p={p} open={open === p.id} onToggle={() => toggle(p.id)} onClose={close} />)}
        </div>
      )}
    </section>
  );
}

/** One dot: how sure the app is that this roster mirrors the vote grid (names read, cards matched). */
function ConfidenceDot() {
  const c = useMatch(s => s.rosterConfidence);
  const cls = c === null ? 'none' : c >= 0.8 ? 'good' : c >= 0.5 ? 'ok' : 'bad';
  const title = c === null ? 'Roster not read from a meeting yet' : `Roster confidence ${Math.round(c * 100)}% (names read + headshots matched on the last vote grid)`;
  return <span className={`conf-dot ${cls}`} title={title} />;
}

function focusSibling(el: HTMLElement, dir: 1 | -1) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.pcard'));
  const i = cards.indexOf(el);
  cards[i + dir]?.focus();
}

function Card({ p, score, mark, reason, open, onToggle, onClose, prime, flashKey, strip, onMarkButton, onReason, onHard, onUnmark }: {
  p: Player; score?: SuspectScore; mark?: UserMark; reason?: string; open: boolean; onToggle: () => void; onClose: () => void;
  prime?: boolean; flashKey?: string | null; strip: Strip | null;
  onMarkButton: (mode: StripMode) => void; onReason: (r: Reason) => void; onHard: () => void; onUnmark: () => void;
}) {
  const match = useMatch(s => s.match)!;
  const observe = useMatch(s => s.observe);
  const ref = useRef<HTMLDivElement>(null);
  const withMe = !p.isMe && withMeNow(match, p.id);
  const verdict = p.isMe ? null : score?.verdict ?? 'unknown';
  const hasEvidence = !!score && score.evidence.some(e => e.category !== 'hard' || Math.abs(e.weight) > 50 || e.weight < 0);
  const cleared = verdict === 'certainCrew' || verdict === 'hardClear' || p.knownRole === 'crew';
  const here = myRoomNow(match);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const markCls = mark === 'sus' ? 'mark-sus' : mark === 'clear' ? 'mark-clear' : mark === 'hardClear' ? 'mark-hard' : '';
  const nameCls = p.name.length > 12 ? 'vlong' : p.name.length > 9 ? 'long' : '';
  const red = (p.isMe && match.myRole === 'impostor') || p.isPartner;
  const rInfo = reasonInfo(reason as Reason | undefined);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusSibling(e.currentTarget, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusSibling(e.currentTarget, -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
  };

  return (
    <div ref={ref} role="listitem" tabIndex={0} onKeyDown={onKey}
      className={`pcard ${p.isMe ? 'me' : ''} ${open ? 'menu-open' : ''} ${prime && !mark ? 'prime' : ''} ${cleared && !p.isMe && !mark ? 'cleared' : ''} ${markCls} ${verdict === 'certainImpostor' ? 'imp' : ''}`}
      onClick={onToggle} title={`${PALETTE[p.color as keyof typeof PALETTE]?.label ?? ''} — click for more`}>
      {flashKey && <span className="flash" key={flashKey} />}
      <span className="pc-icon"><PlayerIcon id={p.id} color={p.color} size={34} /></span>
      <div className="pc-mid">
        <div className={`pc-name ${nameCls} ${red ? 'red-name' : ''}`} title={p.name}>
          {p.name}
          {p.isMe && <span className="me-tag">YOU</span>}
        </div>
        {p.isMe ? (
          <div className="pc-sub">📍 {here ? roomName(match, here) : <span className="muted">tap to set your room</span>}</div>
        ) : (
          <div className="pc-sub">
            <SusMeter score={score} hasEvidence={hasEvidence} />
            {mark === 'sus' && <span className="badge sus" title={rInfo?.evidence}>SUS{rInfo && rInfo.id !== 'other' ? ' · ' + rInfo.label : ''}</span>}
            {mark === 'clear' && <span className="badge rclear" title={rInfo?.evidence}>CLR{rInfo && rInfo.id !== 'otherClear' ? ' · ' + rInfo.label : ''}</span>}
            {mark === 'hardClear' && <span className="badge hclear">HARD</span>}
            {p.isPartner && <span className="badge imp">PARTNER</span>}
            {p.knownRole === 'impostor' && !p.isPartner && <span className="badge imp">IMP</span>}
            {withMe && <span className="badge with">WITH ME</span>}
          </div>
        )}
      </div>
      {!p.isMe && (
        <div className="pc-acts" onClick={stop} onMouseDown={stop}>
          <button className={`act sus ${mark === 'sus' ? 'on' : ''} ${strip?.mode === 'sus' ? 'pending' : ''}`} title="Mark sus (then optionally say why)" onClick={() => onMarkButton('sus')}>SUS</button>
          <button className={`act clr ${mark === 'clear' || mark === 'hardClear' ? 'on' : ''} ${strip?.mode === 'clear' ? 'pending' : ''}`} title="Mark clear (then optionally why / hard clear)" onClick={() => onMarkButton('clear')}>{mark === 'hardClear' ? 'HARD' : 'CLR'}</button>
          <button className="act" title={here ? `Seen in ${roomName(match, here)} (my room)` : 'Set your room first: click your own card'} disabled={!here}
            onClick={() => here && observe({ type: 'sighting', player: p.id, room: here }, `${p.name} in ${roomName(match, here)}`)}>👁</button>
          <button className={`act ${withMe ? 'on-with' : ''}`} title={withMe ? 'With me — click when they leave' : 'With me'}
            onClick={() => observe({ type: 'withMe', player: p.id, room: here ?? 'unknown', on: !withMe }, !withMe ? `${p.name} with me` : `${p.name} left me`)}>👥</button>
        </div>
      )}
      {strip && <ReasonStrip key={strip.seq} strip={strip} mark={mark} onReason={onReason} onHard={onHard} onUnmark={onUnmark} />}
      {open && <Popover anchorRef={ref} onClose={onClose}><CardMenu p={p} onClose={onClose} /></Popover>}
    </div>
  );
}

function ReasonStrip({ strip, mark, onReason, onHard, onUnmark }: { strip: Strip; mark?: UserMark; onReason: (r: Reason) => void; onHard: () => void; onUnmark: () => void }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const list = strip.mode === 'sus' ? SUS_REASONS : CLEAR_REASONS;
  const marked = strip.mode === 'sus' ? mark === 'sus' : mark === 'clear' || mark === 'hardClear';
  return (
    <div className={`reason-strip ${strip.mode}`} onClick={stop} onMouseDown={stop}>
      <span className="rs-q">{strip.plain ? 'Why?' : 'Add why:'}</span>
      {list.map((r, i) => (
        <button key={r.id} className="rs-btn" title={`${r.evidence} (key ${i + 1})`} onClick={() => onReason(r.id)}>{r.label}</button>
      ))}
      {strip.mode === 'clear' && mark !== 'hardClear' && <button className="rs-btn hard" title="You are certain (visual task, kill window)" onClick={onHard}>🛡 HARD</button>}
      {marked && <button className="rs-btn un" title="Remove the mark" onClick={onUnmark}>✕ unmark</button>}
      {strip.plain && <span className="rs-timer" style={{ animationDuration: `${STRIP_MS}ms` }} title="Logs a plain mark when this runs out (or press Enter)" />}
    </div>
  );
}

function GoneChip({ p, open, onToggle, onClose }: { p: Player; open: boolean; onToggle: () => void; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const state = p.status === 'alive' ? 'alive' : p.status === 'dead' ? 'dead' : p.status === 'ejected' ? 'ejected' : 'disconnected';
  return (
    <>
      <button ref={ref} className={`gone-chip ${open ? 'menu-open' : ''}`} title={`${p.name} — ${p.status}`} onClick={onToggle}>
        <PlayerIcon id={p.id} color={p.color} size={24} state={state} />
        <span className="n">{p.name}</span>
      </button>
      {open && <Popover anchorRef={ref} onClose={onClose}><CardMenu p={p} onClose={onClose} /></Popover>}
    </>
  );
}
