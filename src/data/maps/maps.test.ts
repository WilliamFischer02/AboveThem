import { describe, it, expect } from 'vitest';
import { MAPS, MAP_IDS } from './index';
import { validateMap, hasMapData } from '../../engine/map';
import { roomKeyCodes } from '../../input/hotkeys';

describe('map data files', () => {
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    describe(id, () => {
      it('has rooms, vents and tasks (no stubs)', () => {
        expect(hasMapData(map)).toBe(true);
        expect(map.id).toBe(id);
        expect(map.vents.length).toBeGreaterThan(0);
        expect(map.tasks.length).toBeGreaterThan(10);
      });

      it('validates structurally: unique ids/keys, symmetric adjacency, vents/tasks/info reference real rooms, visual flags', () => {
        expect(validateMap(map)).toEqual([]);
      });

      it('every room gets a single-key hotkey', () => {
        expect(Object.keys(roomKeyCodes(map))).toHaveLength(map.rooms.length);
      });

      it('carries the additive info block', () => {
        expect(map.info).toBeDefined();
        expect(map.rooms.map(r => r.id)).toContain(map.info!.emergencyButton);
      });
    });
  }

  it('visual tasks per map match the wiki Visual_tasks table', () => {
    const visual = (id: keyof typeof MAPS) => MAPS[id].tasks.filter(t => t.visual).map(t => t.id).sort();
    expect(visual('skeld')).toEqual(['clearAsteroids', 'emptyChute', 'emptyGarbage', 'primeShields', 'submitScan']);
    expect(visual('mira')).toEqual(['submitScan']);
    expect(visual('polus')).toEqual(['clearAsteroids', 'submitScan']);
    expect(visual('airship')).toEqual([]);
    expect(visual('fungle')).toEqual([]);
  });

  it('monitoring stations: cams / vitals / doorlog / admin where the game has them', () => {
    expect(MAPS.mira.info!.security).toBeNull();
    expect(MAPS.mira.info!.doorLog?.room).toBe('communications');
    expect(MAPS.skeld.info!.vitals).toBeNull();
    expect(MAPS.polus.info!.vitals).toBe('office');
    expect(MAPS.airship.info!.vitals).toBe('medical');
    expect(MAPS.fungle.info!.vitals).toBe('laboratory');
    expect(MAPS.fungle.info!.admin).toEqual([]);
    expect(MAPS.airship.info!.admin.sort()).toEqual(['cockpit', 'records']);
    expect(MAPS.fungle.info!.security?.kind).toBe('binoculars');
  });

  it('MIRA HQ is one vent network covering 11 rooms', () => {
    expect(MAPS.mira.vents).toHaveLength(1);
    expect(MAPS.mira.vents[0].rooms).toHaveLength(11);
    for (const r of ['cafeteria', 'communications', 'storage']) expect(MAPS.mira.vents[0].rooms).not.toContain(r);
  });
});
