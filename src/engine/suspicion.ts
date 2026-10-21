/**
 * Suspicion scoring — hard constraints first, then weighted soft evidence.
 *
 * Rules live in `rules.ts` (observations) and `contradictions.ts` (claims);
 * the alibi graph in `alibi.ts`. This file owns hard facts, kill-window
 * clears, counting logic and the final log-odds → probability step.
 */
import type { MatchState, PlayerId, SuspectScore, EvidenceItem, BodyFoundObs } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { buildAlibiGraph, killWindowClears } from './alibi';
import { OBSERVATION_RULES, userMarks } from './rules';
import { CLAIM_RULES } from './contradictions';
import { ev, fmt, resetEvidenceIds } from './evidence';

type Weights = typeof weightsJson;
const W: Weights = weightsJson;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const HARD = 99;

// ---------------------------------------------------------------------------
// Hard constraints
// ---------------------------------------------------------------------------

export interface HardFacts {
  certainImpostors: Set<PlayerId>;
  certainCrew: Set<PlayerId>;
  /** bodyFound obs id -> players cleared for that kill */
  clearedForKill: Map<string, Set<PlayerId>>;
  evidence: EvidenceItem[];
  impostorsRemaining: number;
}

export function impostorsRemaining(m: MatchState): number {
  return Math.max(0, m.settings.impostorCount - m.ejections.filter(e => e.wasImpostor).length
    - Object.values(m.players).filter(p => p.knownRole === 'impostor' && p.status !== 'alive' && !m.ejections.some(e => e.player === p.id)).length);
}

export function hardFacts(m: MatchState): HardFacts {
  const imp = new Set<PlayerId>();
  const crew = new Set<PlayerId>();
  const clearedForKill = new Map<string, Set<PlayerId>>();
  const evidence: EvidenceItem[] = [];
  const pname = (p: string) => m.players[p]?.name ?? p;
  const roomName = (r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;

  for (const p of Object.values(m.players)) {
    if (p.knownRole === 'impostor') imp.add(p.id);
    if (p.knownRole === 'crew') crew.add(p.id);
    if (p.isMe && m.myRole === 'crew') crew.add(p.id);
    if (p.isPartner) imp.add(p.id);
  }

  for (const o of m.observations) {
    if (o.type === 'sawVent') { imp.add(o.player); evidence.push(ev(o.player, HARD, 'hard', `Seen venting in ${roomName(o.room)}`, [o.id])); }
    if (o.type === 'sawKill') { imp.add(o.killer); evidence.push(ev(o.killer, HARD, 'hard', `Seen killing ${pname(o.victim)} in ${roomName(o.room)}`, [o.id])); }
    if (o.type === 'sawTask' && o.visualConfirmed && m.settings.visualTasksOn) {
      crew.add(o.player);
      evidence.push(ev(o.player, -HARD, 'hard', `Visual task confirmed in ${roomName(o.room)}`, [o.id], false, 'round_open', { P: pname(o.player), R: roomName(o.room), TASK: o.taskId ? (m.map.tasks.find(t => t.id === o.taskId)?.name ?? o.taskId) : 'a visual task' }));
    }
  }

  for (const e of m.ejections) {
    if (!e.player) continue;
    if (e.wasImpostor === true) imp.add(e.player);
    if (e.wasImpostor === false) crew.add(e.player);
  }

  // A hard clear by the user is a hard fact (they saw the visual task / the kill window themselves).
  for (const [player, { mark, id }] of userMarks(m)) {
    if (mark !== 'hardClear' || imp.has(player)) continue;
    crew.add(player);
    evidence.push(ev(player, -HARD, 'hard', 'Hard-cleared by you', [id]));
  }

  // Kill-window clears through the alibi graph (me + certain crew are anchors; one extra hop).
  const edges = buildAlibiGraph(m);
  const anchors = new Set<PlayerId>([m.me, ...crew]);
  const bodies = m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
  for (const b of bodies) {
    const windowStart = Math.max(0, b.stamp.t - W.killWindow.defaultSec);
    const cleared = new Set<PlayerId>();
    for (const c of killWindowClears(edges, anchors, b.stamp.round, windowStart, b.stamp.t)) {
      if (c.player === m.me) continue;
      cleared.add(c.player);
      const w = c.hops === 1 ? -3 : -3 * 0.7;
      const via = c.via === m.me ? 'me' : pname(c.via);
      evidence.push(ev(c.player, w, 'hard', `With ${via} during the kill window for ${pname(b.victim)}`, [...c.refs, b.id]));
    }
    clearedForKill.set(b.id, cleared);
  }

  // Counting.
  const alive = Object.values(m.players).filter(p => p.status === 'alive');
  const impRemaining = impostorsRemaining(m);
  const knownAliveImp = alive.filter(p => imp.has(p.id)).length;
  if (knownAliveImp >= impRemaining) for (const p of alive) if (!imp.has(p.id)) crew.add(p.id);
  const unknownAlive = alive.filter(p => !imp.has(p.id) && !crew.has(p.id));
  if (unknownAlive.length > 0 && unknownAlive.length === impRemaining - knownAliveImp) for (const p of unknownAlive) imp.add(p.id);

  return { certainImpostors: imp, certainCrew: crew, clearedForKill, evidence, impostorsRemaining: impRemaining };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const SOFT_RULES = [...OBSERVATION_RULES, ...CLAIM_RULES];

export function scoreAll(m: MatchState): SuspectScore[] {
  resetEvidenceIds();
  const hf = hardFacts(m);
  const soft = SOFT_RULES.flatMap(r => r(m));
  const alive = Object.values(m.players).filter(p => p.status === 'alive' && !p.isMe);
  const impRemaining = Math.max(1, hf.impostorsRemaining);
  const prior = Math.log(impRemaining / Math.max(1, alive.length - impRemaining));
  const bodies = m.observations.filter(o => o.type === 'bodyFound').map(o => o.id);

  return alive.map((p): SuspectScore => {
    const evidence = [...hf.evidence, ...soft].filter(e => e.player === p.id);
    const clearedForKills = bodies.filter(b => hf.clearedForKill.get(b)?.has(p.id));

    if (hf.certainImpostors.has(p.id)) return { player: p.id, verdict: 'certainImpostor', logOdds: HARD, probability: 1, evidence, clearedForKills };
    if (hf.certainCrew.has(p.id)) return { player: p.id, verdict: 'certainCrew', logOdds: -HARD, probability: 0, evidence, clearedForKills };

    // Category caps so one noisy category can't dominate.
    const byCat = new Map<string, number>();
    for (const e of evidence) if (e.category !== 'hard') byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.weight * (e.shaky ? 0.5 : 1));
    let logOdds = prior;
    for (const [cat, sum] of byCat) {
      const cap = (W.categoryCap as Record<string, number>)[cat] ?? 3;
      logOdds += Math.max(-cap, Math.min(cap, sum));
    }
    const hardClear = bodies.length > 0 && clearedForKills.length === bodies.length;
    const softClear = clearedForKills.length > 0 && !hardClear;
    for (const e of evidence) if (e.category === 'hard' && e.weight < 0 && e.weight > -HARD) logOdds += e.weight; // kill-window clears

    return {
      player: p.id,
      verdict: hardClear ? 'hardClear' : softClear ? 'softClear' : 'unknown',
      logOdds,
      probability: sigmoid(logOdds),
      evidence,
      clearedForKills,
    };
  }).sort((a, b) => b.logOdds - a.logOdds);
}

export { fmt };
