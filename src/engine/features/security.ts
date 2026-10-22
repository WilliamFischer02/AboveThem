/**
 * Admin / cams / vitals / door-log helper (features #4).
 *
 * Everything here is what any crewmate sees by walking to the console: the admin map (anonymous
 * icon counts per room), security cameras, vitals (who is dead), Mira's door log. The helper turns
 * one tap into a structured observation and cross-checks admin reads against chat location claims.
 *
 * Which map has what: SECURITY_FALLBACK below (stations sourced from the wiki via
 * relay/game-knowledge.md §1.8; camera → nearest-room mapping is ours, so `_verified: false`).
 * If the maps agent adds `map.info.security` with the same shape, `securityFor` prefers it.
 * Facts that shape the UI: admin icons are anonymous, include players inside vents, and do NOT
 * cover hallways (or Polus Outside); whether bodies show on admin is UNVERIFIED. Comms sabotage
 * turns every station off except Fungle's binoculars.
 */
import type { AdminReadObs, MapId, MatchState, PlayerId, RoomId, SightingObs, VitalsReadObs, DoorLogReadObs, Observation, Claim } from '../../types/game';
import { fmt } from '../evidence';
import { pname, roomName, mapInfo } from './util';
import { monitorContradiction, type MonitorRead, type MonitorClaim, type MonitorCheck } from '../mapChecks';

export interface CamSpot { id: string; label: string; /** nearest real room id on the map (null = map has no such room yet) */ room: RoomId | null; match?: string }

export interface SecurityInfo {
  admin: boolean;
  /** Fixed camera spots; `'anyRoom'` = cameras exist but spots are not in our data yet (pick a room). */
  cams: CamSpot[] | 'anyRoom' | false;
  vitals: boolean;
  doorLog: boolean;
  /** Door-log sensor names from map.info (MIRA), when known. */
  doorSensors?: string[];
  _verified: boolean;
  _note: string;
}

/**
 * Station availability + camera spots from relay/game-knowledge.md §1.8 (wiki: Admin, Security, Camera,
 * Vitals, Doorlog, Binoculars). Which station exists where is sourced; the mapping of each hallway
 * camera to the NEAREST room id is ours (hallways are not rooms in the map JSON) — hence _verified false.
 * `room` is a preferred room id; `match` is a name fragment used when the id is not on the map.
 */
export const SECURITY_FALLBACK: Record<MapId, SecurityInfo> = {
  skeld: {
    admin: true, vitals: false, doorLog: false,
    cams: [
      { id: 'nav', label: 'Weapons↔Shields hall (by Nav/O2)', room: 'navigation' },
      { id: 'admin', label: 'Admin/Cafe/Storage hall', room: 'admin' },
      { id: 'medbay', label: 'MedBay/Cafe/Upper Engine hall', room: 'medbay' },
      { id: 'sec', label: 'Security↔Reactor hall', room: 'security' },
    ],
    _verified: false,
    _note: 'Admin + 4 cams on one screen (wiki). Hallway → nearest-room mapping is ours. No vitals (Scientist only).',
  },
  mira: { admin: true, cams: false, vitals: false, doorLog: true, _verified: false, _note: 'Admin + Doorlog (Communications PC: sensors at the north / south-west / south-east ends of the central Hallway). No cams, no vitals.' },
  polus: {
    admin: true, vitals: true, doorLog: false,
    cams: [
      { id: 'east', label: 'East (outside Office)', room: 'office' },
      { id: 'central', label: 'Central (Comms panel)', room: 'communications' },
      { id: 'ne', label: 'North-east (outside Lab)', room: 'laboratory' },
      { id: 'south', label: 'South (Office/Admin SW door)', room: 'admin' },
      { id: 'sw', label: 'South-west (outside O2)', room: 'o2' },
      { id: 'nw', label: 'North-west (outside Electrical)', room: 'electrical' },
    ],
    _verified: false,
    _note: 'Admin (does not cover Outside/hallways), 6 cams one at a time, Vitals in Office (wiki). Nearest-room mapping is ours.',
  },
  airship: {
    admin: true, vitals: true, doorLog: false,
    cams: [
      { id: 'engine', label: 'Engine Room (left entrance)', room: 'engineRoom', match: 'engine' },
      { id: 'vault', label: 'Vault (right entrance)', room: 'vault', match: 'vault' },
      { id: 'records', label: 'Records', room: 'records', match: 'records' },
      { id: 'security', label: 'Security (left entrance)', room: 'security', match: 'security' },
      { id: 'cargo', label: 'Cargo Bay (left entrance)', room: 'cargoBay', match: 'cargo' },
      { id: 'meeting', label: 'Meeting Room (above ladder)', room: 'meetingRoom', match: 'meeting' },
    ],
    _verified: false,
    _note: 'Admin tables in Cockpit + Records, 6 cam views, Vitals in Medical (wiki). Room ids resolved by name until airship.json has rooms.',
  },
  fungle: {
    admin: false, vitals: true, doorLog: false,
    cams: [
      { id: 'beach', label: 'Binoculars: Beach', room: 'beach', match: 'beach' },
      { id: 'jungle', label: 'Binoculars: Jungle', room: 'jungle', match: 'jungle' },
    ],
    _verified: false,
    _note: 'No admin, no cams: Binoculars in Lookout (Beach + Jungle, not The Cliffs; NOT disabled by Comms). Vitals in Laboratory.',
  },
};

/** Map-real room for a spot: its id if the map has it, else the first room whose name contains `match`. */
export function resolveSpot(m: MatchState, s: CamSpot): RoomId | null {
  if (s.room && isMapRoom(m, s.room)) return s.room;
  const key = (s.match ?? '').toLowerCase();
  if (!key) return null;
  return m.map.rooms.find(r => r.name.toLowerCase().includes(key) || r.id.toLowerCase().includes(key))?.id ?? null;
}

/**
 * Comms sabotage running right now (a 'sabotage start' with no matching 'end' this round): Admin,
 * Cams, Vitals and Doorlog are all OFF (Fungle binoculars excepted) — game-knowledge §1.6.
 */
export function commsDown(m: MatchState, round: number): boolean {
  let down = false;
  for (const o of m.observations) if (o.type === 'sabotage' && o.kind === 'comms' && o.stamp.round === round) down = o.phase === 'start';
  return down;
}

/**
 * Stations for the current map. Prefers the maps agent's `map.info` (admin rooms, security
 * {kind, covers}, vitals room, doorLog {sensors}); falls back to SECURITY_FALLBACK only when absent.
 * With `info`, camera spots are the rooms the cameras/binoculars cover; our labelled hallway spots are
 * kept only when they resolve to one of those covered rooms (they are more readable).
 */
export function securityFor(m: MatchState): SecurityInfo {
  const base = SECURITY_FALLBACK[m.map.id] ?? SECURITY_FALLBACK[m.settings.map];
  const info = mapInfo(m.map);
  if (!info) return base;
  let cams: SecurityInfo['cams'] = false;
  if (info.security) {
    const covers = info.security.covers ?? [];
    const prefix = info.security.kind === 'binoculars' ? 'Binoculars: ' : '';
    const labelled = Array.isArray(base?.cams) ? base.cams.filter(s => { const r = resolveSpot(m, s); return r !== null && covers.includes(r); }) : [];
    const rest = covers.filter(r => !labelled.some(s => resolveSpot(m, s) === r)).map(r => ({ id: r, label: prefix + roomName(m, r), room: r }));
    cams = [...labelled, ...rest];
    if (cams.length === 0) cams = 'anyRoom';
  }
  return {
    admin: (info.admin?.length ?? 0) > 0,
    cams,
    vitals: !!info.vitals,
    doorLog: !!info.doorLog,
    doorSensors: info.doorLog?.sensors,
    _verified: true,
    _note: `stations from ${m.map.name} map data${m.map._verified?.rooms ? '' : ' (rooms unverified)'}`,
  };
}

/**
 * Does the Admin map show this room? Research §1.8: no hallways, no Polus Outside. Our map data models
 * those as rooms (MIRA `hallway`, Polus/Airship rooms aliased "Outside"), so they are excluded here.
 * UNVERIFIED: Airship Hall of Portraits is treated as covered.
 */
export function adminCovers(m: MatchState, room: RoomId): boolean {
  const r = m.map.rooms.find(x => x.id === room) as (MatchState['map']['rooms'][number] & { aliases?: string[] }) | undefined;
  if (!r) return false;
  if (/^outside/i.test(r.id) || r.aliases?.some(a => /outside/i.test(a))) return false;
  return r.id !== 'hallway';
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

/** DED = killed since the last meeting (body on the map); D/C = no body (earlier death, ejected, left). */
export function vitalsObservation(m: MatchState, dead: PlayerId[], dc: PlayerId[] = []): Pick<VitalsReadObs, 'type' | 'dead' | 'alive' | 'dc'> {
  const deadSet = new Set(dead);
  const dcSet = new Set(dc.filter(p => !deadSet.has(p)));
  const alive = Object.values(m.players).filter(p => !deadSet.has(p.id) && !dcSet.has(p.id) && p.status === 'alive').map(p => p.id);
  return dcSet.size ? { type: 'vitalsRead', dead: [...deadSet], alive, dc: [...dcSet] } : { type: 'vitalsRead', dead: [...deadSet], alive };
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
      if (!adminCovers(m, room)) continue; // admin is blind there: a claim cannot clash with it
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

// ---------------------------------------------------------------------------
// Door log (MIRA) + adapters to the maps agent's monitorContradiction (engine/mapChecks.ts)
// ---------------------------------------------------------------------------

/**
 * One door-log read. The in-game log lists the last entries in order without exact times, so each
 * entry gets the read time unless the caller knows better; the read covers (previous read this round, now].
 */
export function doorLogObservation(m: MatchState, now: { round: number; t: number }, entries: { player: PlayerId; sensor?: string }[]): Pick<DoorLogReadObs, 'type' | 'entries' | 'from' | 'to'> {
  const prev = m.observations.filter((o): o is DoorLogReadObs => o.type === 'doorLogRead' && o.stamp.round === now.round).pop();
  return { type: 'doorLogRead', entries: entries.map(e => ({ ...e, t: now.t })), from: prev ? prev.to : 0, to: now.t };
}

/**
 * My Admin / Vitals / Doorlog observation → the `read` shape mapChecks.monitorContradiction expects.
 * Admin reads store only non-zero rooms; with `m`, every room the Admin map covers is filled in as 0
 * (an empty room on admin IS information), rooms admin cannot show stay absent (no verdict there).
 */
export function obsToMonitorRead(o: Observation, m?: MatchState): MonitorRead | null {
  switch (o.type) {
    case 'adminRead': {
      const counts: Record<RoomId, number> = {};
      if (m) for (const r of m.map.rooms) if (adminCovers(m, r.id)) counts[r.id] = 0;
      return { kind: 'admin', t: o.stamp.t, counts: { ...counts, ...o.counts } };
    }
    case 'vitalsRead': {
      const status: Record<PlayerId, 'alive' | 'dead' | 'dc'> = {};
      for (const p of o.alive) status[p] = 'alive';
      for (const p of o.dc ?? []) status[p] = 'dc';
      for (const p of o.dead) status[p] = 'dead';
      return { kind: 'vitals', t: o.stamp.t, status };
    }
    case 'doorLogRead': return { kind: 'doorLog', from: o.from, to: o.to, entries: o.entries.map(e => ({ ...e })) };
    default: return null;
  }
}

export interface MonitorFinding { readId: string; claimIds: string[]; player: PlayerId; kind: MonitorRead['kind']; check: MonitorCheck }

/**
 * Chat claims of the same round tested against my monitor reads:
 *  - admin: a location claim whose time window covers the read ("I was in elec at 0:40" vs admin empty there);
 *  - vitals: a sighting claim of someone alive after vitals showed them DED / D/C;
 *  - doorLog: two consecutive location claims by one player whose walk crosses the Hallway sensors
 *    inside the read interval, with no door-log entry for them (shaky: vents skip sensors).
 * Claims without a time window are too vague to test and are skipped (fail soft).
 */
export function monitorChecks(m: MatchState): MonitorFinding[] {
  const out: MonitorFinding[] = [];
  const reads = m.observations.filter(o => o.type === 'adminRead' || o.type === 'vitalsRead' || o.type === 'doorLogRead');
  for (const o of reads) {
    const read = obsToMonitorRead(o, m);
    if (!read) continue;
    const round = o.stamp.round;
    const claims = m.claims.filter(c => c.stamp.round === round && c.timeWindow);
    const test = (claim: MonitorClaim, ids: string[]) => {
      const check = monitorContradiction(m.map, read, claim);
      if (check?.contradiction) out.push({ readId: o.id, claimIds: ids, player: claim.player, kind: read.kind, check });
    };
    if (read.kind === 'admin') {
      for (const c of claims) {
        if (c.type !== 'location' || !c.room || (c.about && c.about !== c.by)) continue;
        const [a, b] = c.timeWindow!;
        if (a <= read.t && read.t <= b) test({ player: c.by, room: c.room, t: read.t }, [c.id]);
      }
    } else if (read.kind === 'vitals') {
      for (const c of claims) {
        if (c.type !== 'sighting' || !c.about) continue;
        test({ player: c.by, about: c.about, aboutAlive: true, t: c.timeWindow![1] }, [c.id]);
      }
    } else {
      const byPlayer = new Map<PlayerId, Claim[]>();
      for (const c of claims) if (c.type === 'location' && c.room && (!c.about || c.about === c.by)) byPlayer.set(c.by, [...(byPlayer.get(c.by) ?? []), c]);
      for (const [player, list] of byPlayer) {
        const seq = [...list].sort((x, y) => x.timeWindow![0] - y.timeWindow![0]);
        for (let i = 1; i < seq.length; i++) {
          if (seq[i].room === seq[i - 1].room) continue;
          test({ player, fromRoom: seq[i - 1].room, room: seq[i].room, t: seq[i].timeWindow![0] }, [seq[i - 1].id, seq[i].id]);
        }
      }
    }
  }
  return out;
}
