/**
 * "What you can check" on this map — Admin, cameras / binoculars, Vitals, MIRA's door log,
 * the emergency button — from MapData.info (maps agent). Pure; no DOM.
 * Everything listed is something any player can walk to and look at: no hidden info.
 * Returns [] when the map has no `info` (old data), so the UI hides the line.
 */
import type { MapData, RoomId } from '../types/game';

export type MapCheckKind = 'cams' | 'binoculars' | 'admin' | 'vitals' | 'doorLog' | 'button';

export interface MapCheck {
  kind: MapCheckKind;
  icon: string;
  /** Short chip text, e.g. "Cams: Nav, Admin +5". */
  label: string;
  /** Full text for a tooltip, e.g. "Cameras in Security show Upper Engine, Lower Engine, …". */
  detail: string;
  /** Where you go to check it. */
  room: RoomId;
}

const ICON: Record<MapCheckKind, string> = { cams: '📹', binoculars: '🔭', admin: '🗺', vitals: '💓', doorLog: '🚪', button: '🔔' };

/** camelCase / snake ids → words, for ids that are not rooms (e.g. Polus "outsideLeft"). */
function words(id: string): string {
  return id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

export function roomLabel(map: MapData, id: RoomId): string {
  return map.rooms.find(r => r.id === id)?.name ?? words(id);
}

export function mapChecks(map: MapData, opts: { maxCovers?: number; button?: boolean } = {}): MapCheck[] {
  const info = map.info;
  if (!info) return [];
  const max = opts.maxCovers ?? 3;
  const name = (r: RoomId) => roomLabel(map, r);
  const out: MapCheck[] = [];
  if (info.security) {
    const s = info.security;
    const kind: MapCheckKind = s.kind === 'binoculars' ? 'binoculars' : 'cams';
    const covers = s.covers.map(name);
    const shown = covers.slice(0, max).join(', ') + (covers.length > max ? ` +${covers.length - max}` : '');
    out.push({
      kind, icon: ICON[kind], room: s.room,
      label: `${kind === 'cams' ? 'Cams' : 'Binoculars'}: ${shown || name(s.room)}`,
      detail: `${kind === 'cams' ? 'Cameras' : 'Binoculars'} in ${name(s.room)}${covers.length ? ' show ' + covers.join(', ') : ''}${s._note ? ' (' + s._note + ')' : ''}`,
    });
  }
  if (info.admin.length) {
    const rooms = info.admin.map(name);
    const plain = rooms.length === 1 && /^admin$/i.test(rooms[0]);
    out.push({
      kind: 'admin', icon: ICON.admin, room: info.admin[0],
      label: plain ? 'Admin' : `Admin: ${rooms.join(', ')}`,
      detail: `Admin map (who is in which room, no colours) in ${rooms.join(' and ')}`,
    });
  }
  if (info.vitals) {
    out.push({ kind: 'vitals', icon: ICON.vitals, room: info.vitals, label: `Vitals: ${name(info.vitals)}`, detail: `Vitals (who is alive / dead / disconnected) in ${name(info.vitals)}` });
  }
  if (info.doorLog) {
    out.push({ kind: 'doorLog', icon: ICON.doorLog, room: info.doorLog.room, label: `Door log: ${name(info.doorLog.room)}`, detail: `Door log in ${name(info.doorLog.room)}: who crossed ${info.doorLog.sensors.join(', ')}` });
  }
  if (opts.button) {
    out.push({ kind: 'button', icon: ICON.button, room: info.emergencyButton, label: `Button: ${name(info.emergencyButton)}`, detail: `Emergency button in ${name(info.emergencyButton)}` });
  }
  return out;
}

/** One text line: "📹 Cams: Upper Engine, Lower Engine, MedBay +4 · 🗺 Admin · 💓 Vitals: Office". */
export function mapChecksLine(map: MapData, opts?: { maxCovers?: number; button?: boolean }): string {
  return mapChecks(map, opts).map(c => `${c.icon} ${c.label}`).join(' · ');
}
