/**
 * Admin / cams / vitals / door-log helper (features #4).
 *
 * Everything here is what any crewmate sees by walking to the console: the admin map (anonymous
 * icon counts per room), security cameras, vitals (who is dead), Mira's door log. The helper turns
 * one tap into a structured observation and cross-checks admin reads against chat location claims.
 *
 * Which map has what: SECURITY_FALLBACK below, all `_verified: false`. If the maps agent adds
 * `map.info.security` with the same shape, `securityFor` prefers it.
 */
import type { AdminReadObs, MapId, MatchState, PlayerId, RoomId, SightingObs, VitalsReadObs, Claim } from '../../types/game';
import { fmt } from '../evidence';
import { pname, roomName } from './util';

export interface CamSpot { id: string; label: string; /** nearest real room id on the map (null = map has no such room yet) */ room: RoomId | null }

export interface SecurityInfo {
  admin: boolean;
  /** Fixed camera spots; `'anyRoom'` = cameras exist but spots are not in our data yet (pick a room). */
  cams: CamSpot[] | 'anyRoom' | false;
  vitals: boolean;
  doorLog: boolean;
  _verified: boolean;
  _note: string;
}

export const SECURITY_FALLBACK: Record<MapId, SecurityInfo> = {
  skeld: {
    admin: true, vitals: false, doorLog: false,
    cams: [
      { id: 'nav', label: 'Navigation hallway', room: 'navigation' },
      { id: 'sec', label: 'Security hallway', room: 'security' },
      { id: 'admin', label: 'Admin / Storage corridor', room: 'admin' },
      { id: 'medbay', label: 'Upper Engine / MedBay hallway', room: 'medbay' },
    ],
    _verified: false,
    _note: 'Four cams per the owner brief; each mapped to the NEAREST room because hallways are not rooms in skeld.json. UNVERIFIED in-game.',
  },
  mira: { admin: true, cams: false, vitals: false, doorLog: true, _verified: false, _note: 'Mira: admin table + door log, no cams/vitals (as remembered). Door-log sensor positions not in data: pick the nearest room.' },
  polus: { admin: true, cams: 'anyRoom', vitals: true, doorLog: false, _verified: false, _note: 'Polus: admin, cams, vitals (as remembered). Camera spots not in data yet.' },
  airship: { admin: true, cams: 'anyRoom', vitals: true, doorLog: false, _verified: false, _note: 'Airship: admin, cams, vitals (as remembered). Camera spots not in data yet.' },
  fungle: { admin: false, cams: false, vitals: true, doorLog: false, _verified: false, _note: 'Fungle: vitals, no admin table or cams (binoculars instead) — as remembered, UNVERIFIED.' },
};

export function securityFor(m: MatchState): SecurityInfo {
  const info = (m.map as unknown as { info?: { security?: Partial<SecurityInfo> } }).info?.security;
  const base = SECURITY_FALLBACK[m.map.id] ?? SECURITY_FALLBACK[m.settings.map];
  if (info && typeof info === 'object') return { ...base, ...info } as SecurityInfo;
  return base;
}

/** Rooms of the current map (empty for maps whose room data is still missing). */
export const mapRooms = (m: MatchState) => m.map.rooms.map(r => r.id);
export const isMapRoom = (m: MatchState, r: RoomId) => m.map.rooms.some(x => x.id === r);

// ---------------------------------------------------------------------------
// Observation builders (the UI passes these to store.observe)
// ---------------------------------------------------------------------------

export function adminObservation(counts: Record<RoomId, number>, bodies?: RoomId[]): Pick<AdminReadObs, 'type' | 'counts' | 'bodies'> {
  const clean: Record<RoomId, number> = {};
  for (const [r, n] of Object.entries(counts)) if (n > 0) clean[r] = Math.round(n);
  return bodies?.length ? { type: 'adminRead', counts: clean, bodies } : { type: 'adminRead', counts: clean };
}

/** A camera / door-log sighting is an ordinary sighting with a note (only for real map rooms). */
export function remoteSighting(m: MatchState, player: PlayerId, room: RoomId, via: 'cams' | 'doorLog', label?: string): Pick<SightingObs, 'type' | 'player' | 'room' | 'note'> | null {
  if (!isMapRoom(m, room)) return null; // never invent a room id the geometry rules cannot reason about
  return { type: 'sighting', player, room, note: `${via === 'cams' ? 'cams' : 'door log'}${label ? ': ' + label : ''}` };
}

export function vitalsObservation(m: MatchState, dead: PlayerId[]): Pick<VitalsReadObs, 'type' | 'dead' | 'alive'> {
  const deadSet = new Set(dead);
  const alive = Object.values(m.players).filter(p => !deadSet.has(p.id) && p.status === 'alive').map(p => p.id);
  return { type: 'vitalsRead', dead: [...deadSet], alive };
}

/** Players a vitals read shows dead whom the roster still has alive (the UI patches their status). */
export function newlyDeadFromVitals(m: MatchState, dead: PlayerId[]): PlayerId[] {
  return dead.filter(p => m.players[p]?.status === 'alive' && p !== m.me);
}

// ---------------------------------------------------------------------------
// Admin vs claims — a lie check
// ---------------------------------------------------------------------------

export interface AdminCheck {
  readId: string;
  round: number;
  t: number;
  room: RoomId;
  shown: number;
  /** Players placed there at that moment: me / with-me / sighted within ±5 s (certain). */
  placed: PlayerId[];
  /** Players who CLAIMED that room for a window covering the read (or with no window: soft). */
  claimants: { player: PlayerId; claimId: string; windowed: boolean }[];
  verdict: 'tooManyClaims' | 'unaccounted' | 'ok';
  line: string;
  refs: string[];
}

const SLOP = 5;

export function adminChecks(m: MatchState): AdminCheck[] {
  const out: AdminCheck[] = [];
  const reads = m.observations.filter((o): o is AdminReadObs => o.type === 'adminRead');
  for (const r of reads) {
    const round = r.stamp.round, t = r.stamp.t;
    const claims = m.claims.filter((c: Claim) => c.type === 'location' && c.room && c.stamp.round === round && (!c.about || c.about === c.by));
    const rooms = new Set<RoomId>([...Object.keys(r.counts), ...claims.map(c => c.room!)]);
    for (const room of rooms) {
      const shown = r.counts[room] ?? 0;
      const placed = new Set<PlayerId>();
      for (const o of m.observations) {
        if (o.stamp.round !== round || Math.abs(o.stamp.t - t) > SLOP) continue;
        if (o.type === 'sighting' && o.room === room) [o.player, ...(o.withPlayers ?? [])].forEach(p => placed.add(p));
      }
      // Me (and whoever is with me) if I was in that room when I read admin.
      let myRoom: RoomId | null = null;
      const withMe = new Map<PlayerId, boolean>();
      for (const o of m.observations) {
        if (o.stamp.round !== round || o.stamp.t > t) continue;
        if (o.type === 'myRoom') myRoom = o.room;
        if (o.type === 'withMe') withMe.set(o.player, o.on);
      }
      if (myRoom === room) { placed.add(m.me); for (const [p, on] of withMe) if (on) placed.add(p); }
      const claimants = claims
        .filter(c => c.room === room && (!c.timeWindow || (c.timeWindow[0] <= t && t <= c.timeWindow[1])))
        .map(c => ({ player: c.by, claimId: c.id, windowed: !!c.timeWindow }));
      const uniq = [...new Map(claimants.map(c => [c.player, c])).values()];
      const accounted = new Set([...placed, ...uniq.map(c => c.player)]);
      let verdict: AdminCheck['verdict'] = 'ok';
      let line = '';
      // Unwindowed claims ("I was in elec") are vague: only flag them against an EMPTY room.
      if (uniq.length > shown && (uniq.some(c => c.windowed) || shown === 0)) {
        verdict = 'tooManyClaims';
        line = `${uniq.map(c => pname(m, c.player)).join(', ')} say${uniq.length === 1 ? 's' : ''} ${roomName(m, room)}, but admin showed ${shown} there at ${fmt(t)}`;
      } else if (shown > accounted.size) {
        verdict = 'unaccounted';
        line = `Admin showed ${shown} in ${roomName(m, room)} at ${fmt(t)}; only ${accounted.size} accounted for${accounted.size ? ` (${[...accounted].map(p => pname(m, p)).join(', ')})` : ''} — who else was there?`;
      }
      if (verdict === 'ok') continue;
      out.push({ readId: r.id, round, t, room, shown, placed: [...placed], claimants: uniq, verdict, line, refs: [r.id, ...uniq.map(c => c.claimId)] });
    }
  }
  return out;
}
