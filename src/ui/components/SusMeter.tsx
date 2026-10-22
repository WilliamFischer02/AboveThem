/**
 * Suspicion meter on a roster card: a bar driven by SuspectScore.probability, coloured
 * green → amber → red, a trend arrow (if the engine supplies `delta`), and one-tap "why":
 * click the meter → the evidence behind the number, strongest first.
 * Certain impostor / certain crew / hard clear get their own iconography instead of a %.
 */
import { useRef, useState } from 'react';
import type { EvidenceItem, SuspectScore } from '../../types/game';
import { Popover } from './Popover';

/** Fields suspicion-core adds to SuspectScore (all optional). Read defensively until merged. */
type ScoreExtras = { delta?: number; summary?: string; baseline?: { logOdds: number; label: string } };
// MERGE: once suspicion-core's SuspectScore has these fields, ScoreExtras is redundant but harmless.

export const TREND_MIN = 0.05;

/** 0..1 → green (120°) → amber (40°) → red (0°). */
export function rampColor(p: number): string {
  const x = Math.max(0, Math.min(1, p));
  const hue = x < 0.5 ? 120 - 80 * (x / 0.5) : 40 - 40 * ((x - 0.5) / 0.5);
  return `hsl(${Math.round(hue)} 78% 46%)`;
}

export function trendOf(score?: SuspectScore): { arrow: '▲' | '▼'; delta: number } | null {
  const d = (score as (SuspectScore & ScoreExtras) | undefined)?.delta;
  if (typeof d !== 'number' || !Number.isFinite(d) || Math.abs(d) < TREND_MIN) return null;
  return { arrow: d > 0 ? '▲' : '▼', delta: d };
}

/** Top evidence by |weight| (what the "why" list shows). */
export function topEvidence(score: SuspectScore | undefined, n = 6): EvidenceItem[] {
  if (!score) return [];
  return [...score.evidence].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, n);
}

/** One glyph per evidence category ('social' = what other players said about them, from chat). */
export const CATEGORY_ICON: Record<string, string> = { hard: '❗', manual: '✋', movement: '👣', task: '🔧', meeting: '🗳', sabotage: '⚡', structural: '🧩', social: '💬' };

const fmtW = (w: number) => (w >= 99 ? '∞' : w <= -99 ? '−∞' : (w > 0 ? '+' : '') + w.toFixed(1));

export function SusMeter({ score, hasEvidence }: { score?: SuspectScore; hasEvidence: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const v = score?.verdict;
  const p = score?.probability ?? 0;
  const trend = trendOf(score);
  let cls = '', label: string, fill: number, color: string;
  if (v === 'certainImpostor') { cls = 'imp'; label = '🔪 IMPOSTOR'; fill = 1; color = '#d8232a'; }
  else if (v === 'certainCrew') { cls = 'crew'; label = '🛡 CREW'; fill = 1; color = '#1aa94a'; }
  else if (v === 'hardClear') { cls = 'crew'; label = '🛡 CLEAR'; fill = 1; color = '#1aa94a'; }
  else if (!hasEvidence) { cls = 'none'; label = '—'; fill = p; color = '#8d939d'; }
  else { label = `${Math.round(p * 100)}%`; fill = p; color = rampColor(p); }
  const items = topEvidence(score);
  const extras = score as (SuspectScore & ScoreExtras) | undefined;
  const title = !score ? 'No score' : items.length ? 'Why? (click)' : 'No evidence yet: the bar shows the base rate';
  return (
    <>
      <button ref={ref} type="button" className={`meter ${cls} ${open ? 'open' : ''}`} title={title}
        onClick={e => { e.stopPropagation(); if (score) setOpen(o => !o); }} onMouseDown={e => e.stopPropagation()}>
        <span className="meter-bar"><i style={{ width: `${Math.round(fill * 100)}%`, background: color }} /></span>
        <span className="meter-val" style={cls === '' ? { color } : undefined}>{label}</span>
        {v === 'softClear' && <span className="meter-tag" title="Cleared for some kills, not all">◐</span>}
        {trend && <span className={`trend ${trend.arrow === '▲' ? 'up' : 'down'}`} title={`${trend.delta > 0 ? '+' : ''}${Math.round(trend.delta * 100)}% since the last meeting`}>{trend.arrow}</span>}
      </button>
      {open && score && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={320} className="why-pop">
          <div className="menu-title">Why {label}?</div>
          {extras?.summary && <div className="small">{extras.summary}</div>}
          {items.length === 0 && <div className="muted small">Nothing logged about this player yet.</div>}
          <ul className="why-list">
            {items.map(e => (
              <li key={e.id} className={e.weight > 0 ? 'pos' : 'neg'}>
                <span className="w">{fmtW(e.weight)}</span>
                <span className="l"><span className="cat" title={e.category}>{CATEGORY_ICON[e.category] ?? '·'}</span> {e.label}{e.shaky ? <span className="muted"> (unverified map)</span> : null}</span>
              </li>
            ))}
          </ul>
          {extras?.baseline?.label && <div className="muted small">Base rate: {extras.baseline.label}</div>}
        </Popover>
      )}
    </>
  );
}
