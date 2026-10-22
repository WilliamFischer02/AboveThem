/**
 * Kill-cooldown clock + kill-window feasibility (features #1).
 *
 * Game facts used (all visible to every player, none hidden):
 *  - Impostors cannot kill until their kill cooldown has elapsed. The cooldown restarts at the
 *    start of every round (after each meeting) and after each kill.
 *  - The first cooldown of the match is 10 s regardless of settings (wiki: Kill, Guide:Crewmate,
 *    via relay/game-knowledge.md §1.2).
 *  - The cooldown PAUSES while the impostor is in a vent or on cameras, so "next kill at" for a
 *    killer I saw is a lower bound, never an exact time.
 *  - One impostor cannot kill twice inside one cooldown ⇒ two bodies whose times of death are
 *    necessarily closer than the cooldown need two killers (doubleKills()).
 *
 * Kill window for a body = [lo, hi]:
 *  - hi = when the body was reported (the bodyFound stamp; the round clock freezes at the meeting),
 *    or earlier if a Vitals read already showed the victim dead.
 *  - lo = the later of (first moment any impostor could kill this round) and (the last time I saw
 *    the victim alive: sightings, with-me, tasks, vitals "alive").
 *
 * A player "could not have killed" when, for every t in [lo, hi], something I logged puts them too
 * far from the body room to be there at t. Travel uses the IMPOSTOR model (walking + any vent hop,
 * see util.impostorTravelSec), so a "could not" survives the "they vented" objection.
 */
import type { MatchState, PlayerId, RoomId, Stamp, BodyFoundObs } from '../../types/game';
import { fmt } from '../evidence';
import { impostorTravelSec, subtract, totalLength, type Interval, pname, roomName } from './util';

/** Sourced (see header). */
export const FIRST_ROUND_COOLDOWN_SEC = 10;

export function cooldownForRound(m: MatchState, round: number): number {
  return round <= 0 ? Math.min(FIRST_ROUND_COOLDOWN_SEC, m.settings.killCooldownSec) : m.settings.killCooldownSec;
}

// ---------------------------------------------------------------------------
// Live clock
// ---------------------------------------------------------------------------

export interface KillClock {
  round: number;
  cooldownSec: number;
  /** Round time (s) at which the first kill of the round becomes possible. */
  firstKillAt: number;
  /** Seconds until then (0 = kills possible now). */
  readyIn: number;
  ready: boolean;
  /** Impostors I SAW kill this round: their next kill cannot come before `nextAt`. */
  seenKillers: { player: PlayerId; killedAt: number; nextAt: number; ref: string }[];
}

export function killClock(m: MatchState, now: Stamp): KillClock {
  const round = now.round;
  const cooldownSec = cooldownForRound(m, round);
  const firstKillAt = cooldownSec;
  const readyIn = Math.max(0, firstKillAt - now.t);
  const seenKillers = m.observations
    .filter(o => o.type === 'sawKill' && o.stamp.round === round)
    .map(o => {
      const k = o as Extract<typeof o, { type: 'sawKill' }>;
      return { player: k.killer, killedAt: k.stamp.t, nextAt: k.stamp.t + m.settings.killCooldownSec, ref: k.id };
    });
  return { round, cooldownSec, firstKillAt, readyIn, ready: readyIn <= 0, seenKillers };
}

// ---------------------------------------------------------------------------
// Kill window per body
// ---------------------------------------------------------------------------

export interface Reason { label: string; refs: string[] }

export interface PlayerFeasibility {
  player: PlayerId;
  /** Sub-windows of [lo, hi] in which they could have been at the body. Empty = could not have killed. */
  feasible: Interval[];
  /** Fraction of the window that is still open for them (0..1). */
  openFraction: number;
  /** Why parts of the window are closed for them. */
  reasons: Reason[];
}

export interface KillWindow {
  bodyId: string;
  victim: PlayerId;
  room: RoomId;
  round: number;
  lo: number;
  hi: number;
  lowerBy: 'cooldown' | 'lastSeenAlive';
  lowerRef?: string;
  upperBy: 'report' | 'vitals';
  upperRef?: string;
  could: PlayerFeasibility[];
  couldNot: PlayerFeasibility[];
}

/** Last time (≤ before) I had evidence the victim was alive this round. */
function lastSeenAlive(m: MatchState, victim: PlayerId, round: number, before: number): { t: number; ref: string } | null {
  let best: { t: number; ref: string } | null = null;
  const consider = (t: number, ref: string) => { if (t <= before && (!best || t > best.t)) best = { t, ref }; };
  for (const o of m.observations) {
    if (o.stamp.round !== round) continue;
    switch (o.type) {
      case 'sighting': if (o.player === victim || o.withPlayers?.includes(victim)) consider(o.stamp.t, o.id); break;
      case 'withMe': if (o.player === victim) consider(o.stamp.t, o.id); break;
      case 'sawTask': if (o.player === victim) consider(o.stamp.t, o.id); break;
      case 'vitalsRead': if (o.alive.includes(victim)) consider(o.stamp.t, o.id); break;
      case 'sabotage': if (o.fixers?.includes(victim)) consider(o.stamp.t, o.id); break;
      default: break;
    }
  }
  return best;
}

/** Players who could physically be the killer of a body in `round` (alive impostor candidates then). */
function candidates(m: MatchState, victim: PlayerId, round: number): PlayerId[] {
  const deadBefore = new Set<PlayerId>();
  for (const o of m.observations) {
    if (o.type === 'bodyFound' && o.stamp.round < round) deadBefore.add(o.victim);
    if (o.type === 'sawKill' && o.stamp.round < round) deadBefore.add(o.victim);
    if (o.type === 'bodyFound' && o.stamp.round === round && o.victim !== victim) deadBefore.add(o.victim); // other victims were crew
  }
  for (const e of m.ejections) if (e.player && e.meeting < round) deadBefore.add(e.player);
  return Object.values(m.players)
    .filter(p => p.id !== victim && p.id !== m.me && !deadBefore.has(p.id))
    .map(p => p.id);
}

export function killWindowFor(m: MatchState, body: BodyFoundObs): KillWindow {
  const round = body.stamp.round;
  const room = body.room;
  let hi = body.stamp.t;
  let upperBy: KillWindow['upperBy'] = 'report';
  let upperRef: string | undefined = body.id;
  // A vitals read that already showed the victim dead tightens the top of the window.
  for (const o of m.observations) {
    if (o.type === 'vitalsRead' && o.stamp.round === round && o.dead.includes(body.victim) && o.stamp.t < hi) { hi = o.stamp.t; upperBy = 'vitals'; upperRef = o.id; }
  }
  const cd = cooldownForRound(m, round);
  const seen = lastSeenAlive(m, body.victim, round, hi);
  let lo = Math.min(cd, hi);
  let lowerBy: KillWindow['lowerBy'] = 'cooldown';
  let lowerRef: string | undefined;
  if (seen && seen.t > lo) { lo = seen.t; lowerBy = 'lastSeenAlive'; lowerRef = seen.ref; }

  const speed = m.settings.playerSpeed || 1;
  const travel = (from: RoomId) => impostorTravelSec(m.map, from, room, speed);
  const roundObs = m.observations.filter(o => o.stamp.round === round);

  const results: PlayerFeasibility[] = candidates(m, body.victim, round).map(player => {
    let set: Interval[] = [[Math.max(0, Math.min(lo, hi - 1)), hi]]; // never a zero-length window
    const reasons: Reason[] = [];
    const cut = (a: number, b: number, label: string, refs: string[]) => {
      const prev = totalLength(set);
      set = subtract(set, a, b);
      if (totalLength(set) < prev - 0.5) reasons.push({ label, refs });
    };

    // With-me intervals: while they were with me they were not killing anyone out of my sight.
    let open: { t: number; room: RoomId; ref: string } | null = null;
    for (const o of roundObs) {
      if (o.type !== 'withMe' || o.player !== player) continue;
      if (o.on && !open) open = { t: o.stamp.t, room: o.room, ref: o.id };
      else if (!o.on && open) {
        const a = open.t - (travel(open.room) ?? 0), b = o.stamp.t + (travel(o.room) ?? 0);
        cut(a, b, `with me ${fmt(open.t)}–${fmt(o.stamp.t)}`, [open.ref, o.id]);
        open = null;
      }
    }
    if (open) cut(open.t - (travel(open.room) ?? 0), Infinity, `with me since ${fmt(open.t)}`, [open.ref]);

    // Point sightings: seen in room S at ts ⇒ cannot be at the body during (ts − d, ts + d).
    for (const o of roundObs) {
      let where: RoomId | null = null;
      if (o.type === 'sighting' && (o.player === player || o.withPlayers?.includes(player))) where = o.room;
      else if (o.type === 'sawTask' && o.player === player) where = o.room;
      else if (o.type === 'sabotage' && o.fixers?.includes(player)) where = null; // no room on sabotage obs
      if (where === null) continue;
      const d = travel(where);
      if (d === null || d === 0) continue;
      cut(o.stamp.t - d, o.stamp.t + d, `seen in ${roomName(m, where)} at ${fmt(o.stamp.t)} (${Math.round(d)} s from ${roomName(m, room)} even by vent)`, [o.id]);
    }

    const len = Math.max(1, hi - lo);
    return { player, feasible: set, openFraction: Math.min(1, totalLength(set) / len), reasons };
  });

  return {
    bodyId: body.id, victim: body.victim, room, round, lo, hi, lowerBy, lowerRef, upperBy, upperRef,
    could: results.filter(r => r.feasible.length > 0).sort((a, b) => b.openFraction - a.openFraction),
    couldNot: results.filter(r => r.feasible.length === 0),
  };
}

/** Kill windows for every body found in `round` (default: the latest round with a body). */
export function killWindows(m: MatchState, round?: number): KillWindow[] {
  const bodies = m.observations.filter((o): o is BodyFoundObs => o.type === 'bodyFound');
  const r = round ?? Math.max(-1, ...bodies.map(b => b.stamp.round));
  return bodies.filter(b => b.stamp.round === r).map(b => killWindowFor(m, b));
}

export interface DoubleKill {
  a: string; // bodyFound ids
  b: string;
  /** Largest possible gap between the two deaths (s). */
  maxGap: number;
  cooldownSec: number;
  line: string;
  refs: string[];
}

/**
 * Pairs of bodies in the same round whose deaths are certainly closer than one kill cooldown:
 * one impostor could not have done both ⇒ two killers (and a player who could not have done one
 * of them is still live for the other).
 */
export function doubleKills(m: MatchState, windows: KillWindow[]): DoubleKill[] {
  const out: DoubleKill[] = [];
  for (let i = 0; i < windows.length; i++) for (let j = i + 1; j < windows.length; j++) {
    const a = windows[i], b = windows[j];
    if (a.round !== b.round) continue;
    const cd = m.settings.killCooldownSec;
    const maxGap = Math.max(b.hi - a.lo, a.hi - b.lo);
    if (maxGap >= cd) continue;
    out.push({ a: a.bodyId, b: b.bodyId, maxGap, cooldownSec: cd, refs: [a.bodyId, b.bodyId, ...(a.lowerRef ? [a.lowerRef] : []), ...(b.lowerRef ? [b.lowerRef] : [])],
      line: `${pname(m, a.victim)} and ${pname(m, b.victim)} died at most ${Math.round(maxGap)} s apart (< ${cd} s cooldown) ⇒ two different killers` });
  }
  return out;
}

/** "could have killed: X, Y; could not: Z (with me 0:40–1:10)" */
export function summarizeKillWindow(m: MatchState, w: KillWindow): string {
  const could = w.could.map(p => pname(m, p.player) + (p.openFraction < 0.999 ? ` (${p.feasible.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ')})` : ''));
  const couldNot = w.couldNot.map(p => `${pname(m, p.player)} (${p.reasons.map(r => r.label).join('; ')})`);
  const head = `${pname(m, w.victim)} in ${roomName(m, w.room)}, killed ${fmt(w.lo)}–${fmt(w.hi)}`;
  return `${head}. could have killed: ${could.join(', ') || 'nobody'}; could not: ${couldNot.join(', ') || 'nobody'}`;
}
