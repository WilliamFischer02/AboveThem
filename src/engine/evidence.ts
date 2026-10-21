/** Shared EvidenceItem constructor + formatting (kept tiny to avoid import cycles). */
import type { EvidenceItem, PlayerId } from '../types/game';

let evidenceSeq = 0;
export const resetEvidenceIds = () => { evidenceSeq = 0; };

export const ev = (
  p: PlayerId, weight: number, category: EvidenceItem['category'], label: string, refs: string[],
  shaky = false, kind?: string, vars?: Record<string, string>,
): EvidenceItem => ({ id: `ev${++evidenceSeq}`, player: p, weight, category, label, refs, shaky, kind, vars });

export function fmt(t: number): string {
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
