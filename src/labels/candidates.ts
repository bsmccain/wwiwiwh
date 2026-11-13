import type { LngLat } from '../geo/types';

/**
 * The kinds of place the plate letters, most important first. They are `class` values of the
 * `place` layer in the tiles. Islands, countries, states and the like are left out on purpose.
 */
export const PLACE_CLASSES = ['city', 'town', 'suburb', 'village', 'quarter', 'neighbourhood', 'hamlet'] as const;
export type PlaceClass = (typeof PLACE_CLASSES)[number];

/** A named place as one tile carries it. The same place arrives from several tiles. */
export interface RawPlace {
  readonly name: string;
  readonly placeClass: PlaceClass;
  readonly rank: number;
  readonly position: LngLat;
}

/** A named place of one sheet, de-duplicated. */
export interface PlaceCandidate extends RawPlace {
  /** Stays the same for the same place from one read of the tiles to the next. */
  readonly id: string;
}

/**
 * Ranks 1 to 10 in the tiles are importance worldwide (London 1, San Jose 4). From 11 up a rank only
 * counts places within one patch of one tile, so it changes with the zoom the tile was cut for.
 */
export const LAST_WORLD_RANK = 10;
/** Rank given to a place whose tile carries none: behind every ranked place. */
const UNRANKED = 999;

function isPlaceClass(value: unknown): value is PlaceClass {
  return (PLACE_CLASSES as readonly unknown[]).includes(value);
}

function nameFrom(properties: Readonly<Record<string, unknown>>): string | null {
  // English first: `name_en` holds the exonym ("Tokyo", "Westminster"); `name:latin` the local
  // spelling in Latin script; `name` may be in any script.
  for (const key of ['name_en', 'name:latin', 'name'] as const) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Reads one feature of the tiles' `place` layer. `position` is where the feature lies, or null when it
 * is not a single point. Returns null for anything the plate does not letter.
 */
export function readPlace(properties: Readonly<Record<string, unknown>>, position: LngLat | null): RawPlace | null {
  const placeClass = properties['class'];
  if (!isPlaceClass(placeClass) || position === null) return null;
  const name = nameFrom(properties);
  if (name === null) return null;
  const rank = properties['rank'];
  return { name, placeClass, rank: typeof rank === 'number' && Number.isFinite(rank) ? rank : UNRANKED, position };
}

/** Two readings of the same name and class closer than this (in degrees) are one place. */
const SAME_PLACE_DEG = 0.02;
/** Twice the tolerance, so everything within reach of a position lies in a 2 by 2 block of cells. */
const CELL_DEG = SAME_PLACE_DEG * 2;
/** How many places a sheet remembers, including ones whose tiles have since been dropped. */
const DEFAULT_CAPACITY = 4000;

function cellId(placeClass: PlaceClass, name: string, cellX: number, cellY: number): string {
  return `${placeClass}|${name}|${cellX}|${cellY}`;
}

/** Finds the entry for a place by name and class within the tolerance of a position. */
function findNear<T extends RawPlace>(entries: ReadonlyMap<string, T>, place: RawPlace): T | undefined {
  const { lng, lat } = place.position;
  const x = lng / CELL_DEG;
  const y = lat / CELL_DEG;
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const sideX = x - cellX < 0.5 ? -1 : 1;
  const sideY = y - cellY < 0.5 ? -1 : 1;
  for (const cx of [cellX, cellX + sideX]) {
    for (const cy of [cellY, cellY + sideY]) {
      const hit = entries.get(cellId(place.placeClass, place.name, cx, cy));
      if (
        hit &&
        Math.abs(hit.position.lng - lng) <= SAME_PLACE_DEG &&
        Math.abs(hit.position.lat - lat) <= SAME_PLACE_DEG
      ) {
        return hit;
      }
    }
  }
  return undefined;
}

function newId(place: RawPlace): string {
  const { lng, lat } = place.position;
  return cellId(place.placeClass, place.name, Math.floor(lng / CELL_DEG), Math.floor(lat / CELL_DEG));
}

/**
 * The places of one sheet.
 *
 * `live` is what the tiles on show carry right now, de-duplicated: the plate letters these.
 * Everything seen so far is also remembered (up to a limit), so a spot can still be named after the
 * view has moved on or zoomed in past the tiles that carried its town.
 *
 * Places come in tile by tile: `enter` takes what one tile carries, once, and `show` says which tiles
 * are on show. So a tile is only ever gone through when it arrives, however often the view changes.
 */
export class PlaceBook {
  private liveList: readonly PlaceCandidate[] = [];
  private wholesaleChanges = 0;
  /** A place was entered that was not known before, and no `show` has reported it yet. */
  private grew = false;
  /** By id, least recently on show first. */
  private readonly known = new Map<string, PlaceCandidate>();
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  get live(): readonly PlaceCandidate[] {
    return this.liveList;
  }

  /**
   * Goes up each time the live places are replaced wholesale: the first tiles of all, or tiles of
   * another part of the world (a new city, the sheets swapped) with not one place in common.
   */
  get generation(): number {
    return this.wholesaleChanges;
  }

  /** Every place seen so far and still remembered. */
  all(): IterableIterator<PlaceCandidate> {
    return this.known.values();
  }

  /**
   * Enters the places one tile carries and returns them as the book knows them: each with the id its
   * place goes by here, so the copy of a place that a neighbouring tile carries gets the same id.
   */
  enter(raw: Iterable<RawPlace>): PlaceCandidate[] {
    const entered = new Map<string, PlaceCandidate>();
    for (const place of raw) {
      const id = findNear(this.known, place)?.id ?? newId(place);
      const seen = entered.get(id);
      if (seen && seen.rank <= place.rank) continue;
      const candidate = seen ? { ...seen, rank: place.rank } : { ...place, id };
      entered.set(id, candidate);
      if (!this.known.has(id)) {
        this.known.set(id, candidate);
        this.grew = true;
      }
    }
    return [...entered.values()];
  }

  /**
   * Makes the places of these tiles the live ones. Each list is what `enter` returned for one tile.
   * Returns whether the live set changed or a place has become known since the last call.
   *
   * The same place arrives from every tile whose buffer reaches it, and while the zoom is changing
   * also from tiles cut for another zoom, with another rank. The best (lowest) rank is kept.
   */
  show(tiles: Iterable<readonly PlaceCandidate[]>): boolean {
    const fresh = new Map<string, PlaceCandidate>();
    for (const places of tiles) {
      for (const place of places) {
        const seen = fresh.get(place.id);
        if (!seen) fresh.set(place.id, place);
        else if (place.rank < seen.rank) fresh.set(place.id, { ...seen, rank: place.rank });
      }
    }

    const wasLive = new Set(this.liveList.map((place) => place.id));
    let liveChanged = fresh.size !== wasLive.size;
    let carriedOn = false;
    const live: PlaceCandidate[] = [];
    for (const place of fresh.values()) {
      const before = this.known.get(place.id);
      const same =
        before !== undefined &&
        before.rank === place.rank &&
        before.position.lng === place.position.lng &&
        before.position.lat === place.position.lat;
      const kept = same ? before : place;
      if (wasLive.has(place.id)) carriedOn = true;
      if (!same || !wasLive.has(place.id)) liveChanged = true;
      // Re-inserted, so the places on show are the last to be forgotten.
      this.known.delete(place.id);
      this.known.set(place.id, kept);
      live.push(kept);
    }
    // The same array for the same places, so callers can tell at a glance that nothing changed.
    if (liveChanged) this.liveList = live;
    if (live.length > 0 && !carriedOn) this.wholesaleChanges++;

    for (const id of this.known.keys()) {
      if (this.known.size <= this.capacity) break;
      this.known.delete(id);
    }
    const changed = liveChanged || this.grew;
    this.grew = false;
    return changed;
  }
}
