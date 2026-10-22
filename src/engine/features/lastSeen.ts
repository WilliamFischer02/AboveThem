/**
 * Last-seen board (features #3): for every player, the last room + time I placed them, who they
 * were with, how stale that is, and (separately, lower trust) what they CLAIMED in chat.
 * Answers "where was everyone?" at a glance. Uses only my own observations and logged claims.
 */
import type { MatchState, PlayerId, RoomId, Stamp, Observation } from '../../types/game';

export type SeenKind = 'seen' | 'withMe' | 'withMeNow' | 'leftMe' | 'task' | 'vent' | 'kill' | 'reported' | 'dead';

export interface LastSeen {
  player: PlayerId;
  status: MatchState['players'][string]['status'];
  room: RoomId | null;
  round: number | null;
  t: number | null;
  kind: SeenKind | null;
  heading?: RoomId;
  with: PlayerId[];
  ref?: string;
  /** 0 = fresh (< 15 s), 1 = < 40 s, 2 = < 80 s, 3 = older or an earlier round / never. */
  staleness: 0 | 1 | 2 | 3;
  /** Seconds since, in the current round (null when from an earlier round or never seen). */
  ageSec: number | null;
  /** Latest location claim they made (chat), if any. */
  claim?: { room: RoomId; ref: string; text?: string; meeting: number };
}

const GROUP_SLOP = 5; // seconds: players sighted in the same room this close together count as "together"

interface Placement { player: PlayerId; room: RoomId; stamp: Stamp; kind: SeenKind; with: PlayerId[]; heading?: RoomId; ref: string; order: number }

function placements(m: MatchState): Placement[] {
  const out: Placement[] = [];
  const me = m.me;
  m.observations.forEach((o: Observation, order) => {
    const push = (player: PlayerId, room: RoomId, kind: SeenKind, w: PlayerId[] = [], heading?: RoomId) => {
      if (player === me || player === 'unknown') return;
      out.push({ player, room, stamp: o.stamp, kind, with: w.filter(x => x !== player), heading, ref: o.id, order });
    };
    switch (o.type) {
      case 'sighting': {
        const group = [o.player, ...(o.withPlayers ?? [])];
        for (const p of group) push(p, o.room, 'seen', group, p === o.player ? o.heading : undefined);
        break;
      }
      case 'withMe': push(o.player, o.room, o.on ? 'withMe' : 'leftMe', o.on ? [me] : []); break;
      case 'sawTask': push(o.player, o.room, 'task'); break;
      case 'sawVent': push(o.player, o.room, 'vent'); break;
      case 'sawKill': push(o.killer, o.room, 'kill', [o.victim]); push(o.victim, o.room, 'dead', [o.killer]); break;
      case 'bodyFound': {
        const present = [...(o.reporter ? [o.reporter] : []), ...(o.present ?? [])];
        for (const p of new Set(present)) push(p, o.room, 'reported', present);
        push(o.victim, o.room, 'dead');
        break;
      }
      default: break;
    }
  });
  return out;
}

const staleOf = (age: number | null): LastSeen['staleness'] => (age === null ? 3 : age < 15 ? 0 : age < 40 ? 1 : age < 80 ? 2 : 3);

export function lastSeenBoard(m: MatchState, now: Stamp): LastSeen[] {
  const all = placements(m);
  const latest = new Map<PlayerId, Placement>();
  for (const p of all) {
    const cur = latest.get(p.player);
    const later = !cur || p.stamp.round > cur.stamp.round || (p.stamp.round === cur.stamp.round && (p.stamp.t > cur.stamp.t || (p.stamp.t === cur.stamp.t && p.order > cur.order)));
    if (later) latest.set(p.player, p);
  }
  // A with-me toggle that is still on (this round) means "with me right now".
  const onNow = new Map<PlayerId, boolean>();
  for (const o of m.observations) if (o.type === 'withMe' && o.stamp.round === now.round) onNow.set(o.player, o.on);

  const claims = new Map<PlayerId, LastSeen['claim']>();
  for (const c of m.claims) if (c.type === 'location' && c.room && (!c.about || c.about === c.by)) claims.set(c.by, { room: c.room, ref: c.id, text: c.text, meeting: c.meeting });

  return Object.values(m.players).filter(p => !p.isMe).map((p): LastSeen => {
    const pl = latest.get(p.id);
    if (!pl) return { player: p.id, status: p.status, room: null, round: null, t: null, kind: null, with: [], staleness: 3, ageSec: null, claim: claims.get(p.id) };
    const sameRound = pl.stamp.round === now.round;
    let kind = pl.kind;
    let t = pl.stamp.t;
    if (sameRound && onNow.get(p.id) && (kind === 'withMe' || kind === 'seen' || kind === 'task')) { kind = 'withMeNow'; t = now.t; }
    // Others sighted in the same room within GROUP_SLOP of this placement count as company.
    const company = new Set(pl.with);
    for (const q of all) {
      if (q.player === p.id || q.stamp.round !== pl.stamp.round || q.room !== pl.room) continue;
      if (Math.abs(q.stamp.t - pl.stamp.t) <= GROUP_SLOP && q.kind !== 'dead') company.add(q.player);
    }
    if (kind === 'withMeNow') company.add(m.me);
    const ageSec = sameRound ? Math.max(0, now.t - t) : null;
    return {
      player: p.id, status: p.status, room: pl.room, round: pl.stamp.round, t, kind, heading: pl.heading,
      with: [...company].filter(x => x !== p.id), ref: pl.ref, staleness: kind === 'withMeNow' ? 0 : staleOf(ageSec), ageSec, claim: claims.get(p.id),
    };
  }).sort((a, b) => rankStatus(a) - rankStatus(b) || a.staleness - b.staleness || (b.t ?? -1) - (a.t ?? -1));
}

const rankStatus = (e: LastSeen) => (e.status === 'alive' ? 0 : 1);

/** "Where was everyone" grouped by room (current-round placements only, alive players). */
export function byRoom(board: LastSeen[], round: number): { room: RoomId; players: PlayerId[] }[] {
  const map = new Map<RoomId, PlayerId[]>();
  for (const e of board) {
    if (e.status !== 'alive' || e.room === null || e.round !== round) continue;
    if (!map.has(e.room)) map.set(e.room, []);
    map.get(e.room)!.push(e.player);
  }
  return [...map.entries()].map(([room, players]) => ({ room, players })).sort((a, b) => b.players.length - a.players.length);
}

/** Alive players with no placement at all this round (nobody, including me, can vouch for them). */
export function unplacedThisRound(board: LastSeen[], round: number): PlayerId[] {
  return board.filter(e => e.status === 'alive' && e.round !== round).map(e => e.player);
}
