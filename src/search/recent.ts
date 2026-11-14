import { presetPlace } from '../app/defaults';
import type { Place } from '../app/types';
import type { LngLat } from '../geo/types';
import { MAX_LATITUDE } from './photon';
import { samePlace } from './place';

const STORAGE_KEY = 'wwiwiwh.recent-places';
/** Where recent-spots.ts keeps the spots picked before; named here so that clearing reaches both lists. */
export const SPOTS_STORAGE_KEY = 'wwiwiwh.recent-spots';
/** "off" when the person has asked for no places or spots to be kept. Kept apart from the display settings. */
const KEEP_KEY = 'wwiwiwh.keep-recent';
export const MAX_RECENT = 6;

/** The part of Web Storage this module uses, so tests can hand in a fake. */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/*
 * The places and spots picked before are kept on this device, so a shared browser shows them to the
 * next person. They can be cleared, and keeping them can be switched off, which clears them as well.
 */

/** Whether picked places and spots are kept. They are unless the person switched it off. */
export function keepsRecentIn(storage: Pick<RecentStorage, 'getItem'> | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(KEEP_KEY) !== 'off';
  } catch {
    return false;
  }
}

/** Forgets every place and spot picked before. The display settings are kept elsewhere and stay. */
export function clearRecentIn(storage: RecentStorage | null): void {
  if (!storage) return;
  for (const key of [STORAGE_KEY, SPOTS_STORAGE_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      // Blocked storage keeps nothing to clear.
    }
  }
}

/**
 * Switching it off clears what was kept, so that "off" never leaves a list behind it. The lists go
 * first: in storage that is full, they are what makes room for "off" to be saved. Returns whether the
 * choice was saved; when "off" was not, later picks would still be kept.
 */
export function setKeepsRecentIn(storage: RecentStorage | null, keep: boolean): boolean {
  if (!storage) return false;
  if (!keep) clearRecentIn(storage);
  try {
    if (keep) storage.removeItem(KEEP_KEY);
    else storage.setItem(KEEP_KEY, 'off');
  } catch {
    // Blocked or full storage: told apart by reading it back.
  }
  return keepsRecentIn(storage) === keep;
}

interface StoredPlace {
  readonly id?: string;
  readonly name: string;
  readonly context: string;
  readonly lat: number;
  readonly lng: number;
}

function toStored(place: Place): StoredPlace {
  const { name, context, center } = place;
  return { ...(place.id === undefined ? {} : { id: place.id }), name, context, lat: center.lat, lng: center.lng };
}

/** A stored position, if it is one that can be drawn. */
export function storedPosition(lat: unknown, lng: unknown): LngLat | null {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > MAX_LATITUDE) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { lng, lat };
}

/** Stored text can be anything (an older version, another tab, a person with dev tools), so every field is checked. */
function fromStored(raw: unknown): Place | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name, context, lat, lng } = raw as Record<string, unknown>;
  // A preset is looked up afresh so that a corrected centre point reaches people who picked it before.
  const preset = typeof id === 'string' ? presetPlace(id) : null;
  if (preset) return preset;
  const center = storedPosition(lat, lng);
  if (typeof name !== 'string' || name.trim() === '' || !center) return null;
  return { name, context: typeof context === 'string' ? context : '', center };
}

function withoutRepeats(places: readonly Place[]): Place[] {
  return places.filter((place, index) => !places.slice(0, index).some((earlier) => samePlace(earlier, place)));
}

/** Newest first. Unreadable or missing storage reads as "nothing yet". */
export function recentPlacesIn(storage: RecentStorage | null): Place[] {
  if (!storage || !keepsRecentIn(storage)) return [];
  try {
    const stored: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return withoutRepeats(stored.flatMap((raw) => fromStored(raw) ?? [])).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberPlaceIn(storage: RecentStorage | null, place: Place): void {
  if (!storage || !keepsRecentIn(storage)) return;
  const earlier = recentPlacesIn(storage).filter((other) => !samePlace(other, place));
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([place, ...earlier].slice(0, MAX_RECENT).map(toStored)));
  } catch {
    // Full or blocked storage: the recent list is a convenience, so the pick itself must still go through.
  }
}

/** Reading `localStorage` itself throws in some private modes and sandboxed frames. */
export function browserStorage(): RecentStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function recentPlaces(): Place[] {
  return recentPlacesIn(browserStorage());
}

export function rememberPlace(place: Place): void {
  rememberPlaceIn(browserStorage(), place);
}

export function keepsRecent(): boolean {
  return keepsRecentIn(browserStorage());
}

export function setKeepsRecent(keep: boolean): boolean {
  return setKeepsRecentIn(browserStorage(), keep);
}

export function clearRecent(): void {
  clearRecentIn(browserStorage());
}
