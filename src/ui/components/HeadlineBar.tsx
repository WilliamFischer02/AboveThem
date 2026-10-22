/**
 * Situational header from engine/headline.ts.
 *  - big (meetings): tone-coloured banner, title, subtitle, suspects' headshots in order with %.
 *  - compact (rounds): one line "Watch: Red, Blue" with small headshots.
 * Clicking a headshot shows the evidence ids behind the headline (`why`) as labels.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { SuspectScore } from '../../types/game';
import type { Headline } from '../../engine/headline';
import { useMatch } from '../../state/store';
import { PlayerIcon } from './Crewmate';
import { Popover } from './Popover';
import { rampColor, trendOf } from './SusMeter';

const ICON: Record<Headline['kind'], string> = {
  lobby: '⌂', gameOver: '★', imDead: '👻', confirmedImpostor: '🔪', criticalVote: '⚠', oneSuspect: '🎯', leaning: '🤔',
  twoSuspects: '⚖', threeSuspects: '⚖', notEnoughInfo: '⏭', skipVote: '⏭',
};

export function HeadlineBar({ h, scores, big = false, right, label }: { h: Headline; scores: SuspectScore[]; big?: boolean; right?: ReactNode; label?: string }) {
  const match = useMatch(s => s.match)!;
  const byId = new Map(scores.map(s => [s.player, s]));
  const evidence = new Map(scores.flatMap(s => s.evidence).map(e => [e.id, e]));
  const whyRef = useRef<HTMLButtonElement>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const whyItems = h.why.map(id => evidence.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
  const dim = h.basis === 'notEnoughInfo';

  if (!big) {
    return (
      <div className={`hl-compact tone-${h.tone}`}>
        <span className="hl-ico">{ICON[h.kind]}</span>
        <span className="hl-short">{h.short}</span>
        <span className="hl-faces">
          {h.players.map(id => {
            const p = match.players[id];
            return p ? <span key={id} className={`hl-face ${dim ? 'dim' : ''}`} title={`${p.name} ${Math.round((byId.get(id)?.probability ?? 0) * 100)}%`}><PlayerIcon id={id} color={p.color} size={22} /></span> : null;
          })}
        </span>
        {right && <span className="hl-right">{right}</span>}
      </div>
    );
  }

  return (
    <div className={`hl-big tone-${h.tone}`}>
      <div className="hl-top">
        <span className="hl-ico">{ICON[h.kind]}</span>
        <div className="hl-text">
          {label && <div className="hl-label">{label}</div>}
          <div className="hl-title">{h.title}</div>
          {h.subtitle && <div className="hl-sub">{h.subtitle}</div>}
        </div>
        {right}
      </div>
      {h.players.length > 0 && (
        <div className="hl-suspects">
          {h.players.map((id, i) => {
            const p = match.players[id];
            const s = byId.get(id);
            if (!p) return null;
            const t = trendOf(s);
            const pct = s?.verdict === 'certainImpostor' ? 'IMP' : `${Math.round((s?.probability ?? 0) * 100)}%`;
            return (
              <button key={id} ref={i === 0 ? whyRef : undefined} type="button" className={`hl-suspect ${dim ? 'dim' : ''}`} title="Why?" onClick={() => setWhyOpen(o => !o)}>
                <span className="rank">{i + 1}</span>
                <PlayerIcon id={id} color={p.color} size={36} />
                <span className="nm">{p.name}</span>
                <span className="pc" style={{ color: s?.verdict === 'certainImpostor' ? '#ff6b6b' : rampColor(s?.probability ?? 0) }}>{pct}{t ? ' ' + t.arrow : ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {whyOpen && whyItems.length > 0 && (
        <Popover anchorRef={whyRef} onClose={() => setWhyOpen(false)} width={320} className="why-pop">
          <div className="menu-title">Why this headline?</div>
          <ul className="why-list">
            {whyItems.map(e => (
              <li key={e.id} className={e.weight > 0 ? 'pos' : 'neg'}>
                <span className="w">{match.players[e.player]?.name ?? e.player}</span>
                <span className="l">{e.label}</span>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  );
}
