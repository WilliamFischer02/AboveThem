/**
 * Situational headline — one glanceable verdict for the meeting header and the round bar.
 *
 * Pure: MatchState + SuspectScore[] → Headline. No DOM / React / Tauri.
 * Single source of truth: meetingScript.ts builds its `headline` string from this.
 *
 * Classification (on alive, non-me, non-cleared players, by probability desc):
 *   - any certain impostor alive                  → confirmedImpostor
 *   - nobody left unresolved                      → skipVote
 *   - top < NOT_ENOUGH (0.45)                     → notEnoughInfo   "Not Enough Info | Skip Vote"
 *   - the "pack" = players ≥ 0.45 and within PACK (0.15) of the top:
 *       ≥ 3 → threeSuspects, 2 → twoSuspects,
 *       1 and top ≥ MAJOR (0.6) and #2 < SECOND_LOW (0.4) → oneSuspect, else → leaning
 *   Critical vote (crew alive − impostors left ≤ 2: a wrong vote plus one kill loses) wraps
 *   any of the above except confirmedImpostor; `basis` keeps the underlying classification.
 *   A dead "me" becomes imDead (same basis). Lobby / game over short-circuit.
 * Every listed player links to the evidence ids that put them there (`why`).
 */
import type { MatchState, PlayerId, SuspectScore } from '../types/game';
import { impostorsRemaining } from './suspicion';

export type HeadlineKind =
  | 'lobby' | 'gameOver' | 'imDead' | 'confirmedImpostor' | 'criticalVote'
  | 'oneSuspect' | 'leaning' | 'twoSuspects' | 'threeSuspects' | 'notEnoughInfo' | 'skipVote';

export type HeadlineTone = 'calm' | 'warn' | 'danger' | 'info';

export interface Headline {
  kind: HeadlineKind;
  /** The classification under criticalVote / imDead (equals kind otherwise). */
  basis: HeadlineKind;
  title: string;
  subtitle?: string;
  /** Ordered highest → lowest suspicion. For notEnoughInfo: the weak leads, if any. */
  players: PlayerId[];
  tone: HeadlineTone;
  /** Compact one-liner for the round bar: "Watch: Red, Blue". */
  short: string;
  /** A wrong vote (plus at most one kill) can lose the game. */
  critical: boolean;
  /** Evidence ids behind the listed players (strongest first). */
  why: string[];
}

export const NOT_ENOUGH = 0.45;
export const MAJOR = 0.6;
export const SECOND_LOW = 0.4;
export const PACK = 0.15;

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Crew alive minus impostors left; ≤ 2 = critical, ≤ 1 = the next wrong vote loses outright. */
export function voteMargin(m: MatchState): { imp: number; crew: number; margin: number } {
  const alive = Object.values(m.players).filter(p => p.status === 'alive').length;
  const imp = impostorsRemaining(m);
  const crew = alive - imp;
  return { imp, crew, margin: crew - imp };
}

export function headline(m: MatchState, scores: SuspectScore[]): Headline {
  const name = (id: PlayerId) => m.players[id]?.name ?? id;
  const phase = m.phase.phase;
  if (phase === 'lobby') return simple('lobby', 'Lobby', 'Waiting for the game to start', 'info');
  if (phase === 'gameOver') {
    const o = m.phase.outcome;
    return simple('gameOver', o === 'victory' ? 'Victory' : o === 'defeat' ? 'Defeat' : 'Game Over', undefined, 'info');
  }

  const ranked = scores
    .filter(s => s.verdict !== 'certainCrew' && s.verdict !== 'hardClear' && Number.isFinite(s.probability))
    .filter(s => m.players[s.player]?.status === 'alive' && !m.players[s.player]?.isMe && s.player !== m.me)
    .sort((a, b) => b.probability - a.probability || b.logOdds - a.logOdds);
  const whyOf = (ss: SuspectScore[]) => ss.flatMap(s => [...s.evidence].filter(e => e.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 2).map(e => e.id));
  const topLabel = (s: SuspectScore) => [...s.evidence].filter(e => e.weight > 0).sort((a, b) => b.weight - a.weight)[0]?.label;
  const withPct = (s: SuspectScore) => `${name(s.player)} (${pct(s.probability)})`;

  const { imp, crew, margin } = voteMargin(m);
  // crew > imp: otherwise the game is already over — or, far more often, the roster is not filled yet
  // (provisional match with only "me": alive 1, imp 2 → margin −3 read as "critical").
  const critical = imp > 0 && crew > imp && margin <= 2;
  const lastVote = critical && margin <= 1;

  let base: Headline;
  const confirmed = ranked.filter(s => s.verdict === 'certainImpostor');
  if (confirmed.length > 0) {
    const hard = confirmed[0].evidence.find(e => e.category === 'hard' && e.weight > 0)?.label;
    base = {
      ...simple('confirmedImpostor', confirmed.length > 1 ? 'Confirmed Impostors' : 'Confirmed Impostor',
        `Vote ${name(confirmed[0].player)}${hard ? ' — ' + hard : ''}`, 'danger'),
      players: confirmed.map(s => s.player),
      short: `Impostor: ${confirmed.map(s => name(s.player)).join(', ')}`,
      why: confirmed.flatMap(s => s.evidence.filter(e => e.category === 'hard' && e.weight > 0).map(e => e.id)),
    };
  } else if (ranked.length === 0) {
    base = simple('skipVote', 'Everyone Cleared | Skip Vote', 'Nobody left to suspect — check the impostor count', 'calm');
  } else {
    const [p1, p2] = ranked;
    if (p1.probability < NOT_ENOUGH) {
      const leads = ranked.filter(s => s.evidence.some(e => e.weight > 0)).slice(0, 2);
      base = {
        ...simple('notEnoughInfo', 'Not Enough Info | Skip Vote', leads.length ? `Closest: ${leads.map(withPct).join(', ')} — not enough to vote` : 'No leads yet — log what you see', 'calm'),
        players: leads.map(s => s.player),
        short: leads.length ? `Watch: ${leads.map(s => name(s.player)).join(', ')}` : 'No leads yet',
        why: whyOf(leads),
      };
    } else {
      const pack = ranked.filter(s => s.probability >= NOT_ENOUGH && p1.probability - s.probability <= PACK);
      const list = pack.slice(0, 3);
      const players = list.map(s => s.player);
      const short = `Watch: ${list.map(s => name(s.player)).join(', ')}`;
      if (pack.length >= 3) {
        base = { ...simple('threeSuspects', 'Three Major Suspects', `Prime suspects: ${list.map(withPct).join(', ')} — don't split the vote`, 'warn'), players, short, why: whyOf(list) };
      } else if (pack.length === 2) {
        base = { ...simple('twoSuspects', 'Two Major Suspects', `Prime suspects: ${withPct(list[0])} vs ${withPct(list[1])} — ask both`, 'warn'), players, short, why: whyOf(list) };
      } else if (p1.probability >= MAJOR && (p2?.probability ?? 0) < SECOND_LOW) {
        const l = topLabel(p1);
        base = { ...simple('oneSuspect', 'One Major Suspect', `Prime suspect: ${withPct(p1)}${l ? ' — ' + l : ''}`, 'danger'), players, short, why: whyOf(list) };
      } else {
        base = { ...simple('leaning', `Leaning: ${name(p1.player)}`, p2 && p2.probability >= SECOND_LOW ? `Prime suspect: ${withPct(p1)} · next: ${withPct(p2)}` : `Prime suspect: ${withPct(p1)} — ask before you vote`, 'warn'), players, short, why: whyOf(list) };
      }
    }
  }

  if (critical && base.kind !== 'confirmedImpostor' && base.kind !== 'skipVote') {
    base = {
      ...base,
      kind: 'criticalVote',
      title: 'Critical Vote',
      subtitle: `${lastVote ? 'A wrong vote loses the game' : 'Wrong vote + one kill loses'} · ${base.title.replace(' | Skip Vote', '')}${base.subtitle ? ' · ' + base.subtitle : ''}`,
      tone: 'danger',
      short: `Critical · ${base.short}`,
    };
  }
  base.critical = critical;

  const me = m.players[m.me];
  if (me && me.status !== 'alive') {
    base = { ...base, kind: 'imDead', title: "You're a Ghost", subtitle: `Finish your tasks · ${base.title}${base.subtitle ? ' — ' + base.subtitle : ''}`, tone: 'info' };
  }
  return base;
}

function simple(kind: HeadlineKind, title: string, subtitle: string | undefined, tone: HeadlineTone): Headline {
  return { kind, basis: kind, title, subtitle, players: [], tone, short: title, critical: false, why: [] };
}

/** One line for places that only take text (meeting script headline, overlay). */
export function headlineText(h: Headline): string {
  return h.subtitle ? `${h.title} — ${h.subtitle}` : h.title;
}
