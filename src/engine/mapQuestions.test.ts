import { describe, it, expect } from 'vitest';
import { MAPS } from '../data/maps';
import questions from '../data/maps/questions.json';
import { selectMapQuestions, fillTemplate, type MapQuestionsFile } from './mapQuestions';

const data = questions as unknown as MapQuestionsFile;

describe('selectMapQuestions', () => {
  it('MIRA: a Clear Asteroids claim brings the "not visual" question and lie note to the top', () => {
    const out = selectMapQuestions(data, MAPS.mira, { claimTask: 'clearAsteroids', player: 'Blue', victim: 'Red' });
    expect(out[0].id === 'mira_asteroids_not_visual' || out[0].id === 'mira_scan_only_visual').toBe(true);
    expect(out.map(o => o.id)).toContain('mira_scan_only_visual');
    expect(out.find(o => o.id === 'mira_asteroids_not_visual')!.text).toBe('Blue asteroids is not visual on Mira. That clears nobody.');
    expect(out.find(o => o.id === 'mira_scan_only_visual')!.text).toMatch(/^Clear Asteroids is not a visual task/);
  });

  it('Airship: fake wiring panel fills {R} with the room name', () => {
    const out = selectMapQuestions(data, MAPS.airship, { claimTask: 'fixWiring', claimRoom: 'armory', player: 'Lime' }, 10);
    expect(out.find(o => o.id === 'airship_fake_wiring')!.text).toBe('Lime wiring in Armory is fake. Which panel?');
  });

  it('skips entries whose placeholders cannot be filled ({V} without a victim)', () => {
    const out = selectMapQuestions(data, MAPS.polus, { player: 'Cyan' }, 10);
    expect(out.map(o => o.id)).not.toContain('polus_vitals');
    const withV = selectMapQuestions(data, MAPS.polus, { player: 'Cyan', victim: 'Pink' }, 10);
    expect(withV.find(o => o.id === 'polus_vitals')!.text).toBe('Who checked vitals? When did Pink go DED?');
  });

  it('lies never fire without a matching condition; generic questions do', () => {
    const out = selectMapQuestions(data, MAPS.fungle, { player: 'Tan', victim: 'Rose' }, 20);
    expect(out.every(o => o.kind === 'question')).toBe(true);
    const admin = selectMapQuestions(data, MAPS.fungle, { claimMonitor: 'admin' }, 20);
    expect(admin.map(o => o.id)).toContain('fungle_no_admin');
  });

  it('more specific matches outrank generic ones; limit applies', () => {
    const out = selectMapQuestions(data, MAPS.skeld, { bodyRoom: 'navigation', claimRoom: 'electrical', player: 'Red' }, 2);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.id).sort()).toEqual(['skeld_elec_storage', 'skeld_nav_vents']);
  });

  it('unknown map set → empty list', () => {
    expect(selectMapQuestions({ maps: {} }, MAPS.skeld, {})).toEqual([]);
  });

  it('fillTemplate returns null for a missing value', () => {
    expect(fillTemplate('{P} in {R}', MAPS.skeld, { player: 'Red' })).toBeNull();
    expect(fillTemplate('{P} in {R}', MAPS.skeld, { player: 'Red', claimRoom: 'medbay' })).toBe('Red in MedBay');
  });
});
