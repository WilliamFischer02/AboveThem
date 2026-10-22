/**
 * Thin adapter over map helpers the maps agent added on its branch.
 * MERGE: after the maps branch is in, replace the body with
 *   export { hasMapData } from './map';
 * (same signature: false for a stub map ⇒ room-based rules stand down, never accuse on missing data).
 */
import type { MapData } from '../types/game';

export function hasMapData(map: MapData | undefined): boolean {
  return !!map && map.rooms.length > 1 && map.rooms.some(r => r.adjacent.length > 0);
}
