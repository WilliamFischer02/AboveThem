import type { MapData, MapId } from '../../types/game';
import skeld from './skeld.json';
import mira from './mira.json';
import polus from './polus.json';
import airship from './airship.json';
import fungle from './fungle.json';

/** All shipped map files, keyed by MapId. Only Skeld is being verified in Phase 1. */
export const MAPS: Record<MapId, MapData> = {
  skeld: skeld as unknown as MapData,
  mira: mira as unknown as MapData,
  polus: polus as unknown as MapData,
  airship: airship as unknown as MapData,
  fungle: fungle as unknown as MapData,
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
