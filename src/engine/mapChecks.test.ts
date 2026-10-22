import { describe, it, expect } from 'vitest';
import { MAPS } from '../data/maps';
import type { MapData, MyTask } from '../types/game';
import { claimedTaskExists, commonTaskMismatch, monitorContradiction, findTask, monitorReadFromObs } from './mapChecks';
import { walkPath } from './map';

const all = Object.values(MAPS);
const stub: MapData = { id: 'mira', name: 'stub', rooms: [], vents: [], tasks: [], _verified: { rooms: false, vents: false, tasks: false, durations: false } };
const my = (...ids: string[]): MyTask[] => ids.map(id => ({ id, name: id, matched: true }));

describe('findTask', () => {
  it('matches by id, exact name and OCR-ish name; Download Data → the Download / Upload task', () => {
    expect(findTask(MAPS.skeld, 'swipeCard')?.id).toBe('swipeCard');
    expect(findTask(MAPS.skeld, 'Swipe Card')?.id).toBe('swipeCard');
    expect(findTask(MAPS.skeld, 'Swlpe Card')?.id).toBe('swipeCard');
    expect(findTask(MAPS.airship, 'Download Data')?.id).toBe('downloadUpload');
    expect(findTask(MAPS.skeld, 'Make Burger')).toBeNull();
  });
});

describe('claimedTaskExists', () => {
  it('ok when the task is in that room', () => {
    expect(claimedTaskExists(MAPS.mira, 'Sort Samples', 'laboratory')).toMatchObject({ ok: true, reason: 'ok' });
  });
  it('task in the wrong room', () => {
    const r = claimedTaskExists(MAPS.skeld, 'Swipe Card', 'storage');
    expect(r).toMatchObject({ ok: false, reason: 'notInRoom', rooms: ['admin'] });
    expect(r.text).toMatch(/not in Storage/);
  });
  it('task from another map is named as such', () => {
    const r = claimedTaskExists(MAPS.mira, 'Swipe Card', 'admin', all);
    expect(r.reason).toBe('notOnMap');
    expect(r.otherMaps).toEqual(expect.arrayContaining(['skeld', 'polus']));
  });
  it('dummy panels', () => {
    expect(claimedTaskExists(MAPS.airship, 'Fix Wiring', 'armory').reason).toBe('dummyPanel');
    expect(claimedTaskExists(MAPS.skeld, 'Divert Power', 'reactor').reason).toBe('dummyPanel');
  });
  it('fails soft on stub maps and gibberish', () => {
    expect(claimedTaskExists(stub, 'Anything', 'x').ok).toBe(true);
    expect(claimedTaskExists(MAPS.skeld, 'qqqqzz', 'admin', all)).toMatchObject({ ok: true, reason: 'unknownTask' });
  });
});

describe('commonTaskMismatch', () => {
  it('claimed common task that is not on my fully-read list → mismatch', () => {
    const r = commonTaskMismatch(MAPS.mira, my('fixWiring', 'sortSamples'), 'Enter Id Code');
    expect(r).toMatchObject({ mismatch: true });
    expect(r!.task.id).toBe('enterIdCode');
  });
  it('I have it too → no mismatch', () => {
    expect(commonTaskMismatch(MAPS.mira, my('enterIdCode'), 'Enter Id Code')).toMatchObject({ mismatch: false });
  });
  it('cannot judge: non-common task, no list, or an unreadable line on my list', () => {
    expect(commonTaskMismatch(MAPS.mira, my('fixWiring'), 'Sort Samples')).toBeNull();
    expect(commonTaskMismatch(MAPS.mira, undefined, 'Enter Id Code')).toBeNull();
    expect(commonTaskMismatch(MAPS.mira, [...my('fixWiring'), { id: 'Ent3r 1d C0d', name: 'Ent3r 1d C0d', matched: false }], 'Enter Id Code')).toMatchObject({ mismatch: false });
    expect(commonTaskMismatch(MAPS.mira, [...my('fixWiring'), { id: '???', name: '???', matched: false }], 'Enter Id Code')).toBeNull();
  });
  it('Fix Wiring is short (not common) on The Fungle', () => {
    expect(commonTaskMismatch(MAPS.fungle, my('collectSamples'), 'Fix Wiring')).toBeNull();
  });
});

describe('monitorReadFromObs (features agent observation shapes)', () => {
  const stamp = { round: 1, t: 40, wall: 0 };
  it('adminRead → admin read at stamp.t, usable by monitorContradiction', () => {
    const read = monitorReadFromObs({ type: 'adminRead', stamp, counts: { electrical: 0, storage: 2 }, bodies: [] });
    expect(read).toEqual({ kind: 'admin', t: 40, counts: { electrical: 0, storage: 2 } });
    expect(monitorContradiction(MAPS.skeld, read!, { player: 'red', room: 'electrical', t: 41 })).toMatchObject({ contradiction: true });
  });
  it('vitalsRead → per-player status (dc wins over dead wins over alive)', () => {
    expect(monitorReadFromObs({ type: 'vitalsRead', stamp, alive: ['red', 'blue'], dead: ['pink'], dc: ['blue'] }))
      .toEqual({ kind: 'vitals', t: 40, status: { red: 'alive', blue: 'dc', pink: 'dead' } });
  });
  it('doorLogRead → doorLog read', () => {
    const read = monitorReadFromObs({ type: 'doorLogRead', stamp, from: 10, to: 40, entries: [{ player: 'red', t: 20 }] });
    expect(read).toEqual({ kind: 'doorLog', from: 10, to: 40, entries: [{ player: 'red', t: 20 }] });
  });
  it('other observations → null; missing stamp → null (no time = cannot line up with a claim; bugs-rust review)', () => {
    expect(monitorReadFromObs({ type: 'sighting', player: 'red', room: 'admin' })).toBeNull();
    expect(monitorReadFromObs({ type: 'adminRead', counts: {} })).toBeNull();
  });
});

describe('monitorContradiction', () => {
  it('Admin showed the claimed room empty at that moment', () => {
    const r = monitorContradiction(MAPS.skeld, { kind: 'admin', t: 40, counts: { electrical: 0, storage: 2 } }, { player: 'red', room: 'electrical', t: 42 });
    expect(r).toMatchObject({ contradiction: true, reason: 'adminEmpty' });
    expect(monitorContradiction(MAPS.skeld, { kind: 'admin', t: 40, counts: { storage: 2 } }, { player: 'red', room: 'storage', t: 41 })).toMatchObject({ contradiction: false });
    expect(monitorContradiction(MAPS.skeld, { kind: 'admin', t: 10, counts: { electrical: 0 } }, { player: 'red', room: 'electrical', t: 42 })).toBeNull();
  });
  it('an Admin read on The Fungle is itself impossible', () => {
    expect(monitorContradiction(MAPS.fungle, { kind: 'admin', t: 0, counts: {} }, { player: 'x', t: 0 })).toMatchObject({ reason: 'noAdminOnMap' });
  });
  it('Vitals: "I saw V alive" after V showed DED', () => {
    const r = monitorContradiction(MAPS.polus, { kind: 'vitals', t: 30, status: { pink: 'dead' } }, { player: 'cyan', about: 'pink', aboutAlive: true, t: 45 });
    expect(r).toMatchObject({ contradiction: true, reason: 'aliveAfterDeath' });
    expect(monitorContradiction(MAPS.polus, { kind: 'vitals', t: 50, status: { pink: 'dead' } }, { player: 'cyan', about: 'pink', aboutAlive: true, t: 45 })).toBeNull();
    expect(monitorContradiction(MAPS.mira, { kind: 'vitals', t: 0, status: {} }, { player: 'x', t: 0 })).toMatchObject({ reason: 'noVitalsOnMap' });
  });
  it('MIRA Doorlog: walking across the Hallway with no log entry (shaky: vents skip sensors)', () => {
    expect(walkPath(MAPS.mira, 'launchpad', 'admin')).toContain('hallway');
    const read = { kind: 'doorLog' as const, from: 20, to: 60, entries: [{ player: 'blue', t: 30 }] };
    expect(monitorContradiction(MAPS.mira, read, { player: 'red', fromRoom: 'launchpad', room: 'admin', t: 40 })).toMatchObject({ contradiction: true, reason: 'doorLogMissing', shaky: true });
    expect(monitorContradiction(MAPS.mira, read, { player: 'blue', fromRoom: 'launchpad', room: 'admin', t: 40 })).toMatchObject({ contradiction: false });
    expect(monitorContradiction(MAPS.mira, read, { player: 'red', fromRoom: 'launchpad', room: 'reactor', t: 40 })).toBeNull();
    expect(monitorContradiction(MAPS.skeld, read, { player: 'red', fromRoom: 'cafeteria', room: 'admin', t: 40 })).toMatchObject({ reason: 'noDoorLogOnMap' });
  });
});
