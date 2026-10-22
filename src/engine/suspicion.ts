/**
 * Suspicion scoring — hard constraints first, then weighted soft evidence.
 *
 * Pipeline (docs/DEDUCTION_ENGINE.md §3–§6):
 *   1. hardFacts: certainties (vent / kill / visual task / ejections / counting / kill-window clears).
 *   2. base evidence: observation rules (rules.ts, feasibility.ts), claim rules (contradictions.ts),
 *      voting rules (voting.ts).
 *   3. pass 1 → each player's credibility as a SPEAKER (a suspected player's accusations count less).
 *   4. social evidence: what others said about each player (chatEvidence.ts), credibility-weighted.
 *   5. recurrence: suspicious in several separate rounds.
 *   6. combine: time decay per category → category caps → impostor-count normalisation
 *      (probabilities over unresolved players sum to the impostors still at large).
 *   7. trend: the same pipeline on the match as known at the end of each earlier meeting.
 *
 * Every number on a SuspectScore is a sum of EvidenceItems (plus the shared baseline), and
 * every EvidenceItem carries refs to the observations / claims / votes it came from.
 */
import type { MatchState, PlayerId, SuspectScore, EvidenceItem, BodyFoundObs, Claim } from '../types/game';
import weightsJson from '../data/tactics/weights.json';
import { buildAlibiGraph, killWindowClears } from './alibi';
import { OBSERVATION_RULES } from './rules';
import { CLAIM_RULES } from './contradictions';
import { VOTING_RULES } from './voting';
import { killWindow, ruleKillFeasibility, travelLowerBound } from './feasibility';
import { markHistory } from './marks';
import { ev, fmt, resetEvidenceIds } from './evidence';
import { assertionsToEvidence, chatAssertions, ruleDeadAccuser, ruleProfileTells, ruleSilentInMeeting, speakerCredibility, type SpeakerCred, type SpeakerStatus } from './chatEvidence';
import { speakerProfiles } from './chatProfile';
import { aliveAtMeeting, completedMeetings, currentMeeting, deathOf, nowRound, roundOfMeeting, snapshotAtMeeting } from './history';
import { impostorPairs, ruleMutualAlibiPair, type PairSignal } from './pairs';
import { walkSeconds } from './map';

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
  for (const [player, list] of markHistory(m)) {
    const hc = list.find(k => k.mark === 'hardClear');
    if (!hc || imp.has(player)) continue;
    crew.add(player);
    evidence.push(ev(player, -HARD, 'hard', 'Hard-cleared by you', [hc.id]));
  }

  // Kill-window clears through the alibi graph (me + certain crew are anchors; one extra hop).
  // The window starts no earlier than the kill cooldown allows (feasibility.killWindow).
  const edges = buildAlibiGraph(m);
  const anchors = new Set<PlayerId>([m.me, ...crew]);
  const bodies = m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
  const soloImpostor = m.settings.impostorCount === 1;
  for (const b of bodies) {
    const [windowStart, windowEnd] = killWindow(m, b);
    const cleared = new Set<PlayerId>();
    for (const c of killWindowClears(edges, anchors, b.stamp.round, windowStart, windowEnd)) {
      if (c.player === m.me) continue;
      cleared.add(c.player);
      const via = c.via === m.me ? 'me' : pname(c.via);
      // One impostor in the lobby + with me (my own eyes) through the whole window = they did not kill = crew.
      if (soloImpostor && c.hops === 1 && c.via === m.me && m.myRole !== 'impostor' && !imp.has(c.player)) {
        crew.add(c.player);
        evidence.push(ev(c.player, -HARD, 'hard', `With me through the whole kill window for ${pname(b.victim)} (only 1 impostor)`, [...c.refs, b.id]));
        continue;
      }
      const w = c.hops === 1 ? -3 : -3 * 0.7;
      evidence.push(ev(c.player, w, 'hard', `With ${via} during the kill window for ${pname(b.victim)} (${fmt(windowStart)}–${fmt(windowEnd)})`, [...c.refs, b.id]));
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
// Decay, caps, normalisation
// ---------------------------------------------------------------------------

export const SOFT_RULES = [...OBSERVATION_RULES, ...CLAIM_RULES, ...VOTING_RULES, ruleKillFeasibility, ruleMutualAlibiPair];

export { chatAssertions };

/** Candidate impostor pairs among unresolved players (display: "watch this pair"). */
export function suspectPairs(m: MatchState): PairSignal[] {
  const hf = hardFacts(m);
  return impostorPairs(m, chatAssertions(m), new Set([...hf.certainCrew, ...hf.certainImpostors]));
}

/** id → round for everything an EvidenceItem can reference. */
function refRounds(m: MatchState): Map<string, number> {
  const out = new Map<string, number>();
  const roundOf = roundOfMeeting(m);
  for (const o of m.observations) out.set(o.id, o.stamp.round);
  for (const c of m.claims) out.set(c.id, c.stamp.round);
  for (const l of m.chat) out.set(l.id, l.stamp.round);
  for (const k of new Set([...m.votes.map(v => v.meeting), ...m.ejections.map(e => e.meeting)])) {
    out.set(`votes${k}`, roundOf(k)); out.set(`ej${k}`, roundOf(k));
  }
  return out;
}

/** 0..1 age multiplier: 0.5^(age / halfLife), floored; hard facts and half-life 0 never decay. */
export function decayFactor(category: EvidenceItem['category'], age: number): number {
  if (category === 'hard' || age <= 0) return 1;
  const hl = (W.decay.halfLifeRounds as Record<string, number>)[category] ?? 0;
  if (!hl) return 1;
  return Math.max(W.decay.floor, Math.pow(0.5, age / hl));
}

/** Annotate raw rule output with round, decay and the weight actually applied. */
function annotate(m: MatchState, raw: EvidenceItem[]): EvidenceItem[] {
  const rounds = refRounds(m);
  const now = nowRound(m);
  return raw.map(e => {
    const fromRefs = e.refs.map(r => rounds.get(r)).filter((x): x is number => x !== undefined);
    const round = e.round ?? (fromRefs.length ? Math.max(...fromRefs) : now);
    const decay = decayFactor(e.category, now - round);
    const shaky = e.category !== 'hard' && e.shaky ? 0.5 : 1;
    return { ...e, round, decay, baseWeight: e.weight, weight: e.weight * decay * shaky };
  });
}

/** Category-capped evidence sum (no baseline). */
function capSum(evidence: EvidenceItem[]): number {
  const byCat = new Map<string, number>();
  let hardSoft = 0;
  for (const e of evidence) {
    if (e.category === 'hard') { if (e.weight < 0 && e.weight > -HARD) hardSoft += e.weight; continue; } // kill-window clears
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.weight);
  }
  let s = hardSoft;
  for (const [cat, sum] of byCat) {
    const cap = (W.categoryCap as Record<string, number>)[cat] ?? 3;
    s += Math.max(-cap, Math.min(cap, sum));
  }
  return s;
}

/**
 * Offset c with Σ sigmoid(L_i + c) = k over the unresolved pool (k = impostors not yet known).
 * With no evidence this is exactly the prior ln(k / (n − k)); with evidence it keeps the
 * probabilities honest: clearing three players makes the other two more likely, not nobody.
 */
export function countOffset(L: number[], k: number): number {
  const n = L.length;
  if (n === 0 || k <= 0 || k >= n) return 0;
  let lo = -80, hi = 80;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const s = L.reduce((a, l) => a + sigmoid(l + mid), 0);
    if (s > k) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

interface Combined { scores: SuspectScore[]; baselineP: number }

function combine(m: MatchState, hf: HardFacts, evidence: EvidenceItem[]): Combined {
  const alive = Object.values(m.players).filter(p => p.status === 'alive' && !p.isMe);
  const bodies = m.observations.filter(o => o.type === 'bodyFound').map(o => o.id);
  const byPlayer = new Map<PlayerId, EvidenceItem[]>();
  for (const e of evidence) byPlayer.set(e.player, [...(byPlayer.get(e.player) ?? []), e]);

  const pool = alive.filter(p => !hf.certainImpostors.has(p.id) && !hf.certainCrew.has(p.id));
  const knownAliveImp = Object.values(m.players).filter(p => p.status === 'alive' && hf.certainImpostors.has(p.id)).length;
  const k = Math.max(0, hf.impostorsRemaining - knownAliveImp);
  const raw = new Map(pool.map(p => [p.id, capSum(byPlayer.get(p.id) ?? [])]));
  const offset = pool.length && k > 0 && k < pool.length
    ? countOffset(pool.map(p => raw.get(p.id)!), k)
    : Math.log(Math.max(1, hf.impostorsRemaining) / Math.max(1, alive.length - Math.max(1, hf.impostorsRemaining)));
  const baselineP = pool.length ? Math.min(0.99, Math.max(0.01, k / pool.length)) : 0;
  const baseline = {
    logOdds: offset,
    label: pool.length ? `${k} impostor${k === 1 ? '' : 's'} left among ${pool.length} unresolved player${pool.length === 1 ? '' : 's'}` : 'Everyone is resolved',
  };

  const scores = alive.map((p): SuspectScore => {
    const ev0 = byPlayer.get(p.id) ?? [];
    const evidence = [...ev0].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const clearedForKills = bodies.filter(b => hf.clearedForKill.get(b)?.has(p.id));
    if (hf.certainImpostors.has(p.id)) return { player: p.id, verdict: 'certainImpostor', logOdds: HARD, probability: 1, evidence, clearedForKills, baseline };
    if (hf.certainCrew.has(p.id)) return { player: p.id, verdict: 'certainCrew', logOdds: -HARD, probability: 0, evidence, clearedForKills, baseline };
    const logOdds = (raw.get(p.id) ?? 0) + offset;
    const hardClear = bodies.length > 0 && clearedForKills.length === bodies.length;
    const softClear = clearedForKills.length > 0 && !hardClear;
    return { player: p.id, verdict: hardClear ? 'hardClear' : softClear ? 'softClear' : 'unknown', logOdds, probability: sigmoid(logOdds), evidence, clearedForKills, baseline };
  }).sort((a, b) => b.logOdds - a.logOdds);
  return { scores, baselineP };
}

// ---------------------------------------------------------------------------
// Social evidence, recurrence, witness contradictions
// ---------------------------------------------------------------------------

function credibilityFrom(m: MatchState, hf: HardFacts, pass1: Combined): (p: PlayerId) => SpeakerCred {
  const profiles = speakerProfiles(m);
  const byId = new Map(pass1.scores.map(s => [s.player, s]));
  return (p: PlayerId) => {
    if (hf.certainImpostors.has(p)) return speakerCredibility('certainImpostor', 1, pass1.baselineP);
    if (hf.certainCrew.has(p)) return speakerCredibility('certainCrew', 0, pass1.baselineP);
    const s = byId.get(p);
    if (!s) return speakerCredibility('normal', pass1.baselineP, pass1.baselineP, profiles[p]); // dead / not scored: neutral
    const status: SpeakerStatus | 'unknown' = s.verdict === 'hardClear' ? 'hardClear' : 'unknown';
    return speakerCredibility(status, s.probability, pass1.baselineP, profiles[p]);
  };
}

/**
 * Location claim by X vs a sighting claim about X by Y, both with time windows that cannot
 * both be true on foot. A certain-crew witness makes it a strong contradiction for X; otherwise
 * one of the two is lying and both take a little.
 */
export function ruleWitnessContradiction(m: MatchState, certainCrew: Set<PlayerId>): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const pname = (p: string) => m.players[p]?.name ?? p;
  const roomName = (r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
  const locs = m.claims.filter(c => c.type === 'location' && c.room && c.timeWindow);
  const sights = m.claims.filter((c): c is Claim & { about: PlayerId } => c.type === 'sighting' && !!c.about && !!c.room && !!c.timeWindow && c.about !== c.by);
  for (const l of locs) for (const s of sights) {
    if (s.about !== l.by || s.stamp.round !== l.stamp.round || s.room === l.room) continue;
    const [a0, a1] = l.timeWindow!, [b0, b1] = s.timeWindow!;
    const gap = Math.max(0, Math.max(b0 - a1, a0 - b1));
    if (travelLowerBound(walkSeconds(m.map, l.room!, s.room!, m.settings.playerSpeed)) <= gap) continue;
    const tag = { P: pname(l.by), R: roomName(l.room!), R2: roomName(s.room!), T: fmt(b0), W: pname(s.by) };
    if (certainCrew.has(s.by)) {
      out.push(ev(l.by, W.meeting.witnessContradiction, 'meeting', `Claimed ${roomName(l.room!)}, but confirmed-crew ${pname(s.by)} saw them in ${roomName(s.room!)}`, [l.id, s.id], !m.map._verified.rooms, 'contradiction', tag));
    } else {
      out.push(ev(l.by, W.meeting.unreliableContradiction, 'meeting', `${pname(s.by)} says they were in ${roomName(s.room!)}, not ${roomName(l.room!)}`, [l.id, s.id], !m.map._verified.rooms, 'contradiction', tag));
      out.push(ev(s.by, W.meeting.unreliableContradiction / 2, 'meeting', `Their sighting of ${pname(l.by)} contradicts ${pname(l.by)}'s claim — one of them is lying`, [l.id, s.id], !m.map._verified.rooms));
    }
  }
  return out;
}

/** Suspicious in ≥ 2 separate rounds (independent signals beat one loud round). */
function ruleRecurrence(evidence: EvidenceItem[]): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const per = new Map<PlayerId, Map<number, { sum: number; refs: string[] }>>();
  for (const e of evidence) {
    if (e.category === 'hard' || e.category === 'manual' || e.category === 'social' || e.round === undefined) continue;
    const w = e.baseWeight ?? e.weight;
    if (w <= 0) continue;
    const pm = per.get(e.player) ?? new Map();
    const cur = pm.get(e.round) ?? { sum: 0, refs: [] };
    cur.sum += w; cur.refs.push(...e.refs);
    pm.set(e.round, cur); per.set(e.player, pm);
  }
  for (const [p, rounds] of per) {
    const hot = [...rounds.entries()].filter(([, v]) => v.sum >= 0.6);
    if (hot.length < 2) continue;
    const refs = [...new Set(hot.flatMap(([, v]) => v.refs))].slice(0, 8);
    const e = ev(p, W.structural.recurrence * (hot.length - 1), 'structural', `Suspicious in ${hot.length} separate rounds (${hot.map(([r]) => r + 1).sort((a, b) => a - b).join(', ')})`, refs);
    e.round = Math.max(...hot.map(([r]) => r));
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** One full pass without the trend (used for the current state and for each snapshot). */
function scoreCore(m: MatchState): SuspectScore[] {
  const hf = hardFacts(m);
  const base = annotate(m, [...hf.evidence, ...SOFT_RULES.flatMap(r => r(m))]);
  const pass1 = combine(m, hf, base);

  const roundOf = roundOfMeeting(m);
  const assertions = chatAssertions(m);
  const profiles = speakerProfiles(m);
  const knownAliveImp = Object.values(m.players).filter(p => p.status === 'alive' && hf.certainImpostors.has(p.id)).length;
  const social = annotate(m, [
    ...assertionsToEvidence(m, assertions, {
      credibility: credibilityFrom(m, hf, pass1),
      certainCrew: hf.certainCrew,
      unknownImpostorsLeft: Math.max(0, hf.impostorsRemaining - knownAliveImp),
      profiles,
      roundOfMeeting: roundOf,
    }),
    ...ruleSilentInMeeting(m, (p, k) => aliveAtMeeting(m, p, k), roundOf),
    ...ruleWitnessContradiction(m, hf.certainCrew),
    ...ruleProfileTells(m, profiles, roundOf),
    ...ruleDeadAccuser(m, assertions, p => deathOf(m, p).diedRound, roundOf),
  ]);
  const all = [...base, ...social];
  const rec = annotate(m, ruleRecurrence(all));
  return combine(m, hf, [...all, ...rec]).scores;
}

/**
 * Past meetings rarely change, so snapshot probabilities are memoised by a content signature
 * (counts + last ids of everything the snapshot keeps, plus roster facts). Bounded LRU-ish map.
 */
const SNAP_CACHE = new Map<string, Map<PlayerId, number>>();
function snapshotSignature(s: MatchState, k: number): string {
  const last = <T extends { id?: string }>(xs: T[]) => `${xs.length}:${xs.length ? (xs[xs.length - 1].id ?? '') : ''}`;
  const roster = Object.values(s.players).map(p => `${p.id}/${p.name}/${p.status}/${p.knownRole}/${p.isPartner ? 1 : 0}/${p.isMe ? 1 : 0}`).sort().join(',');
  return [s.id, k, s.me, s.myRole, JSON.stringify(s.settings), s.map.id, last(s.observations), last(s.claims), last(s.chat),
    JSON.stringify(s.votes), JSON.stringify(s.ejections), roster, JSON.stringify(s.myTasks ?? [])].join('|');
}
function snapshotProbabilities(m: MatchState, k: number): Map<PlayerId, number> {
  const snap = snapshotAtMeeting(m, k);
  const sig = snapshotSignature(snap, k);
  const hit = SNAP_CACHE.get(sig);
  if (hit) return hit;
  resetEvidenceIds();
  const out = new Map(scoreCore(snap).map(s => [s.player, s.probability]));
  if (SNAP_CACHE.size > 64) SNAP_CACHE.delete(SNAP_CACHE.keys().next().value!);
  SNAP_CACHE.set(sig, out);
  return out;
}

export function scoreAll(m: MatchState): SuspectScore[] {
  // Trend first (its evidence ids are thrown away), then the real pass with fresh ids.
  const points = new Map<PlayerId, { meeting: number; probability: number }[]>();
  for (const k of completedMeetings(m)) {
    for (const [player, probability] of snapshotProbabilities(m, k)) points.set(player, [...(points.get(player) ?? []), { meeting: k, probability }]);
  }
  resetEvidenceIds();
  const now = currentMeeting(m);
  return scoreCore(m).map(s => {
    const past = points.get(s.player) ?? [];
    const trend = [...past, { meeting: now, probability: s.probability }];
    const delta = past.length ? s.probability - past[past.length - 1].probability : 0;
    const scored: SuspectScore = { ...s, trend, delta };
    scored.summary = summarize(m, scored);
    return scored;
  });
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

/** The n strongest reasons (|weight|), ignoring noise below 0.05. */
export function topReasons(score: SuspectScore, n = 3): EvidenceItem[] {
  return [...score.evidence].filter(e => Math.abs(e.weight) >= 0.05).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, n);
}

/** Lower-case the first letter only for sentence words ("Seen venting" → "seen venting"), never names ("Swipe Card", "Red"). */
const SENTENCE_START = /^(Seen|Self|Alone|Last|Nobody|Claimed|Claims|Could|Story|Marked|Round|Hard|With|Visual|Voted|Pushed|Skipped|Said|Suspicious|At|Accused|Bandwagoned|Location|Defended|Confirmed|Task|Stood|Fixed|You|They|The|No|Everyone|Only|Vouched)\b/;
const lower1 = (s: string) => (SENTENCE_START.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** One line for the card: "2 accusations · alone near Electrical at 0:35 (kill window)". */
export function summarize(m: MatchState, s: SuspectScore): string {
  if (s.verdict === 'certainImpostor' || s.verdict === 'certainCrew') {
    const hard = s.evidence.find(e => e.category === 'hard' && Math.abs(e.weight) >= HARD);
    return (s.verdict === 'certainImpostor' ? 'Impostor: ' : 'Crew: ') + (hard ? lower1(hard.label) : s.verdict === 'certainImpostor' ? 'by counting' : 'by counting / ejection');
  }
  const parts: string[] = [];
  const social = s.evidence.filter(e => e.category === 'social' && Math.abs(e.weight) >= 0.05);
  const acc = social.filter(e => e.weight > 0).length, clr = social.filter(e => e.weight < 0).length;
  if (acc) parts.push(`${acc} accusation${acc === 1 ? '' : 's'}`);
  if (clr) parts.push(`${clr} vouch${clr === 1 ? '' : 'es'}`);
  for (const e of topReasons(s, 4)) {
    if (e.category === 'social' || parts.length >= 3) continue;
    parts.push(lower1(e.label));
  }
  if (!parts.length) return `No evidence yet — ${s.baseline ? lower1(s.baseline.label) : 'at the prior'}`;
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export { fmt };
