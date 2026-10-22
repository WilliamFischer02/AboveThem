/**
 * "Possible pair: Red + Blue · why" — candidate impostor pair from suspicion-core's suspectPairs(m)
 * (display only; 2+ impostor lobbies). Imported defensively through the module namespace so this
 * compiles and renders nothing until suspicion-core's export is on the branch.
 * MERGE: once `suspectPairs` is exported from engine/suspicion.ts this just starts working.
 */
import { useMemo, useRef, useState } from 'react';
import type { MatchState, PlayerId } from '../../types/game';
import * as suspicion from '../../engine/suspicion';
import { useMatch } from '../../state/store';
import { PlayerIcon } from './Crewmate';
import { Popover } from './Popover';

interface Pair { a: PlayerId; b: PlayerId; score: number; reasons: string[]; refs?: string[] }
type PairsFn = (m: MatchState) => Pair[];

/** Show only reasonably strong pairs; suspicion-core's score is 0..1 (assumed — UNVERIFIED until merge). */
export const PAIR_MIN = 0.5;

export function PairChip() {
  const match = useMatch(s => s.match)!;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pair = useMemo(() => {
    const fn = (suspicion as unknown as Record<string, unknown>).suspectPairs as PairsFn | undefined;
    if (typeof fn !== 'function' || match.settings.impostorCount < 2) return null;
    try {
      const alive = (id: PlayerId) => match.players[id]?.status === 'alive';
      return fn(match).filter(p => alive(p.a) && alive(p.b) && p.score >= PAIR_MIN).sort((x, y) => y.score - x.score)[0] ?? null;
    } catch { return null; }
  }, [match]);
  if (!pair) return null;
  const pa = match.players[pair.a], pb = match.players[pair.b];
  if (!pa || !pb) return null;
  return (
    <>
      <button ref={ref} type="button" className="pair-chip" title="Possible impostor pair — why?" onClick={() => setOpen(o => !o)}>
        <span className="lbl">Possible pair</span>
        <PlayerIcon id={pa.id} color={pa.color} size={18} /> {pa.name} + <PlayerIcon id={pb.id} color={pb.color} size={18} /> {pb.name}
        <span className="pc">{Math.round(pair.score * 100)}%</span>
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={300} className="why-pop">
          <div className="menu-title">Why {pa.name} + {pb.name}?</div>
          <ul className="why-list">{pair.reasons.slice(0, 5).map((r, i) => <li key={i} className="pos"><span className="w">·</span><span className="l">{r}</span></li>)}</ul>
          <div className="muted small">Display only — a pair guess never changes the vote.</div>
        </Popover>
      )}
    </>
  );
}
