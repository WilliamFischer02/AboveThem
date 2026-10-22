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
import weights from '../data/tactics/weights.json';

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
  /** The vote recommendation for this situation (meetingScript.vote is exactly this). */
  vote: HeadlineVote;
}

export interface HeadlineVote { target: PlayerId | 'skip'; alternative?: PlayerId | 'skip'; confidence: number; reason: string }

export const NOT_ENOUGH = 0.45;
/** Vote threshold — same number as weights.vote.threshold. */
export const MAJOR = weights.vote.threshold;
export const SECOND_LOW = 0.4;
/** Pack width — same number as weights.vote.marginToSecond. */
export const PACK = weights.vote.marginToSecond;
/** In a critical vote, a suspect above this is voted rather than skipped (skipping can lose). */
export const CRITICAL_MIN = 0.3;

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
    .filter(s => s.verdict !== 'certainCrew' && s.verdict !== 'hardClear')
    .filter(s => m.players[s.player]?.status === 'alive' && !m.players[s.player]?.isMe && s.player !== m.me)
    .sort((a, b) => b.probability - a.probability || b.logOdds - a.logOdds);
  const whyOf = (ss: SuspectScore[]) => ss.flatMap(s => [...s.evidence].filter(e => e.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 2).map(e => e.id));
  const topLabel = (s: SuspectScore) => [...s.evidence].filter(e => e.weight > 0).sort((a, b) => b.weight - a.weight)[0]?.label;
  const withPct = (s: SuspectScore) => `${name(s.player)} (${pct(s.probability)})`;

  const { imp, margin } = voteMargin(m);
  const critical = imp > 0 && margin <= 2;
  const lastVote = imp > 0 && margin <= 1;

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
        base = { ...simple('twoSuspects', 'Two Major Suspects', list[1].probability >= MAJOR ? `Prime suspects: ${withPct(list[0])} vs ${withPct(list[1])} — vote ${name(list[0].player)}, then ${name(list[1].player)}` : `Prime suspects: ${withPct(list[0])} vs ${withPct(list[1])} — ask both`, 'warn'), players, short, why: whyOf(list) };
      } else if (p1.probability >= MAJOR && (p2?.probability ?? 0) < SECOND_LOW) {
        const l = topLabel(p1);
        base = { ...simple('oneSuspect', 'One Major Suspect', `Prime suspect: ${withPct(p1)}${l ? ' — ' + l : ''}`, 'danger'), players, short, why: whyOf(list) };
      } else {
        base = { ...simple('leaning', `Leaning: ${name(p1.player)}`, p1.probability >= MAJOR ? `Prime suspect: ${withPct(p1)} — vote${p2 && p2.probability >= SECOND_LOW ? ` · next: ${withPct(p2)}` : ''}` : `Prime suspect: ${withPct(p1)} — ask before you vote`, 'warn'), players, short, why: whyOf(list) };
      }
    }
  }

  base.vote = recommendVote(base.basis, ranked, critical, name);

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
  return { kind, basis: kind, title, subtitle, players: [], tone, short: title, critical: false, why: [], vote: { target: 'skip', confidence: 1, reason: '' } };
}

/**
 * Vote from the classification, so the header and the vote card can never disagree.
 *  confirmedImpostor → vote it · oneSuspect → vote top (or skip)
 *  leaning: top ≥ MAJOR → vote top (#2 as the follow-up); else skip, top as the alternative
 *  two/three: every listed ≥ MAJOR → vote top, #2 next; else skip (don't split the vote)
 *  notEnoughInfo / skipVote → skip
 *  critical (crew − imp ≤ 2) and the plan is skip and top > CRITICAL_MIN → vote top (skipping can lose).
 */
export function recommendVote(basis: HeadlineKind, ranked: SuspectScore[], critical: boolean, name: (id: PlayerId) => string): HeadlineVote {
  const [p1, p2] = ranked;
  const labels = (s: SuspectScore) => [...s.evidence].filter(e => e.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 2).map(e => e.label).join('; ');
  const go = (s: SuspectScore, alternative: PlayerId | 'skip' | undefined, note?: string): HeadlineVote =>
    ({ target: s.player, alternative, confidence: s.probability, reason: [labels(s), note].filter(Boolean).join(' — ') || 'Strongest case.' });
  let v: HeadlineVote;
  const confirmed = ranked.find(s => s.verdict === 'certainImpostor');
  if (confirmed) {
    v = { target: confirmed.player, confidence: 1, reason: confirmed.evidence.find(e => e.category === 'hard' && e.weight > 0)?.label ?? 'Confirmed impostor.' };
  } else if (!p1) {
    v = { target: 'skip', confidence: 1, reason: 'Nobody left to suspect. Check the impostor count.' };
  } else if (basis === 'oneSuspect') {
    v = go(p1, 'skip');
  } else if (basis === 'leaning' && p1.probability >= MAJOR) {
    v = go(p1, p2 && p2.probability >= SECOND_LOW ? p2.player : 'skip', p2 && p2.probability >= SECOND_LOW ? `${name(p2.player)} next if ${name(p1.player)} was crew` : undefined);
  } else if ((basis === 'twoSuspects' || basis === 'threeSuspects') && p2 && p2.probability >= MAJOR) {
    v = go(p1, p2.player, `both likely — ${name(p2.player)} next`);
  } else if (basis === 'twoSuspects' || basis === 'threeSuspects') {
    v = { target: 'skip', alternative: p1.player, confidence: 1 - p1.probability, reason: `Close call — don't split the vote. Skip unless the room settles on one (${name(p1.player)} leads).` };
  } else if (basis === 'leaning') {
    v = { target: 'skip', alternative: p1.player, confidence: 1 - p1.probability, reason: `Lean only — vote ${name(p1.player)} only if their answer falls apart; otherwise skip.` };
  } else {
    v = { target: 'skip', alternative: p1.player, confidence: 1 - p1.probability, reason: 'No suspect clears the threshold. Skip and stack next round.' };
  }
  if (critical && v.target === 'skip' && p1 && p1.probability > CRITICAL_MIN) {
    v = { target: p1.player, alternative: 'skip', confidence: p1.probability, reason: 'Critical vote — skipping can hand them the game. Best available suspect.' };
  }
  return v;
}

/** One line for places that only take text (meeting script headline, overlay). */
export function headlineText(h: Headline): string {
  return h.subtitle ? `${h.title} — ${h.subtitle}` : h.title;
}
