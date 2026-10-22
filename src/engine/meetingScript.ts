/**
 * Meeting script generator — SuspectScores + state → Ask / Say / Vote / Watch.
 *
 * Templates come from data/tactics/crew.json, selected by the `kind` each
 * EvidenceItem carries. Questions are ranked by expected information gain
 * (§5.1): for a question aimed at player P backed by evidence of weight w,
 * the plausible answers are "checkable alibi" (−w), "contradicted" (+1.5)
 * and "vague" (+0.2). Gain = the largest swing in P's probability any of
 * those answers would cause, plus a fixed bonus for the current prime
 * suspect (you must confront the player you intend to vote) and a smaller
 * one for #2. Cheap, and monotone in what matters: how much an answer
 * could move the vote.
 */
import type { MatchState, MeetingScript, SuspectScore, MeetingQuestion, EvidenceItem, PlayerId } from '../types/game';
import crew from '../data/tactics/crew.json';
import weights from '../data/tactics/weights.json';
import { fmt } from './evidence';
import { impostorsRemaining } from './suspicion';
import { headline as situationHeadline, headlineText } from './headline';

type Situation = { say?: string[]; ask?: string[]; watch?: string[] };
const S = crew.situations as Record<string, Situation>;

const name = (m: MatchState, id: string) => (id === 'all' ? 'everyone' : m.players[id]?.name ?? id);

/** Evidence below this is noise for the purpose of "do we have anything to say". */
const MIN_SIGNAL = 0.5;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function questionGain(s: SuspectScore, w: number, topPlayer: PlayerId | undefined, top2: Set<PlayerId>): number {
  const L = s.logOdds, p = s.probability;
  const outcomes = [L - Math.abs(w), L + weights.meeting.storyChanged, L + 0.2];
  const swing = Math.max(...outcomes.map(o => Math.abs(sigmoid(o) - p)));
  return swing + (s.player === topPlayer ? 1 : top2.has(s.player) ? 0.3 : 0);
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Pick the first template whose placeholders are all available. */
function pick(templates: string[] | undefined, vars: Record<string, string>): string | null {
  for (const t of templates ?? []) {
    const needed = [...t.matchAll(/\{(\w+)\}/g)].map(x => x[1]);
    if (needed.every(k => k in vars)) return fill(t, vars);
  }
  return null;
}

function myLocationLine(m: MatchState): { text: string; why: string[] } | null {
  const round = Math.max(0, m.phase.round);
  const myRoom = [...m.observations].reverse().find(o => o.type === 'myRoom' && o.stamp.round === round);
  const companions: string[] = [];
  const refs: string[] = [];
  const on = new Map<PlayerId, boolean>();
  for (const o of m.observations) if (o.type === 'withMe' && o.stamp.round === round) { on.set(o.player, o.on); refs.push(o.id); }
  for (const [p, v] of on) if (v) companions.push(name(m, p));
  if (!myRoom) return null;
  const R = m.map.rooms.find(r => r.id === (myRoom as { room: string }).room)?.name ?? (myRoom as { room: string }).room;
  const text = companions.length ? fill(S.round_open.say![0], { R, W: companions.join(' and ') }) : `I was in ${R}.`;
  return { text, why: [myRoom.id, ...refs] };
}

export function buildMeetingScript(m: MatchState, scores: SuspectScore[], meeting: number): MeetingScript {
  const ask: MeetingQuestion[] = [];
  const say: MeetingScript['say'] = [];
  const watch: string[] = [];
  const usedWatch = new Set<string>();
  const addWatch = (lines: string[] | undefined, vars: Record<string, string>) => {
    for (const w of lines ?? []) { const t = fill(w, vars); if (!usedWatch.has(t)) { usedWatch.add(t); watch.push(t); } }
  };

  const alive = Object.values(m.players).filter(p => p.status === 'alive').length;
  const impRemaining = impostorsRemaining(m);
  const crewAlive = alive - impRemaining;
  // Critical: after one more kill the impostors could win (crew ≤ imp + 1), or it's already parity.
  // crewAlive > impRemaining: a roster that is not filled yet (only "me") must not read as the endgame.
  const live = impRemaining > 0 && crewAlive > impRemaining;
  const critical = live && crewAlive <= impRemaining + 2;
  const endgame = live && crewAlive <= impRemaining + 1;

  // 1. Hard clears first — the most valuable thing you can say.
  const clears = scores.filter(s => s.verdict === 'certainCrew' || s.verdict === 'hardClear');
  for (const c of clears.slice(0, 2)) {
    const e = c.evidence.find(x => x.category === 'hard' && x.weight < 0);
    if (e) say.push({ text: `${name(m, c.player)} is clear — ${e.label.toLowerCase()}.`, why: [e.id] });
  }

  // 2. My own location + companions (pre-empts "where were you").
  const mine = myLocationLine(m);
  if (mine) say.push(mine);

  // 3. Strongest observations as statements; questions from every positive evidence item that has a situation.
  const uncertain = scores.filter(s => s.verdict === 'unknown' || s.verdict === 'softClear');
  const topPlayer = uncertain[0]?.player;
  const top2 = new Set(uncertain.slice(0, 2).map(s => s.player));
  const candidates: { q: MeetingQuestion; sayLine?: { text: string; why: string[] }; e: EvidenceItem }[] = [];
  for (const s of uncertain) {
    for (const e of s.evidence) {
      if (e.weight <= 0 || !e.kind || !S[e.kind]) continue;
      const vars = { P: name(m, s.player), ...(e.vars ?? {}) };
      const sit = S[e.kind];
      const q = pick(sit.ask, vars);
      const sayLine = pick(sit.say, vars);
      const gain = questionGain(s, e.weight, topPlayer, top2);
      if (q) candidates.push({ q: { to: e.kind === 'body_in_dead_end' ? 'all' : s.player, text: q, why: [e.id], expectedGain: gain }, sayLine: sayLine ? { text: sayLine, why: [e.id] } : undefined, e });
      addWatch(sit.watch, vars);
    }
  }
  candidates.sort((a, b) => b.q.expectedGain - a.q.expectedGain);
  const askedPlayers = new Set<string>();
  for (const c of candidates) {
    const key = c.q.to + '|' + c.q.text;
    if (askedPlayers.has(key)) continue;
    askedPlayers.add(key);
    ask.push(c.q);
  }
  // One strongest statement that isn't already covered by the clears / my line.
  const strongest = candidates.find(c => c.sayLine && c.e.weight >= 0.8);
  if (strongest?.sayLine && say.length < 3) say.push(strongest.sayLine);

  // 4. Generic question for a top suspect with no specific situation to ask about.
  for (const s of uncertain.slice(0, 2)) {
    if (ask.some(q => q.to === s.player)) continue;
    const top = [...s.evidence].filter(e => e.weight >= MIN_SIGNAL).sort((a, b) => b.weight - a.weight)[0];
    if (!top) continue;
    ask.push({ to: s.player, text: `${name(m, s.player)}, where were you and who were you with?`, why: [top.id], expectedGain: questionGain(s, top.weight, topPlayer, top2) * 0.8 });
  }

  // 5. Endgame framing.
  if (endgame && uncertain.length >= 2) {
    const hard = clears.map(c => name(m, c.player)).join(', ') || 'nobody';
    const vars = { W: hard, N: String(impRemaining), P: name(m, uncertain[0].player), P2: name(m, uncertain[1].player) };
    const line = pick(S.two_left_endgame.say, vars);
    if (line) say.unshift({ text: line, why: clears.flatMap(c => c.evidence.filter(e => e.category === 'hard').map(e => e.id)) });
    const q = pick(S.two_left_endgame.ask, vars);
    if (q) ask.unshift({ to: 'all', text: q, why: [], expectedGain: 9 });
    addWatch(S.two_left_endgame.watch, vars);
  }

  // 6. Vote recommendation.
  const ranked = scores.filter(s => s.verdict !== 'certainCrew' && s.verdict !== 'hardClear');
  const top = ranked[0];
  const second = ranked[1];
  let vote: MeetingScript['vote'];
  if (top && top.verdict === 'certainImpostor') {
    vote = { target: top.player, confidence: 1, reason: top.evidence.find(e => e.category === 'hard')?.label ?? 'Confirmed impostor.' };
  } else if (top && top.probability >= weights.vote.threshold && (!second || top.probability - second.probability >= weights.vote.marginToSecond)) {
    vote = { target: top.player, confidence: top.probability, alternative: 'skip', reason: top.evidence.filter(e => e.weight > 0).map(e => e.label).slice(0, 2).join('; ') };
  } else if (critical && top && top.probability > 0.3) {
    vote = { target: top.player, confidence: top.probability, alternative: 'skip', reason: 'Critical vote — skipping hands them the game. Best available suspect.' };
  } else {
    vote = { target: 'skip', confidence: top ? 1 - top.probability : 1, alternative: top?.player, reason: 'No suspect clears the threshold. Skip and stack next round.' };
  }

  const anySignal = ask.some(q => q.why.length > 0) || (top !== undefined && top.evidence.some(e => Math.abs(e.weight) >= MIN_SIGNAL));
  const insufficient = !anySignal && vote.target === 'skip';
  if (insufficient) {
    say.push({ text: S.insufficient_info.say![0], why: [] });
    ask.push({ to: 'all', text: S.insufficient_info.ask![0], why: [], expectedGain: 0.1 });
    addWatch(S.insufficient_info.watch, {});
  }

  // One source of truth for the situational header (engine/headline.ts).
  const headline = headlineText(situationHeadline(m, scores));

  return {
    meeting,
    headline,
    ask: ask.sort((a, b) => b.expectedGain - a.expectedGain).slice(0, 3),
    say: say.slice(0, 3),
    vote,
    watch: watch.slice(0, 3),
    insufficientInfo: insufficient,
  };
}

export { fmt };
