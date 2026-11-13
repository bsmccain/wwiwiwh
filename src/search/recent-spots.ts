import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { browserStorage, type RecentStorage, storedPosition } from './recent';
import { SURROUNDINGS_METERS } from './spots';
import { fold } from './text';

const STORAGE_KEY = 'wwiwiwh.recent-spots';
export const MAX_REMEMBERED_SPOTS = 12;
/** A spot of the same name this close repeats one already remembered: one address found twice, a few doors apart at most. */
const REPEAT_WITHIN_METERS = 50;

/** A spot the person picked before: an address, a landmark, a neighbourhood. */
export interface RememberedSpot {
  readonly name: string;
  readonly context: string;
  readonly position: LngLat;
}

interface StoredSpot {
  readonly name: string;
  readonly context: string;
  readonly lat: number;
  readonly lng: number;
}

function toStored({ name, context, position }: RememberedSpot): StoredSpot {
  return { name, context, lat: position.lat, lng: position.lng };
}

/** Stored text can be anything (an older version, another tab, a person with dev tools), so every field is checked. */
function fromStored(raw: unknown): RememberedSpot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, context, lat, lng } = raw as Record<string, unknown>;
  const position = storedPosition(lat, lng);
  if (typeof name !== 'string' || name.trim() === '' || !position) return null;
  return { name, context: typeof context === 'string' ? context : '', position };
}

function isSameSpot(a: RememberedSpot, b: RememberedSpot): boolean {
  return fold(a.name) === fold(b.name) && distanceMeters(a.position, b.position) <= REPEAT_WITHIN_METERS;
}

function withoutRepeats(spots: readonly RememberedSpot[]): RememberedSpot[] {
  return spots.filter((spot, index) => !spots.slice(0, index).some((earlier) => isSameSpot(earlier, spot)));
}

/** Newest first. Unreadable or missing storage reads as "nothing yet". */
export function recentSpotsIn(storage: RecentStorage | null): RememberedSpot[] {
  if (!storage) return [];
  try {
    const stored: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return withoutRepeats(stored.flatMap((raw) => fromStored(raw) ?? [])).slice(0, MAX_REMEMBERED_SPOTS);
  } catch {
    return [];
  }
}

export function rememberSpotIn(storage: RecentStorage | null, spot: RememberedSpot): void {
  if (!storage) return;
  const earlier = recentSpotsIn(storage).filter((other) => !isSameSpot(other, spot));
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([spot, ...earlier].slice(0, MAX_REMEMBERED_SPOTS).map(toStored)));
  } catch {
    // Full or blocked storage: the recent list is a convenience, so the pick itself must still go through.
  }
}

/** The remembered spots in or near a place, newest first: those within reach of `position`, the place's centre. */
export function recentSpotsNearIn(storage: RecentStorage | null, position: LngLat, limit: number): RememberedSpot[] {
  return recentSpotsIn(storage)
    .filter((spot) => distanceMeters(position, spot.position) <= SURROUNDINGS_METERS)
    .slice(0, limit);
}

export function rememberSpot(spot: RememberedSpot): void {
  rememberSpotIn(browserStorage(), spot);
}

export function recentSpotsNear(position: LngLat, limit: number): RememberedSpot[] {
  return recentSpotsNearIn(browserStorage(), position, limit);
}
