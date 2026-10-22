/**
 * MERGE STUB (ui-streamline): suspicion-core owns the real src/engine/marks.ts.
 * This file only mirrors the exported names and shapes from
 * scratchpad/relay/from-suspicion-core.md so the UI compiles on this branch.
 * At merge: TAKE suspicion-core's version wholesale and delete this stub.
 * The weights/labels below are placeholders, not tuned values.
 */
import type { PlayerId } from '../types/game';

export type SusReason = 'proximityToBody' | 'unaccountedFor' | 'strangeBehavior' | 'followedMe' | 'fakeTasking'
  | 'ventSound' | 'lyingInChat' | 'selfReport' | 'other';
export type ClearReason = 'withMeWholeRound' | 'sawVisualTask' | 'taskBarMoved' | 'otherClear';
export type MarkReason = SusReason | ClearReason;

export interface MarkReasonInfo<T extends MarkReason = MarkReason> { id: T; label: string; evidence: string; weight: number; mark: 'sus' | 'clear' }

export const SUS_REASONS: readonly MarkReasonInfo<SusReason>[] = [
  { id: 'proximityToBody', label: 'Near the body', evidence: 'You saw them near the body', weight: 1.0, mark: 'sus' },
  { id: 'unaccountedFor', label: 'Unaccounted for', evidence: 'Nobody can place them', weight: 0.6, mark: 'sus' },
  { id: 'strangeBehavior', label: 'Acting weird', evidence: 'You saw strange movement', weight: 0.6, mark: 'sus' },
  { id: 'followedMe', label: 'Followed me', evidence: 'They followed you', weight: 0.7, mark: 'sus' },
  { id: 'fakeTasking', label: 'Fake tasking', evidence: 'Task looked faked', weight: 1.0, mark: 'sus' },
  { id: 'ventSound', label: 'Vent sound', evidence: 'Vent sound near them', weight: 0.8, mark: 'sus' },
  { id: 'lyingInChat', label: 'Lying in chat', evidence: 'Their story does not match', weight: 1.0, mark: 'sus' },
  { id: 'selfReport', label: 'Self-report', evidence: 'Looks like a self-report', weight: 0.9, mark: 'sus' },
  { id: 'other', label: 'Other', evidence: 'Marked sus by you', weight: 0.8, mark: 'sus' },
];

export const CLEAR_REASONS: readonly MarkReasonInfo<ClearReason>[] = [
  { id: 'withMeWholeRound', label: 'With me all round', evidence: 'With you the whole round', weight: -1.2, mark: 'clear' },
  { id: 'sawVisualTask', label: 'Visual task', evidence: 'You saw a visual task', weight: -1.5, mark: 'clear' },
  { id: 'taskBarMoved', label: 'Task bar moved', evidence: 'Task bar moved after their task', weight: -1.0, mark: 'clear' },
  { id: 'otherClear', label: 'Other', evidence: 'Cleared by you', weight: -0.8, mark: 'clear' },
];

export type MarkKind = 'sus' | 'clear' | 'hardClear' | 'neutral';

export function reasonInfo(reason?: MarkReason | string): MarkReasonInfo | undefined {
  if (!reason) return undefined;
  return [...SUS_REASONS, ...CLEAR_REASONS].find(r => r.id === reason);
}

export function markObservation(player: PlayerId, mark: MarkKind, reason?: MarkReason): { type: 'manualMark'; player: PlayerId; mark: MarkKind; reason?: MarkReason } {
  return reason ? { type: 'manualMark', player, mark, reason } : { type: 'manualMark', player, mark };
}

export function markToast(name: string, mark: MarkKind, reason?: MarkReason): string {
  const base = mark === 'sus' ? 'sus' : mark === 'clear' ? 'round clear' : mark === 'hardClear' ? 'hard clear' : 'unmarked';
  if (mark === 'neutral') return `${name} unmarked`;
  const r = reasonInfo(reason);
  return `${name}: ${base}${r ? ' — ' + r.label.toLowerCase() : ''}`;
}
