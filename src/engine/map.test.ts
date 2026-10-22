import { describe, it, expect } from 'vitest';
import { MAPS } from '../data/maps';
import type { MapData } from '../types/game';
import {
  walkSeconds, travelMatrix, fastestSeconds, couldReach, ventNeighbours, ventReachable, ventConnected,
  ventShortcutNote, mapIdFromText, inferMapFromLabels, validateMap, hasMapData,
} from './map';

const mira = MAPS.mira;
const all = Object.values(MAPS);
const stub: MapData = { id: 'mira', name: 'stub', rooms: [], vents: [], tasks: [], _verified: { rooms: false, vents: false, tasks: false, durations: false } };

describe('travel on MIRA HQ', () => {
  it('Floyd–Warshall matrix agrees with Dijkstra walkSeconds for every pair', () => {
    const m = travelMatrix(mira);
    for (const a of m.ids) for (const b of m.ids) expect(m.sec[m.index[a]][m.index[b]]).toBeCloseTo(walkSeconds(mira, a, b), 6);
  });

  it('is symmetric and zero on the diagonal', () => {
    const m = travelMatrix(mira);
    for (let i = 0; i < m.ids.length; i++) {
      expect(m.sec[i][i]).toBe(0);
      for (let j = 0; j < m.ids.length; j++) expect(m.sec[i][j]).toBeCloseTo(m.sec[j][i], 6);
    }
  });

  it('Launchpad to Greenhouse is a long walk but a short vent trip', () => {
    const walk = fastestSeconds(mira, 'launchpad', 'greenhouse');
    const vent = fastestSeconds(mira, 'launchpad', 'greenhouse', { vents: true });
    expect(walk).toBeGreaterThan(20);
    expect(vent).toBeLessThan(walk);
    expect(vent).toBeLessThanOrEqual(8);
  });

  it('player speed scales walking time', () => {
    expect(fastestSeconds(mira, 'cafeteria', 'launchpad', { speed: 2 })).toBeCloseTo(fastestSeconds(mira, 'cafeteria', 'launchpad') / 2, 6);
  });

  it('couldReach: on foot vs with vents', () => {
    expect(couldReach(mira, 'launchpad', 'greenhouse', 10)).toBe(false);
    expect(couldReach(mira, 'launchpad', 'greenhouse', 10, { vents: true })).toBe(true);
    expect(couldReach(mira, 'cafeteria', 'storage', 3)).toBe(true);
    expect(couldReach(mira, 'cafeteria', 'storage', 1)).toBe(false);
    expect(couldReach(mira, 'cafeteria', 'storage', 1, { slackSec: 2 })).toBe(true);
  });

  it('fails soft: unknown rooms and stub maps never say "impossible"', () => {
    expect(couldReach(mira, 'cafeteria', 'nowhere', 0)).toBe(true);
    expect(couldReach(stub, 'a', 'b', 0)).toBe(true);
    expect(hasMapData(stub)).toBe(false);
    expect(validateMap(stub)).toEqual([]);
  });
});

describe('vent reach', () => {
  it('MIRA: every vent room reaches every other vent room; Cafeteria has no vent', () => {
    const ventRooms = mira.vents[0].rooms;
    for (const r of ventRooms) expect(ventReachable(mira, r).sort()).toEqual(ventRooms.filter(x => x !== r).sort());
    expect(ventReachable(mira, 'cafeteria')).toEqual([]);
    expect(ventNeighbours(mira, 'balcony').sort()).toEqual(['hallway', 'medbay']);
  });

  it('Airship: Vault and Viewing Deck only link through Cockpit; Main Hall sits in two systems', () => {
    const a = MAPS.airship;
    expect(ventNeighbours(a, 'vault')).toEqual(['cockpit']);
    expect(ventReachable(a, 'vault').sort()).toEqual(['cockpit', 'viewingDeck']);
    expect(ventReachable(a, 'mainHall').sort()).toEqual(['engineRoom', 'gapRoom', 'kitchen']);
    expect(ventConnected(a, 'cargoBay', 'showers')).toBe(true);
    expect(ventConnected(a, 'cargoBay', 'kitchen')).toBe(false);
  });

  it('Skeld (no links field) falls back to every pair inside a network', () => {
    expect(ventNeighbours(MAPS.skeld, 'medbay').sort()).toEqual(['electrical', 'security']);
  });

  it('ventShortcutNote flags a vent path faster than walking, and stays quiet otherwise', () => {
    expect(ventShortcutNote(mira, 'launchpad', 'reactor')).toMatch(/one vent hop/);
    expect(ventShortcutNote(mira, 'cafeteria', 'storage')).toBeNull();
    expect(ventShortcutNote(stub, 'a', 'b')).toBeNull();
  });
});

describe('map name from OCR text', () => {
  it.each([
    ['MIRA HQ', 'mira'], ['MIRAHQ', 'mira'], ['M1RA HQ', 'mira'], ['MIRA HO', 'mira'], ['ROOM SETTINGS\nMIRA HQ', 'mira'],
    ['THE AIRSHIP', 'airship'], ['AIRSHIP', 'airship'], ['AIRSH1P', 'airship'], ['AIRSHlP', 'airship'],
    ['THE FUNGLE', 'fungle'], ['FUNGLE', 'fungle'], ['FUNGIE', 'fungle'],
    ['POLUS', 'polus'], ['P0LUS', 'polus'],
    ['THE SKELD', 'skeld'], ['ROOM SETTINGS\nTHE SKELD', 'skeld'], ['*THE SkßLL)', null],
  ])('%s → %s', (text, id) => {
    expect(mapIdFromText(text)).toBe(id);
  });

  it('returns null for unrelated panel text', () => {
    expect(mapIdFromText('ROOM SETTINGS')).toBeNull();
    expect(mapIdFromText('CAPACITY 15/15 PUBLIC CUSTOM')).toBeNull();
    expect(mapIdFromText('')).toBeNull();
  });
});

describe('inferMapFromLabels (map from room popups / task list when the lobby read missed it)', () => {
  it('Polus task list lines → polus', () => {
    const g = inferMapFromLabels(['Laboratory: Fix Weather Node (0/2)', 'Outside: Record Temperature', 'O2: Fill Canisters', 'Insert Keys'], all);
    expect(g?.map).toBe('polus');
  });

  it('MIRA room popups → mira', () => {
    expect(inferMapFromLabels(['Launchpad', 'Locker Room', 'Greenhouse'], all)?.map).toBe('mira');
  });

  it('a single shared name (Cafeteria / Admin) is not enough', () => {
    expect(inferMapFromLabels(['Cafeteria'], all)).toBeNull();
    expect(inferMapFromLabels(['Admin', 'Fix Wiring'], all)).toBeNull();
  });
});
