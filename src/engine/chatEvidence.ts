/**
 * Chat → social evidence: what OTHER players say about a player.
 *
 * Input is chat-nlu's `ChatAssertion` (contract v1). Until that parser is merged — or for
 * lines it did not read — Claim records are adapted into the same shape
 * (`claimsToAssertions`), so there is exactly one weighting path.
 *
 * Weight of one assertion on target X by speaker S:
 *     base(kind, reason) × strength × confidence × credibility(S)
 *   - credibility: certain crew 1.5, cleared-for-every-kill 1.25, otherwise falls from 1 toward
 *     a floor as S's own suspicion rises above the baseline, then × S's chat consistency.
 *   - a known impostor's accusation is a mild clear; a known impostor's vouch is a pair tell.
 * One speaker counts once per target and direction (their strongest, latest stance). Independent
 * speakers stack with diminishing returns: the i-th strongest counts stackDecay^i.
 * Eyewitness claims ("X vented") are heavy — and heavily implicate the speaker when X is
 * certain crew.
 *
 * Double counting: useGameEvents still writes Claim records from the same chat lines. Claims
 * whose chatLineId was read by the NLU are skipped here (contradictions.ts keeps using
 * location / companion / task claims; the accuser-side rules in contradictions.ts are about
 * the accuser's behaviour, not the target, so they do not overlap).
 */
import type { Claim, EvidenceItem, MatchState, PlayerId } from '../types/game';
import type { ChatAssertion, ChatReason, SpeakerProfile } from './chatNluTypes';
import weightsJson from '../data/tactics/weights.json';
import { ev } from './evidence';

const S = weightsJson.social;

export type SpeakerStatus = 'certainCrew' | 'hardClear' | 'certainImpostor' | 'suspect' | 'normal';
export interface SpeakerCred { cred: number; status: SpeakerStatus }
export type CredibilityFn = (p: PlayerId) => SpeakerCred;

export interface ChatEvidenceContext {
  credibility: CredibilityFn;
  /** Players certain to be crew (an eyewitness claim against them is a lie). */
  certainCrew: Set<PlayerId>;
  /** Impostors still unaccounted for beyond the known ones (≥ 1 → "partner" reads make sense). */
  unknownImpostorsLeft: number;
  profiles?: Record<PlayerId, SpeakerProfile>;
  /** Round each meeting discusses (meeting k closes round k unless the log says otherwise). */
  roundOfMeeting?: (meeting: number) => number;
}

const pname = (m: MatchState, p: string) => m.players[p]?.name ?? p;
const NO_REASON: ReadonlySet<ChatReason | undefined> = new Set([undefined, 'sus', 'bare', 'its', 'either']);

// ---------------------------------------------------------------------------
// Claim → assertion adapter (fallback while / where the NLU has nothing)
// ---------------------------------------------------------------------------

function reasonFromText(text?: string): ChatReason | undefined {
  const tag = text?.match(/\[([^\]]+)\]\s*$/)?.[1]?.toLowerCase();
  if (!tag || tag.startsWith('+')) return undefined;
  if (/vent/.test(tag)) return 'vent';
  if (/kill/.test(tag)) return 'kill';
  if (/self/.test(tag)) return 'selfReport';
  if (/near|body/.test(tag)) return 'nearBody';
  if (/follow/.test(tag)) return 'followed';
  if (/fake|task/.test(tag)) return 'fakeTask';
  if (/lie|lying/.test(tag)) return 'lying';
  if (/scan|visual/.test(tag)) return 'visual';
  return 'sus';
}

/** Claims of type accusation / clear / defense → ChatAssertion-shaped records. `skipLines`: chat lines the NLU already read. */
export function claimsToAssertions(m: MatchState, skipLines: ReadonlySet<string> = new Set()): ChatAssertion[] {
  const out: ChatAssertion[] = [];
  for (const c of [...m.claims].sort((a, b) => a.stamp.wall - b.stamp.wall)) {
    if (!c.about || c.about === c.by) continue;
    if (c.chatLineId && skipLines.has(c.chatLineId)) continue;
    const kind = c.type === 'accusation' ? 'accuse' : c.type === 'clear' ? 'clear' : c.type === 'defense' ? 'defense' : null;
    if (!kind) continue;
    const reason = reasonFromText(c.text) ?? (kind === 'accuse' && (c.room || c.timeWindow) ? 'nearBody' : undefined);
    out.push({
      id: c.id, line: c.chatLineId ?? c.id, meeting: c.meeting, speaker: c.by, kind, about: [c.about], reason,
      polarity: kind === 'accuse' ? 1 : -1, strength: 0.8, confidence: c.chatLineId ? 0.8 : 1,
      text: c.text ?? '', span: [0, 0], quote: c.text ?? '', resolvedVia: 'direct', refs: [c.id], why: ['from a logged claim'],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weighting
// ---------------------------------------------------------------------------

/**
 * A "visual" clear only counts as one when visuals are ON and the task (if named) is visual on
 * THIS map (game-knowledge `visual_off_clear`, `visual_wrong_map`): otherwise it is a plain vouch.
 */
export function visualClearValid(m: MatchState, a: ChatAssertion): boolean {
  if (a.reason !== 'visual' && a.reason !== 'scan') return false;
  if (!m.settings.visualTasksOn) return false;
  if (!a.taskId) return true;
  const t = m.map.tasks.find(x => x.id === a.taskId);
  return !!t?.visual;
}

function baseWeight(m: MatchState, a: ChatAssertion): number {
  switch (a.kind) {
    case 'accuse': return NO_REASON.has(a.reason) ? S.accusation : S.accusationWithReason;
    case 'selfReport': return S.accusationWithReason;
    case 'voteCall': return a.negated ? 0 : S.voteCall;
    case 'sawVent': case 'sawKill': return S.eyewitness;
    case 'clear': return visualClearValid(m, a) ? S.clearVisual : S.clear;
    case 'sawTask': return visualClearValid(m, a) ? S.clearVisual : S.sawTask;
    case 'defense': return S.defense;
    case 'withMe': return S.companionUnconfirmed;
    case 'withOther': return S.withOther;
    default: return 0;
  }
}

const verb = (a: ChatAssertion): string => {
  switch (a.kind) {
    case 'sawVent': return 'says they saw them vent';
    case 'sawKill': return 'says they saw them kill';
    case 'selfReport': return 'called it a self-report';
    case 'voteCall': return 'called a vote on them';
    case 'accuse': return a.reason && !NO_REASON.has(a.reason) ? `accused them (${a.reason})` : 'accused them';
    case 'clear': return 'cleared them';
    case 'sawTask': return 'saw them do a task';
    case 'defense': return 'defended them';
    case 'withMe': return 'says they were together';
    case 'withOther': return 'says they were with someone';
    default: return 'mentioned them';
  }
};

const credNote = (c: SpeakerCred) =>
  c.status === 'certainCrew' ? ' — confirmed crew' : c.status === 'hardClear' ? ' — cleared' : c.status === 'suspect' ? ' — suspected, counts less' : '';

interface Contribution { target: PlayerId; speaker: PlayerId; weight: number; a: ChatAssertion; label: string; category: EvidenceItem['category']; kind?: string }

/** Social evidence from assertions (plus a few speaker-side tells). Pure. */
export function assertionsToEvidence(m: MatchState, assertions: ChatAssertion[], ctx: ChatEvidenceContext): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const roundOf = ctx.roundOfMeeting ?? ((k: number) => k);
  const active = assertions.filter(a => !a.supersededBy && a.polarity !== 0);
  const accusersSoFar = new Map<string, Set<PlayerId>>(); // meeting|target → speakers who accused earlier
  const best = new Map<string, Contribution>();             // speaker|target|sign → strongest, latest

  for (const a of active) {
    const sp = a.speaker;
    if (sp === m.me || !m.players[sp]) continue;           // my own words are not evidence; junk cards say nothing
    const c = ctx.credibility(sp);
    for (const x of a.about) {
      if (x === sp || !m.players[x] || x === m.me) continue;
      const base = baseWeight(m, a);
      if (base === 0) continue;
      const k = `${a.meeting}|${x}`;
      const earlier = accusersSoFar.get(k) ?? new Set<PlayerId>();
      let w = base * clamp01(a.strength) * clamp01(a.confidence);
      let label = `${pname(m, sp)} ${verb(a)}${credNote(c)}`;
      let category: EvidenceItem['category'] = 'social';
      let kind: string | undefined;
      const eyewitness = a.kind === 'sawVent' || a.kind === 'sawKill';

      if (a.polarity > 0) {
        if (eyewitness && ctx.certainCrew.has(x)) {
          // Lying eyewitness: the target is confirmed crew, so the SPEAKER is implicated.
          const e = ev(sp, S.falseEyewitness, 'meeting', `Claimed to see ${pname(m, x)} ${a.kind === 'sawVent' ? 'vent' : 'kill'} — ${pname(m, x)} is confirmed crew`, a.refs.length ? a.refs : [a.id], false, 'contradiction',
            { P: pname(m, sp), P2: pname(m, x) });
          e.round = roundOf(a.meeting); out.push(e);
          continue;
        }
        if (c.status === 'certainImpostor') { w = S.impostorAccusesThem; label = `Accused by ${pname(m, sp)}, a known impostor`; }
        else {
          const bandwagon = earlier.size >= 2 && NO_REASON.has(a.reason) && !eyewitness;
          w *= c.cred * (bandwagon ? S.bandwagonFactor : 1);
          if (bandwagon) label += ' (bandwagon)';
        }
        earlier.add(sp); accusersSoFar.set(k, earlier);
      } else {
        if (c.status === 'certainImpostor') {
          if (ctx.unknownImpostorsLeft >= 1) { w = S.vouchedByImpostor; label = `Vouched for by ${pname(m, sp)}, a known impostor — possible partner`; category = 'structural'; kind = 'pair_tell'; }
          else continue;
        } else {
          w *= c.cred;
          if (c.status === 'suspect' && ctx.unknownImpostorsLeft >= 2) {
            const e = ev(x, S.clearFromSuspect, 'structural', `Vouched for by suspected ${pname(m, sp)} — possible impostor partner`, a.refs.length ? a.refs : [a.id], false, 'pair_tell', { P: pname(m, x), P2: pname(m, sp) });
            e.round = roundOf(a.meeting); out.push(e);
          }
        }
      }
      const key = `${sp}|${x}|${Math.sign(w)}|${category}`;
      const prev = best.get(key);
      if (!prev || a.meeting > prev.a.meeting || (a.meeting === prev.a.meeting && Math.abs(w) > Math.abs(prev.weight))) {
        best.set(key, { target: x, speaker: sp, weight: w, a, label, category, kind });
      }
    }
  }

  // Diminishing returns across independent speakers, per target and direction.
  const groups = new Map<string, Contribution[]>();
  for (const c of best.values()) {
    const g = `${c.target}|${Math.sign(c.weight)}|${c.category}`;
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  for (const list of groups.values()) {
    list.sort((p, q) => Math.abs(q.weight) - Math.abs(p.weight));
    list.forEach((c, i) => {
      const factor = Math.pow(S.stackDecay, i);
      const e = ev(c.target, c.weight * factor, c.category, i > 0 ? `${c.label} (+${i} earlier)` : c.label, c.a.refs.length ? c.a.refs : [c.a.id], false, c.kind,
        c.kind ? { P: pname(m, c.target), P2: pname(m, c.speaker) } : undefined);
      e.round = roundOf(c.a.meeting);
      out.push(e);
    });
  }
  return out;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** Credibility multiplier from a speaker's status, own suspicion and chat consistency. */
export function speakerCredibility(status: SpeakerStatus | 'unknown', probability: number, baselineP: number, profile?: SpeakerProfile): SpeakerCred {
  if (status === 'certainCrew') return { cred: S.credibilityHardCleared, status };
  if (status === 'certainImpostor') return { cred: 0, status };
  const consistency = profile ? S.consistencyFloor + (1 - S.consistencyFloor) * clamp01(profile.consistency) : 1;
  if (status === 'hardClear') return { cred: 1.25 * consistency, status };
  const p0 = Math.min(0.95, Math.max(0.01, baselineP));
  const excess = Math.max(0, probability - p0) / (1 - p0);           // 0 at baseline, 1 at certain impostor
  const cred = Math.max(S.credibilityFloor, 1 - excess) * consistency;
  return { cred, status: probability >= Math.max(0.5, 2 * p0) ? 'suspect' : 'normal' };
}

// ---------------------------------------------------------------------------
// Speaker-side tells from chat-nlu's profiles and accusation outcomes
// ---------------------------------------------------------------------------

/**
 * From chat-nlu's SpeakerProfile: own location stated as two rooms in one meeting (`story_changed`),
 * and flipping stance on a target inside one meeting (`flip_when_countered`, low weight).
 */
export function ruleProfileTells(m: MatchState, profiles: Record<PlayerId, SpeakerProfile>, roundOf: (k: number) => number = k => k): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const roomName = (r: string) => m.map.rooms.find(x => x.id === r)?.name ?? r;
  for (const p of Object.values(profiles)) {
    if (!m.players[p.player] || p.player === m.me) continue;
    for (const lc of p.locationChanges) {
      if (lc.rooms.length < 2 || !lc.assertions.length) continue;
      const e = ev(p.player, weightsJson.structural.storyFlipNlu, 'meeting', `Said ${lc.rooms.map(roomName).join(', then ')} in meeting ${lc.meeting + 1}`, lc.assertions);
      e.round = roundOf(lc.meeting); out.push(e);
    }
    const flipMeetings = new Set<number>();
    for (const f of p.flips) {
      if (!f.sameMeeting || flipMeetings.has(f.toMeeting)) continue;
      flipMeetings.add(f.toMeeting);
      const e = ev(p.player, weightsJson.structural.stanceFlipWhenCountered, 'meeting', `Flipped on ${pname(m, f.target)} within meeting ${f.toMeeting + 1}`, [f.fromAssertion, f.toAssertion]);
      e.round = roundOf(f.toMeeting); out.push(e);
    }
  }
  return out;
}

const ACCUSING = new Set(['accuse', 'sawVent', 'sawKill', 'selfReport', 'voteCall']);

/** `dead_accuser`: the player who accused X was killed the very next round (low weight: can be a frame). */
export function ruleDeadAccuser(m: MatchState, assertions: ChatAssertion[], diedRound: (p: PlayerId) => number | undefined, roundOf: (k: number) => number = k => k): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const a of assertions) {
    if (a.supersededBy || a.polarity <= 0 || !ACCUSING.has(a.kind) || a.speaker === m.me) continue;
    const d = diedRound(a.speaker);
    if (d === undefined || d !== roundOf(a.meeting) + 1) continue;
    for (const x of a.about) {
      if (x === a.speaker || !m.players[x] || seen.has(`${a.speaker}|${x}`)) continue;
      seen.add(`${a.speaker}|${x}`);
      const e = ev(x, weightsJson.structural.deadAccuser, 'structural', `${pname(m, a.speaker)} accused them, then died the next round`, a.refs.length ? a.refs : [a.id]);
      e.round = d; out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Silence (needs chat capture; fail soft: no chat → no evidence)
// ---------------------------------------------------------------------------

/**
 * Alive through a closed meeting where others talked (≥ 4 lines from ≥ 2 other speakers),
 * and said nothing at all — no chat line, no logged claim.
 */
export function ruleSilentInMeeting(m: MatchState, aliveAt: (p: PlayerId, meeting: number) => boolean, roundOf: (k: number) => number = k => k): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const closed = new Set(m.ejections.map(e => e.meeting));
  const byMeeting = new Map<number, typeof m.chat>();
  for (const l of m.chat) byMeeting.set(l.meeting, [...(byMeeting.get(l.meeting) ?? []), l]);
  for (const [k, lines] of byMeeting) {
    if (!closed.has(k)) continue;
    const speakers = new Set(lines.map(l => l.sender));
    if (lines.length < 4 || speakers.size < 2) continue;
    for (const p of Object.values(m.players)) {
      if (p.isMe || speakers.has(p.id) || !aliveAt(p.id, k)) continue;
      if (m.claims.some((c: Claim) => c.by === p.id && c.meeting === k)) continue;
      const e = ev(p.id, weightsJson.meeting.silentInMeeting, 'meeting', `Said nothing in meeting ${k + 1} while others talked`, lines.slice(0, 3).map(l => l.id));
      e.round = roundOf(k); out.push(e);
    }
  }
  return out;
}
