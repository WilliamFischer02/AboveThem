/**
 * Suspicion scoring — hard constraints first, then weighted soft evidence.
 *
 * This is a working skeleton: hard constraints and a handful of soft rules are
 * implemented so the pipeline is end-to-end testable. Phase 1 fills in the rest
 * of the rules listed in docs/DEDUCTION_ENGINE.md §3. Keep every rule as a
 * small function that returns EvidenceItem[] so they stay individually testable.
 */
import type {
  MatchState, PlayerId, SuspectScore, EvidenceItem, Observation,
  BodyFoundObs, SightingObs,
} from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { isDeadEnd, reachableOnFoot, ventConnected } from './map';

type Weights = typeof weightsJson;
const W: Weights = weightsJson;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
let evidenceSeq = 0;
const ev = (p: PlayerId, weight: number, category: EvidenceItem['category'], label: string, refs: string[], shaky = false): EvidenceItem =>
  ({ id: `ev${++evidenceSeq}`, player: p, weight, category, label, refs, shaky });

// ---------------------------------------------------------------------------
// Hard constraints
// ---------------------------------------------------------------------------

export interface HardFacts {
  certainImpostors: Set<PlayerId>;
  certainCrew: Set<PlayerId>;
  /** bodyFound obs id -> players cleared for that kill */
  clearedForKill: Map<string, Set<PlayerId>>;
  evidence: EvidenceItem[];
}

export function hardFacts(m: MatchState): HardFacts {
  const imp = new Set<PlayerId>();
  const crew = new Set<PlayerId>();
  const clearedForKill = new Map<string, Set<PlayerId>>();
  const evidence: EvidenceItem[] = [];

  for (const p of Object.values(m.players)) {
    if (p.knownRole === 'impostor') imp.add(p.id);
    if (p.knownRole === 'crew') crew.add(p.id);
    if (p.isMe && m.myRole === 'crew') crew.add(p.id);
    if (p.isPartner) imp.add(p.id);
  }

  for (const o of m.observations) {
    if (o.type === 'sawVent') { imp.add(o.player); evidence.push(ev(o.player, 99, 'hard', `Seen venting in ${o.room}`, [o.id])); }
    if (o.type === 'sawKill') { imp.add(o.killer); evidence.push(ev(o.killer, 99, 'hard', `Seen killing ${o.victim} in ${o.room}`, [o.id])); }
    if (o.type === 'sawTask' && o.visualConfirmed && m.settings.visualTasksOn) {
      crew.add(o.player);
      evidence.push(ev(o.player, -99, 'hard', `Visual task confirmed in ${o.room}`, [o.id]));
    }
  }

  for (const e of m.ejections) {
    if (!e.player) continue;
    if (e.wasImpostor === true) imp.add(e.player);
    if (e.wasImpostor === false) crew.add(e.player);
  }

  // Kill-window clears: anyone continuously "with me" across the window is clear for that kill.
  const bodies = m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
  for (const b of bodies) {
    const windowStart = Math.max(0, b.stamp.t - W.killWindow.defaultSec);
    const cleared = new Set<PlayerId>();
    for (const p of Object.values(m.players)) {
      if (p.isMe) continue;
      if (wasWithMeThroughout(m.observations, p.id, b.stamp.round, windowStart, b.stamp.t)) {
        cleared.add(p.id);
        evidence.push(ev(p.id, -3, 'hard', `With me during kill window for ${b.victim}`, [b.id]));
      }
    }
    clearedForKill.set(b.id, cleared);
  }

  // Counting: if all impostors are known, everyone else is crew.
  const alive = Object.values(m.players).filter(p => p.status === 'alive');
  const impRemaining = m.settings.impostorCount - m.ejections.filter(e => e.wasImpostor).length;
  const knownAliveImp = alive.filter(p => imp.has(p.id)).length;
  if (knownAliveImp >= impRemaining) for (const p of alive) if (!imp.has(p.id)) crew.add(p.id);
  const unknownAlive = alive.filter(p => !imp.has(p.id) && !crew.has(p.id));
  if (unknownAlive.length > 0 && unknownAlive.length === impRemaining - knownAliveImp) for (const p of unknownAlive) imp.add(p.id);

  return { certainImpostors: imp, certainCrew: crew, clearedForKill, evidence };
}

/** True if the player was flagged "with me" (on) and not flagged off within [t0, t1] of the round. */
function wasWithMeThroughout(obs: Observation[], p: PlayerId, round: number, t0: number, t1: number): boolean {
  let with_ = false;
  let coveredFrom = Infinity;
  for (const o of obs) {
    if (o.stamp.round !== round || o.stamp.t > t1) continue;
    if (o.type === 'withMe' && o.player === p) {
      if (o.on) { if (!with_) coveredFrom = o.stamp.t; with_ = true; }
      else { with_ = false; coveredFrom = Infinity; }
    }
  }
  return with_ && coveredFrom <= t0;
}

// ---------------------------------------------------------------------------
// Soft evidence rules (each returns EvidenceItem[])
// ---------------------------------------------------------------------------

function ruleManualMarks(m: MatchState): EvidenceItem[] {
  return m.observations.flatMap(o => {
    if (o.type !== 'manualMark' || o.mark === 'neutral') return [];
    const w = o.weight ?? (o.mark === 'sus' ? W.manual.sus : W.manual.clear);
    return [ev(o.player, w, 'manual', `Marked ${o.mark} by you`, [o.id])];
  });
}

function ruleSelfReport(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const o of m.observations) {
    if (o.type !== 'bodyFound' || !o.reporter) continue;
    const alone = !o.present || o.present.filter(p => p !== o.reporter).length === 0;
    if (!alone) continue;
    let w = W.movement.selfReportAlone;
    const dead = isDeadEnd(m.map, o.room);
    if (dead) w += W.movement.selfReportDeadEndBonus;
    out.push(ev(o.reporter, w, 'movement', `Self-reported alone in ${o.room}${dead ? ' (dead end)' : ''}`, [o.id], !m.map._verified.rooms));
  }
  return out;
}

/** Players last seen heading toward / near the body room inside the kill window, alone. */
function ruleProximityToKill(m: MatchState): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const bodies = m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
  const sightings = m.observations.filter((o): o is SightingObs => o.type === 'sighting');
  for (const b of bodies) {
    const t0 = Math.max(0, b.stamp.t - W.killWindow.defaultSec);
    for (const s of sightings) {
      if (s.stamp.round !== b.stamp.round || s.stamp.t < t0 || s.stamp.t > b.stamp.t) continue;
      if (s.player === b.victim) continue;
      const alone = s.alone ?? (!s.withPlayers || s.withPlayers.length === 0);
      const towardBody = s.heading === b.room || s.room === b.room;
      if (towardBody && alone) {
        out.push(ev(s.player, W.movement.headingToBodyRoomInWindowAlone, 'movement', `Alone near ${b.room} at ${fmt(s.stamp.t)} (kill window)`, [s.id, b.id]));
      }
      // Could they even have reached the body room? If only via vent → near-hard.
      const onFoot = reachableOnFoot(m.map, s.room, b.room, s.stamp.t, b.stamp.t, m.settings.playerSpeed);
      if (!onFoot && ventConnected(m.map, s.room, b.room)) {
        out.push(ev(s.player, W.movement.ventOnlyReachable, 'movement', `Could only reach ${b.room} from ${s.room} by vent`, [s.id, b.id], !m.map._verified.vents));
      }
    }
  }
  return out;
}

const SOFT_RULES: Array<(m: MatchState) => EvidenceItem[]> = [
  ruleManualMarks,
  ruleSelfReport,
  ruleProximityToKill,
  // Phase 1: add task rules, meeting/claim rules, sabotage rules, structural rules.
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreAll(m: MatchState): SuspectScore[] {
  evidenceSeq = 0;
  const hf = hardFacts(m);
  const soft = SOFT_RULES.flatMap(r => r(m));
  const alive = Object.values(m.players).filter(p => p.status === 'alive' && !p.isMe);
  const impRemaining = Math.max(1, m.settings.impostorCount - m.ejections.filter(e => e.wasImpostor).length);
  const prior = Math.log(impRemaining / Math.max(1, alive.length - impRemaining));

  const bodies = m.observations.filter(o => o.type === 'bodyFound').map(o => o.id);

  return alive.map((p): SuspectScore => {
    const evidence = [...hf.evidence, ...soft].filter(e => e.player === p.id);
    const clearedForKills = bodies.filter(b => hf.clearedForKill.get(b)?.has(p.id));

    if (hf.certainImpostors.has(p.id)) return { player: p.id, verdict: 'certainImpostor', logOdds: 99, probability: 1, evidence, clearedForKills };
    if (hf.certainCrew.has(p.id)) return { player: p.id, verdict: 'certainCrew', logOdds: -99, probability: 0, evidence, clearedForKills };

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
    if (hardClear) logOdds -= 3;

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

export function fmt(t: number): string {
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
