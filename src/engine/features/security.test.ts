import { describe, it, expect } from 'vitest';
import { securityFor, adminObservation, remoteSighting, vitalsObservation, newlyDeadFromVitals, adminChecks, SECURITY_FALLBACK, resolveSpot, commsDown } from './security';
import { build, o, st } from './__fixtures__/build';
import { repoint } from '../../state/events';

describe('security availability', () => {
  it('real Skeld map.info: labelled hallway cams that match covered rooms, then the other covered rooms', () => {
    const s = securityFor(build());
    expect(s).toMatchObject({ admin: true, vitals: false, doorLog: false, _verified: true });
    const ids = (s.cams as { id: string }[]).map(x => x.id);
    expect(ids.slice(0, 3)).toEqual(['nav', 'admin', 'medbay']);
    expect(ids).toContain('storage');
  });
  it('uses the fallback table when map.info is absent and marks it unverified', () => {
    const m = build();
    m.map = { ...m.map, info: undefined };
    const s = securityFor(m);
    expect(s.admin).toBe(true);
    expect(Array.isArray(s.cams) && s.cams.length).toBe(4);
    expect(s._verified).toBe(false);
    expect(SECURITY_FALLBACK.fungle.admin).toBe(false);
    expect(SECURITY_FALLBACK.mira.doorLog).toBe(true);
  });
  it('prefers map.info (maps agent shape) and keeps labelled spots that match covered rooms', () => {
    const m = build();
    m.map = { ...m.map, info: { admin: ['admin'], security: { room: 'security', kind: 'cameras', covers: ['medbay', 'admin', 'storage'] }, vitals: null, doorLog: null } } as unknown as typeof m.map;
    const s = securityFor(m);
    expect(s).toMatchObject({ admin: true, vitals: false, doorLog: false, _verified: true });
    const spots = s.cams as { id: string; room: string | null }[];
    expect(spots.map(x => x.id)).toEqual(['admin', 'medbay', 'storage']); // labelled Admin + MedBay hall cams, then Storage
  });
  it('map.info without admin / security (Fungle-like) turns those tabs off (edge)', () => {
    const m = build();
    m.map = { ...m.map, info: { admin: [], security: { room: 'lookout', kind: 'binoculars', covers: [] }, vitals: 'laboratory', doorLog: null } } as unknown as typeof m.map;
    expect(securityFor(m)).toMatchObject({ admin: false, cams: 'anyRoom', vitals: true });
  });
});

describe('observation builders', () => {
  it('admin drops zero rooms; cams only for real rooms (edge)', () => {
    expect(adminObservation({ electrical: 2, admin: 0 })).toEqual({ type: 'adminRead', counts: { electrical: 2 } });
    const m = build();
    expect(remoteSighting(m, 'red', 'navigation', 'cams', 'Navigation hallway')).toMatchObject({ type: 'sighting', room: 'navigation', note: 'cams: Navigation hallway' });
    expect(remoteSighting(m, 'red', 'hallwayX', 'cams')).toBeNull();
  });
  it('vitals splits dead / alive and reports who just died', () => {
    const m = build({ players: 4, dead: ['red'] });
    const v = vitalsObservation(m, ['red', 'blue']);
    expect(v.dead).toEqual(['red', 'blue']);
    expect(v.alive.sort()).toEqual(['cyan', 'green']);
    expect(newlyDeadFromVitals(m, ['red', 'blue'])).toEqual(['blue']);
  });
});

describe('admin vs claims', () => {
  it('flags more claimants than icons, and icons nobody accounts for', () => {
    const m = build({
      obs: [
        o(40, { type: 'adminRead', counts: { electrical: 1, medbay: 2 } }),
        o(41, { type: 'sighting', player: 'blue', room: 'medbay' }),
      ],
    });
    m.claims.push(
      { id: 'c1', meeting: 0, stamp: st(70), by: 'red', type: 'location', room: 'electrical', timeWindow: [30, 50] },
      { id: 'c2', meeting: 0, stamp: st(70), by: 'green', type: 'location', room: 'electrical', timeWindow: [35, 60] },
    );
    const checks = adminChecks(m);
    const elec = checks.find(c => c.room === 'electrical')!;
    expect(elec.verdict).toBe('tooManyClaims');
    expect(elec.refs).toEqual(expect.arrayContaining(['c1', 'c2']));
    const med = checks.find(c => c.room === 'medbay')!;
    expect(med.verdict).toBe('unaccounted');
    expect(med.line).toMatch(/only 1 accounted for \(Blue\)/);
  });
  it('a claim whose window does not cover the read is not checked (edge)', () => {
    const m = build({ obs: [o(40, { type: 'adminRead', counts: {} })] });
    m.claims.push({ id: 'c1', meeting: 0, stamp: st(70), by: 'red', type: 'location', room: 'electrical', timeWindow: [50, 60] });
    expect(adminChecks(m)).toEqual([]);
  });
});

describe('research-driven details', () => {
  it('vitals keeps D/C apart from DED', () => {
    const m = build({ players: 5 });
    const v = vitalsObservation(m, ['red'], ['blue', 'red']);
    expect(v).toMatchObject({ dead: ['red'], dc: ['blue'] });
    expect(v.alive.sort()).toEqual(['cyan', 'green', 'purple']);
  });
  it('resolves camera spots to real rooms, by id or by name (edge: missing room)', () => {
    const m = build();
    expect(resolveSpot(m, { id: 'x', label: 'x', room: 'medbay' })).toBe('medbay');
    expect(resolveSpot(m, { id: 'x', label: 'x', room: 'engineRoom', match: 'upper engine' })).toBe('upperEngine');
    expect(resolveSpot(m, { id: 'x', label: 'x', room: 'vault', match: 'vault' })).toBeNull();
  });
  it('comms sabotage switches the stations off until it ends', () => {
    const m = build({ obs: [o(20, { type: 'sabotage', kind: 'comms', phase: 'start' })] });
    expect(commsDown(m, 0)).toBe(true);
    m.observations.push(o(40, { type: 'sabotage', kind: 'comms', phase: 'end' }));
    expect(commsDown(m, 0)).toBe(false);
  });
});

describe('vitals reads follow player merges', () => {
  it('repoint covers dead / alive lists', () => {
    const v = { type: 'vitalsRead', dead: ['slot3'], alive: ['red'] };
    expect(repoint(v, 'slot3', 'blue')).toMatchObject({ dead: ['blue'], alive: ['red'] });
  });
});
