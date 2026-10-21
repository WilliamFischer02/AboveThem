/**
 * Meeting script generator — turns SuspectScores + state into Ask / Say / Vote / Watch.
 * Skeleton: produces a usable script from the rules implemented so far. Phase 1
 * adds expected-information-gain ranking and the full situation set from
 * data/tactics/crew.json.
 */
import type { MatchState, MeetingScript, SuspectScore, MeetingQuestion } from '../types/game';
import crew from '../data/tactics/crew.json';
import weights from '../data/tactics/weights.json';
import { fmt } from './suspicion';

const name = (m: MatchState, id: string) => m.players[id]?.name ?? id;

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export function buildMeetingScript(m: MatchState, scores: SuspectScore[], meeting: number): MeetingScript {
  const ask: MeetingQuestion[] = [];
  const say: MeetingScript['say'] = [];
  const watch: string[] = [];
  const S = crew.situations;

  // 1. Hard clears first — most valuable thing you can say.
  const clears = scores.filter(s => s.verdict === 'certainCrew' || s.verdict === 'hardClear');
  for (const c of clears.slice(0, 2)) {
    const e = c.evidence.find(x => x.category === 'hard' && x.weight < 0);
    if (e) say.push({ text: `${name(m, c.player)} is clear — ${e.label.toLowerCase()}.`, why: [e.id] });
  }

  // 2. My own location + companion (pre-empt accusations).
  const myRoom = [...m.observations].reverse().find(o => o.type === 'myRoom');
  const companions = m.observations.flatMap(o => (o.type === 'withMe' && o.on ? [name(m, o.player)] : []));
  if (myRoom && myRoom.type === 'myRoom') {
    say.push({ text: companions.length ? `I was in ${myRoom.room} with ${companions.join(', ')}.` : `I was in ${myRoom.room}.`, why: [myRoom.id] });
  }

  // 3. Questions from top uncertain suspects' evidence.
  const uncertain = scores.filter(s => s.verdict === 'unknown' || s.verdict === 'softClear');
  for (const s of uncertain.slice(0, 3)) {
    const top = [...s.evidence].sort((a, b) => b.weight - a.weight)[0];
    if (!top || top.weight <= 0) continue;
    const P = name(m, s.player);
    if (top.label.startsWith('Self-reported')) {
      const room = top.label.match(/in (\w+)/)?.[1] ?? '?';
      ask.push({ to: s.player, text: fill(S.self_report.ask[0], { P, R: room }), why: [top.id], expectedGain: top.weight });
      watch.push(...S.self_report.watch.map(w => fill(w, { P, R: room })));
    } else if (top.label.startsWith('Alone near')) {
      const room = top.label.match(/near (\w+)/)?.[1] ?? '?';
      const t = top.label.match(/at (\d+:\d+)/)?.[1] ?? '?';
      ask.push({ to: s.player, text: `${P}, where were you at ~${t}? I saw you alone near ${room}.`, why: [top.id], expectedGain: top.weight });
    } else {
      ask.push({ to: s.player, text: `${P}, where were you and who were you with?`, why: [top.id], expectedGain: top.weight * 0.5 });
    }
  }

  // 4. Vote recommendation.
  const ranked = scores.filter(s => s.verdict !== 'certainCrew' && s.verdict !== 'hardClear');
  const top = ranked[0];
  const second = ranked[1];
  let vote: MeetingScript['vote'];
  const alive = Object.values(m.players).filter(p => p.status === 'alive').length;
  const impRemaining = m.settings.impostorCount - m.ejections.filter(e => e.wasImpostor).length;
  const critical = alive - impRemaining <= impRemaining + 2; // one more kill and it's over-ish
  if (top && top.verdict === 'certainImpostor') {
    vote = { target: top.player, confidence: 1, reason: 'Confirmed impostor.' };
  } else if (top && top.probability >= weights.vote.threshold && (!second || top.probability - second.probability >= weights.vote.marginToSecond)) {
    vote = { target: top.player, confidence: top.probability, alternative: 'skip', reason: top.evidence.map(e => e.label).slice(0, 2).join('; ') };
  } else if (critical && top) {
    vote = { target: top.player, confidence: top.probability, alternative: 'skip', reason: 'Critical vote — skipping hands them the game. Best available suspect.' };
  } else {
    vote = { target: 'skip', confidence: top ? 1 - top.probability : 1, alternative: top?.player, reason: 'No suspect clears the threshold. Skip and stack next round.' };
  }

  const insufficient = ask.length === 0 && vote.target === 'skip';
  if (insufficient) {
    say.push({ text: S.insufficient_info.say[0], why: [] });
    ask.push({ to: 'all', text: S.insufficient_info.ask[0], why: [], expectedGain: 0.1 });
    watch.push(...S.insufficient_info.watch);
  }

  const headline = top && top.verdict !== 'certainCrew'
    ? `Prime suspect: ${name(m, top.player)} (${Math.round(top.probability * 100)}%)${top.evidence[0] ? ' — ' + top.evidence[0].label : ''}`
    : 'No prime suspect yet';

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
