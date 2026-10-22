/**
 * Chat dock: the game's chat as read from the screen, with translations.
 * Minimised it is a small box pinned to the bottom of the window (last few bubbles);
 * a click opens it over the whole window; a click on its bar shrinks it again.
 * Bubbles mirror the game: white, black outline, sender's headshot on the outside
 * (left for others, right for me).
 */
import { useEffect, useRef, useState } from 'react';
import { useMatch } from '../../state/store';
import { PlayerIcon } from './Crewmate';
import { ChatHint } from './ChatHint';
import { Transcript } from './Transcript';

export function ChatDock({ mini = false }: { mini?: boolean }) {
  const match = useMatch(s => s.match);
  const [open, setOpen] = useState(false);
  const [bySpeaker, setBySpeaker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = match?.chat.length ?? 0;

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [count, open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  if (!match) return null;
  const name = (id: string) => match.players[id]?.name ?? (id === 'unknown' ? '?' : id);
  const lines = open ? match.chat : match.chat.slice(-6);
  const curMeeting = match.phase.meeting ?? 0;
  let lastMeeting = -1;

  return (
    <div className={`chat-dock ${open ? 'open' : ''} ${mini ? 'mini' : ''}`} onClick={() => { if (!open) setOpen(true); }}>
      <div className="chat-bar" onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <span>{open ? '▾' : '▴'} Chat</span>
        {open && count > 0 && <button className="btn xs chat-view" title="Group this meeting's chat per speaker, with accuse / clear badges" onClick={e => { e.stopPropagation(); setBySpeaker(v => !v); }}>{bySpeaker ? '💬 chat' : '👥 by speaker'}</button>}
        <span className="n">{count === 0 ? 'nothing read yet' : `${count} lines · ${open ? 'click to shrink' : 'click to expand'}`}</span>
      </div>
      {open && bySpeaker ? <Transcript /> : <div className="chat-scroll" ref={scrollRef}>
        {lines.map(c => {
          const sep = open && c.meeting !== lastMeeting;
          lastMeeting = c.meeting;
          const p = match.players[c.sender];
          const mine = c.sender === match.me;
          const red = (mine && match.myRole === 'impostor') || !!p?.isPartner;
          const claims = match.claims.filter(k => k.chatLineId === c.id || (k.by === c.sender && k.meeting === c.meeting && k.text && c.original.startsWith(k.text.slice(0, 20))));
          return (
            <div key={c.id} style={{ display: 'contents' }}>
              {sep && <span className="chat-sep">{c.meeting === curMeeting ? `meeting ${c.meeting + 1}` : `meeting ${c.meeting + 1}`}</span>}
              <div className={`bubble-row ${mine ? 'mine' : ''} ${(c as { unreadable?: boolean }).unreadable ? 'unreadable' : ''}`}>
                <PlayerIcon id={c.sender} color={p?.color ?? 'unknown'} size={34} state={p && p.status !== 'alive' ? 'dead' : 'alive'} />
                <div className="bubble">
                  <div className={`who ${red ? 'red-name' : ''}`}>{name(c.sender)}</div>
                  <div className="msg">{c.original}</div>
                  {c.translated && <div className="xlat"><span className="lang">{c.lang ?? '?'} → en</span>{c.translated}</div>}
                  <ChatHint line={c} />
                  {open && claims.length > 0 && <div className="tags">{claims.map(k => k.type + (k.about ? ' ' + name(k.about) : '') + (k.room ? ' ' + (match.map.rooms.find(r => r.id === k.room)?.name ?? k.room) : '')).join(' · ')}</div>}
                </div>
              </div>
            </div>
          );
        })}
        {count === 0 && <div className="muted small" style={{ padding: 6 }}>Chat lines appear here as the game shows them (lobby and meetings). Non-English lines get a translation underneath.</div>}
      </div>}
    </div>
  );
}
