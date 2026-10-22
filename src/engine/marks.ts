/**
 * User marks with reasons (one click: "sus — proximity to body").
 *
 * The UI builds its dropdown from SUS_REASONS / CLEAR_REASONS and logs
 * `markObservation(player, mark, reason)` as an observation. Each reason has its
 * own weight (data/tactics/weights.json → manual.reasons) and its own label, so the
 * "why" list says what the user actually saw instead of a bare "Marked sus by you".
 *
 * Semantics (see `markHistory`):
 *  - 'neutral' wipes every mark on that player.
 *  - Switching direction (sus ↔ clear / hardClear) replaces the earlier marks.
 *  - Same-direction marks with DIFFERENT reasons stack (fake-tasking AND lying in chat
 *    are two independent things); the same reason in the same round does not.
 *  - A mark is about the round it was made in, so it decays like other soft evidence.
 */
import type { ClearReason, ManualMarkObs, MarkReason, MatchState, PlayerId, SusReason } from '../types/game';
import weightsJson from '../data/tactics/weights.json';

const R = weightsJson.manual.reasons as Record<MarkReason, number>;

export interface MarkReasonInfo<T extends MarkReason = MarkReason> {
  id: T;
  /** Dropdown label (short; the dropdown is ~380 px wide). */
  label: string;
  /** Evidence line shown in the "why" list. */
  evidence: string;
  /** Log-odds weight (+ = sus). From weights.json. */
  weight: number;
  /** Which mark this reason goes with. */
  mark: 'sus' | 'clear';
}

const sus = (id: SusReason, label: string, evidence: string): MarkReasonInfo<SusReason> => ({ id, label, evidence, weight: R[id], mark: 'sus' });
const clr = (id: ClearReason, label: string, evidence: string): MarkReasonInfo<ClearReason> => ({ id, label, evidence, weight: R[id], mark: 'clear' });

/** Ordered by how often they come up in a real round (most common first). */
export const SUS_REASONS: readonly MarkReasonInfo<SusReason>[] = [
  sus('proximityToBody', 'Near the body', 'You saw them near the body'),
  sus('unaccountedFor', 'Unaccounted for', 'You could not place them this round'),
  sus('fakeTasking', 'Fake tasking', 'You saw them fake a task'),
  sus('followedMe', 'Followed me', 'They followed you around'),
  sus('selfReport', 'Self report', 'You think they self-reported'),
  sus('lyingInChat', 'Lying in chat', 'You caught them lying in chat'),
  sus('ventSound', 'Vent sound / pop', 'You heard or glimpsed a vent near them'),
  sus('strangeBehavior', 'Acting strange', 'They acted strangely'),
  sus('other', 'Other', 'Marked sus by you'),
];

export const CLEAR_REASONS: readonly MarkReasonInfo<ClearReason>[] = [
  clr('withMeWholeRound', 'With me all round', 'With you the whole round'),
  clr('sawVisualTask', 'Saw a visual task', 'You saw them do a visual task'),
  clr('taskBarMoved', 'Task bar moved', 'The task bar moved when they finished a task'),
  clr('otherClear', 'Other', 'Round-cleared by you'),
];

const ALL = new Map<MarkReason, MarkReasonInfo>([...SUS_REASONS, ...CLEAR_REASONS].map(r => [r.id, r]));

export const reasonInfo = (r: MarkReason | undefined): MarkReasonInfo | undefined => (r ? ALL.get(r) : undefined);

/** Weight for a mark: explicit override > reason > default per mark. */
export function markWeight(mark: 'sus' | 'clear', reason?: MarkReason, override?: number): number {
  if (override) return override;
  const info = reasonInfo(reason);
  // A clear reason on a sus mark (or vice versa) is a UI slip: trust the mark direction.
  if (info && info.mark === mark) return info.weight;
  return mark === 'sus' ? weightsJson.manual.sus : weightsJson.manual.clear;
}

export function markLabel(mark: 'sus' | 'clear', reason?: MarkReason): string {
  const info = reasonInfo(reason);
  if (info && info.mark === mark) return info.evidence;
  return mark === 'sus' ? 'Marked sus by you' : 'Round-cleared by you';
}

/**
 * The observation payload the UI logs (store.observe adds id / stamp / source / confidence).
 * `onMark(player, 'sus', 'proximityToBody')` → `observe(markObservation(player, 'sus', 'proximityToBody'), toast)`.
 */
export function markObservation(player: PlayerId, mark: ManualMarkObs['mark'], reason?: MarkReason): Pick<ManualMarkObs, 'type' | 'player' | 'mark' | 'reason'> {
  return reason && mark !== 'neutral' && mark !== 'hardClear' ? { type: 'manualMark', player, mark, reason } : { type: 'manualMark', player, mark };
}

/** Toast text for a mark ("Red: sus — near the body"). */
export function markToast(name: string, mark: ManualMarkObs['mark'], reason?: MarkReason): string {
  if (mark === 'neutral') return `${name} unmarked`;
  if (mark === 'hardClear') return `${name}: hard clear`;
  const info = reasonInfo(reason);
  const head = mark === 'sus' ? 'sus' : 'round clear';
  return info && info.mark === mark && info.id !== 'other' && info.id !== 'otherClear' ? `${name}: ${head} — ${info.label.toLowerCase()}` : `${name}: ${head}`;
}

export interface ActiveMark { mark: 'sus' | 'clear' | 'hardClear'; reason?: MarkReason; id: string; round: number; weight?: number }

/** Every mark still in force per player, oldest first (see the semantics at the top). */
export function markHistory(m: MatchState): Map<PlayerId, ActiveMark[]> {
  const out = new Map<PlayerId, ActiveMark[]>();
  const dir = (k: ActiveMark['mark']) => (k === 'sus' ? 1 : -1);
  for (const o of m.observations) {
    if (o.type !== 'manualMark') continue;
    if (o.mark === 'neutral') { out.delete(o.player); continue; }
    const cur = out.get(o.player) ?? [];
    const next: ActiveMark = { mark: o.mark, reason: o.reason, id: o.id, round: o.stamp.round, weight: o.weight };
    if (cur.length && dir(cur[cur.length - 1].mark) !== dir(o.mark)) { out.set(o.player, [next]); continue; }
    // Same reason in the same round replaces (re-clicking is not new evidence).
    const kept = cur.filter(x => !(x.round === next.round && (x.reason ?? '') === (next.reason ?? '') && x.mark === next.mark));
    out.set(o.player, [...kept, next]);
  }
  return out;
}
