/**
 * Meeting chat grouped per speaker (expanded chat dock → "by speaker").
 * Each speaker: headshot, a one-line stance summary (accuses / clears, from chat-nlu
 * assertions), then their lines with per-line badges. Superseded stances are struck through.
 * Works without assertions too (just the grouped lines).
 */
import { useMemo } from 'react';
import { useMatch } from '../../state/store';
// MERGE: chat-nlu ships the real src/engine/chatNlu.ts; this branch has a stub that returns [].
import { parseMeetingChat } from '../../engine/chatNlu';
import { PlayerIcon } from './Crewmate';

type Assertion = ReturnType<typeof parseMeetingChat>[number];

export function Transcript() {
  const match = useMatch(s => s.match)!;
  const lastMeeting = match.chat.length ? match.chat[match.chat.length - 1].meeting : 0;
  const meeting = match.phase.meeting ?? lastMeeting;
  const assertions = useMemo<Assertion[]>(() => { try { return parseMeetingChat(match, meeting); } catch { return []; } }, [match, meeting]);
  const name = (id: string) => match.players[id]?.name ?? (id === 'unknown' ? '?' : id);
  const lines = match.chat.filter(c => c.meeting === meeting);
  const speakers: string[] = [];
  for (const l of lines) if (!speakers.includes(l.sender)) speakers.push(l.sender);
  const byLine = new Map<string, Assertion[]>();
  for (const a of assertions) byLine.set(a.line, [...(byLine.get(a.line) ?? []), a]);
  const stance = (a: Assertion) => (a.kind === 'accuse' || (a.polarity === 1 && a.kind !== 'question')) ? 'acc' : (a.kind === 'clear' || a.polarity === -1) ? 'clr' : null;

  if (lines.length === 0) return <div className="chat-scroll"><div className="muted small" style={{ padding: 6 }}>No chat read for meeting {meeting + 1} yet.</div></div>;
  return (
    <div className="chat-scroll transcript">
      <span className="chat-sep">meeting {meeting + 1} · {speakers.length} speakers</span>
      {speakers.map(sp => {
        const p = match.players[sp];
        const mine = lines.filter(l => l.sender === sp);
        const as = mine.flatMap(l => byLine.get(l.id) ?? []).filter(a => !a.supersededBy);
        const acc = [...new Set(as.filter(a => stance(a) === 'acc').flatMap(a => a.about))];
        const clr = [...new Set(as.filter(a => stance(a) === 'clr').flatMap(a => a.about))].filter(x => x !== sp);
        return (
          <div key={sp} className="tx-speaker">
            <div className="tx-head">
              <PlayerIcon id={sp} color={p?.color ?? 'unknown'} size={28} state={p && p.status !== 'alive' ? 'dead' : 'alive'} />
              <b className={(sp === match.me && match.myRole === 'impostor') || p?.isPartner ? 'red-name' : ''}>{name(sp)}</b>
              <span className="tx-n">{mine.length}</span>
              {acc.length > 0 && <span className="tx-badge acc" title="Accuses">⚠ {acc.map(name).join(', ')}</span>}
              {clr.length > 0 && <span className="tx-badge clr" title="Clears / vouches for">✔ {clr.map(name).join(', ')}</span>}
            </div>
            {mine.map(l => (
              <div key={l.id} className="tx-line">
                <span className="msg">{l.translated ?? l.original}</span>
                {(byLine.get(l.id) ?? []).filter(a => stance(a) && a.about.length).map(a => (
                  <span key={a.id} className={`tx-badge ${stance(a)} ${a.supersededBy ? 'gone' : ''}`} title={[a.quote ? `"${a.quote}"` : '', ...a.why].filter(Boolean).join(' · ')}>
                    {stance(a) === 'acc' ? '⚠' : '✔'} {a.about.map(name).join(', ')}
                  </span>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
