/**
 * Alibi graph (docs/DEDUCTION_ENGINE.md §4).
 *
 * Nodes are players; an edge says "a and b were together in `room` during
 * [t0, t1] of `round`". Edges from my own observations are `trusted`; edges
 * from chat claims start `pending` and become `confirmed` when the other party
 * says the same, or `contradicted` when a trusted observation puts one of them
 * somewhere they could not have been.
 */
import type { MatchState, PlayerId, RoomId, Claim, SightingObs } from '../types/game';
import { walkSeconds } from './map';
import { travelLowerBound } from './feasibility';

export type EdgeStatus = 'trusted' | 'confirmed' | 'pending' | 'contradicted';

export interface AlibiEdge {
  a: PlayerId;
  b: PlayerId;
  room: RoomId | null;
  round: number;
  t0: number;
  t1: number;
  status: EdgeStatus;
  refs: string[];
  /** For claim edges: the claim that created it (and its mirror, if confirmed). */
  claimIds?: string[];
}

const SIGHT_SLOP = 5; // seconds either side of a sighting that "together" covers
export const ROUND_END = 1e9;

export function buildAlibiGraph(m: MatchState): AlibiEdge[] {
  const edges: AlibiEdge[] = [];
  const me = m.me;

  // 1. "With me" toggles → trusted edges to me.
  const open = new Map<PlayerId, { t0: number; room: RoomId; ref: string; round: number }>();
  for (const o of m.observations) {
    if (o.type !== 'withMe') continue;
    if (o.on) {
      if (!open.has(o.player)) open.set(o.player, { t0: o.stamp.t, room: o.room, ref: o.id, round: o.stamp.round });
    } else {
      const s = open.get(o.player);
      if (s) {
        edges.push({ a: me, b: o.player, room: s.room, round: s.round, t0: s.t0, t1: o.stamp.t, status: 'trusted', refs: [s.ref, o.id] });
        open.delete(o.player);
      }
    }
  }
  for (const [p, s] of open) {
    // Still with me: covers until the end of the round the toggle happened in.
    edges.push({ a: me, b: p, room: s.room, round: s.round, t0: s.t0, t1: ROUND_END, status: 'trusted', refs: [s.ref] });
  }

  // 2. Sightings of groups → trusted edges among the group (short window).
  for (const o of m.observations) {
    if (o.type !== 'sighting' || !o.withPlayers?.length) continue;
    const group = [o.player, ...o.withPlayers];
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      edges.push({ a: group[i], b: group[j], room: o.room, round: o.stamp.round, t0: Math.max(0, o.stamp.t - SIGHT_SLOP), t1: o.stamp.t + SIGHT_SLOP, status: 'trusted', refs: [o.id] });
    }
  }

  // 3. Companion claims → pending edges; mirrored claims confirm; trusted sightings contradict.
  const companionClaims = m.claims.filter(c => c.type === 'companion' && c.about && c.about !== c.by); // a merge can fold a claim onto itself
  const roundOfClaim = (c: Claim) => c.stamp.round; // claims are made in the meeting that closes the round they describe
  for (const c of companionClaims) {
    const [t0, t1] = c.timeWindow ?? [0, ROUND_END];
    const round = roundOfClaim(c);
    const mirror = companionClaims.find(d => d.by === c.about && d.about === c.by && roundOfClaim(d) === round && windowsOverlap(d.timeWindow ?? [0, ROUND_END], [t0, t1]));
    let status: EdgeStatus = mirror ? 'confirmed' : 'pending';
    const contradiction = contradictsTogether(m, c.by, c.about!, c.room ?? null, round, t0, t1);
    if (contradiction) status = 'contradicted';
    edges.push({ a: c.by, b: c.about!, room: c.room ?? null, round, t0, t1, status, refs: contradiction ? [c.id, contradiction] : [c.id], claimIds: mirror ? [c.id, mirror.id] : [c.id] });
  }
  return edges;
}

const windowsOverlap = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

/**
 * A trusted sighting that makes "a and b together in room during [t0,t1]" impossible:
 * either party seen in a different room at a time inside the window, with no time to walk there.
 * Returns the observation id or null.
 */
export function contradictsTogether(m: MatchState, a: PlayerId, b: PlayerId, room: RoomId | null, round: number, t0: number, t1: number): string | null {
  const sightings = m.observations.filter((o): o is SightingObs => o.type === 'sighting' && o.stamp.round === round && o.source === 'me');
  for (const p of [a, b]) {
    for (const s of sightings) {
      if (s.player !== p || s.stamp.t < t0 || s.stamp.t > t1) continue;
      if (room && s.room !== room) {
        // Could they have walked from where I saw them to the claimed room within the window?
        const slack = Math.min(s.stamp.t - t0, t1 - s.stamp.t);
        if (travelLowerBound(walkSeconds(m.map, s.room, room, m.settings.playerSpeed)) > slack) return s.id;
      }
      // Seen alone while claiming company at that very moment.
      if (s.alone && (s.stamp.t >= t0 && s.stamp.t <= t1) && !room) return s.id;
    }
  }
  // Both seen at the same time in different rooms, too far apart.
  for (const s of sightings) {
    if (s.player !== a) continue;
    for (const u of sightings) {
      if (u.player !== b || Math.abs(u.stamp.t - s.stamp.t) > SIGHT_SLOP) continue;
      if (s.room !== u.room && travelLowerBound(walkSeconds(m.map, s.room, u.room, m.settings.playerSpeed)) > Math.abs(u.stamp.t - s.stamp.t)) return s.id;
    }
  }
  return null;
}

export interface KillClear { player: PlayerId; via: PlayerId; hops: number; refs: string[] }

/**
 * Who is cleared for a kill at (round, [wStart, wEnd])? Anyone with a trusted or
 * confirmed edge covering the whole window to an anchor (me or a certain crew),
 * then one more hop along confirmed edges (trust decays; see weights).
 */
export function killWindowClears(edges: AlibiEdge[], anchors: Set<PlayerId>, round: number, wStart: number, wEnd: number): KillClear[] {
  const covering = edges.filter(e => e.round === round && e.t0 <= wStart && e.t1 >= wEnd && (e.status === 'trusted' || e.status === 'confirmed'));
  const out = new Map<PlayerId, KillClear>();
  for (const e of covering) {
    for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
      if (anchors.has(q) && p !== q && !out.has(p)) out.set(p, { player: p, via: q, hops: 1, refs: e.refs });
    }
  }
  // One extra hop through players cleared at hop 1, confirmed/trusted edges only.
  for (const e of covering) {
    for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
      const viaClear = out.get(q);
      if (viaClear && viaClear.hops === 1 && p !== q && !anchors.has(p) && !out.has(p)) out.set(p, { player: p, via: q, hops: 2, refs: [...viaClear.refs, ...e.refs] });
    }
  }
  return [...out.values()];
}
