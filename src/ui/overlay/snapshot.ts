/** What the main window pushes to the overlay window. Pure data; no store access. */
import type { MatchState, Phase, PlayerColor } from '../../types/game';
import type { ClockState } from '../../state/clock';
import { describe } from '../../state/store';
import { effective, type MatchEvent } from '../../state/events';
import { PALETTE, COLOR_IDS } from '../palette';
import { impostorsRemaining, scoreAll } from '../../engine/suspicion';
import { fmt } from '../../engine/evidence';
import { slotOrder, myRoomNow } from '../../input/useHotkeys';

export interface OverlaySnapshot {
  phase: Phase;
  round: number;
  roundStartWall: number | null;
  frozenAtWall: number | null;
  alive: number;
  impLeft: number;
  pending: string | null;
  toast: string | null;
  prefix: string;
  colors: { color: PlayerColor; key: string; code: string; name: string; inLobby: boolean }[];
  /** Roster in vote-grid order: digit key -> name. */
  slots: { key: string; name: string; color: PlayerColor; dead: boolean; prime: boolean; cleared: boolean }[];
  rooms: { key: string; name: string }[];
  recent: string[];
  /** My current room (from the room popup or the / chord). */
  myRoom: string | null;
}

export function buildSnapshot(m: MatchState, clock: ClockState, log: MatchEvent[], pending: string | null, toast: string | null, prefix: string): OverlaySnapshot {
  const byColor = new Map(Object.values(m.players).map(p => [p.color, p]));
  const name = (id: string) => m.players[id]?.name ?? id;
  const room = (id: string) => m.map.rooms.find(r => r.id === id)?.name ?? id;
  const recent = effective(log).filter(e => e.kind === 'observation').slice(-3).reverse().map(e => {
    const st = e.kind === 'observation' ? e.payload.stamp : null;
    const line = describe(e).replace(/\b[a-zA-Z][a-zA-Z0-9]*\b/g, w => { const n = name(w); if (n !== w) return n; const r = room(w); return r !== w ? r : w; });
    return `${st ? fmt(st.t) + ' ' : ''}${line}`;
  });
  return {
    phase: m.phase.phase,
    round: Math.max(0, clock.round),
    roundStartWall: clock.roundStartWall,
    frozenAtWall: clock.frozenAtWall,
    alive: Object.values(m.players).filter(p => p.status === 'alive').length,
    impLeft: impostorsRemaining(m),
    pending,
    toast,
    prefix,
    colors: COLOR_IDS.map(c => ({ color: c, key: PALETTE[c].key, code: `Key${PALETTE[c].key.toUpperCase()}`, name: byColor.get(c)?.name ?? PALETTE[c].label, inLobby: byColor.has(c) })),
    slots: (() => {
      const scores = scoreAll(m);
      const prime = scores.find(x => (x.verdict === 'unknown' || x.verdict === 'softClear') && x.evidence.some(e => e.weight > 0))?.player;
      const cleared = new Set(scores.filter(x => x.verdict === 'certainCrew' || x.verdict === 'hardClear').map(x => x.player));
      return slotOrder(m).slice(0, 10).map((id, i) => ({ key: String((i + 1) % 10), name: m.players[id].name, color: m.players[id].color, dead: m.players[id].status !== 'alive', prime: id === prime, cleared: cleared.has(id) }));
    })(),
    rooms: m.map.rooms.map(r => ({ key: r.key, name: r.name })),
    recent,
    myRoom: (() => { const r = myRoomNow(m); return r ? (m.map.rooms.find(x => x.id === r)?.name ?? r) : null; })(),
  };
}
