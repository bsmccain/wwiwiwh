import type { Place } from '../app/types';
import { distanceMeters } from '../geo/distance';
import { fold } from './text';

/** Two entries with the same name closer than this are one place (a city and its own boundary, a preset and its search hit). */
export const SAME_PLACE_METERS = 15_000;

export function samePlace(a: Place, b: Place): boolean {
  if (a.id !== undefined && a.id === b.id) return true;
  return fold(a.name) === fold(b.name) && distanceMeters(a.center, b.center) < SAME_PLACE_METERS;
}
