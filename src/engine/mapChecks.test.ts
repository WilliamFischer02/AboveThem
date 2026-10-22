import { describe, expect, it } from 'vitest';
import { MAPS } from '../data/maps';
import { mapChecks, mapChecksLine, roomLabel } from './mapChecks';

describe('mapChecks (what you can check on this map)', () => {
  it('Skeld: cameras (truncated covers), plain Admin, no vitals / door log', () => {
    const c = mapChecks(MAPS.skeld);
    expect(c.map(x => x.kind)).toEqual(['cams', 'admin']);
    expect(c[0].label).toMatch(/^Cams: .+, .+, .+ \+4$/);
    expect(c[0].detail).toMatch(/Cameras in Security show/);
    expect(c[1].label).toBe('Admin');
  });

  it('MIRA: no cameras, door log in Communications', () => {
    const kinds = mapChecks(MAPS.mira).map(x => x.kind);
    expect(kinds).not.toContain('cams');
    expect(kinds).toContain('doorLog');
  });

  it('Polus has Vitals; Airship lists both Admin tables; Fungle has binoculars and no Admin', () => {
    expect(mapChecksLine(MAPS.polus)).toMatch(/💓 Vitals: /);
    expect(mapChecks(MAPS.airship).find(x => x.kind === 'admin')!.label).toMatch(/^Admin: .+, .+$/);
    const f = mapChecks(MAPS.fungle).map(x => x.kind);
    expect(f).toContain('binoculars');
    expect(f).not.toContain('admin');
  });

  it('edge: no info → nothing (UI hides the line); button only on request', () => {
    expect(mapChecks({ ...MAPS.skeld, info: undefined })).toEqual([]);
    expect(mapChecksLine({ ...MAPS.skeld, info: undefined })).toBe('');
    expect(mapChecks(MAPS.skeld, { button: true }).at(-1)?.kind).toBe('button');
  });

  it('ids that are not rooms read as words', () => {
    expect(roomLabel(MAPS.polus, 'outsideLeft')).toMatch(/Outside Left|outside/i);
  });
});
