import { toMercator } from '../geo/mercator';
import { LAST_WORLD_RANK, PLACE_CLASSES, type PlaceCandidate, type PlaceClass } from './candidates';

const CITIES_AND_TOWNS: ReadonlySet<PlaceClass> = new Set<PlaceClass>(['city', 'town']);
const DOWN_TO_SUBURBS: ReadonlySet<PlaceClass> = new Set<PlaceClass>(['city', 'town', 'suburb', 'village']);
const EVERY_CLASS: ReadonlySet<PlaceClass> = new Set<PlaceClass>(PLACE_CLASSES);

/**
 * Which classes are lettered at an Away zoom. Both sheets go by the Away zoom, so the two cities
 * are named in the same detail whatever the zoom offset between them. The same set object comes
 * back for every zoom of one band.
 */
export function classesAtZoom(awayZoom: number): ReadonlySet<PlaceClass> {
  if (awayZoom < 11) return CITIES_AND_TOWNS;
  if (awayZoom < 13) return DOWN_TO_SUBURBS;
  return EVERY_CLASS;
}

export interface StageSize {
  readonly width: number;
  readonly height: number;
}

/** One name per sheet for about this much stage, which is some 25 names on a 1440 by 900 stage. */
const STAGE_AREA_PER_NAME = 52_000;
/** Small stages still get this many names, so a phone shows more than a handful. */
const MIN_NAMES = 12;
const MAX_NAMES = 48;

/** How many names one sheet aims to have on a stage of this size, before any that collide are dropped. */
export function namesWanted(stage: StageSize): number {
  return Math.min(MAX_NAMES, Math.max(MIN_NAMES, (stage.width * stage.height) / STAGE_AREA_PER_NAME));
}

/** A place of a class lettered at the current zoom, with its standing among its neighbours. */
export interface RankedPlace {
  readonly place: PlaceCandidate;
  /** 1 for the most important place of its patch of ground, 2 for the next, and so on. */
  readonly standing: number;
  /** Lower is lettered first: the world rank for places that have one, else 10 + standing. */
  readonly priority: number;
}

/** More important first: by rank, then class, then name so the order never depends on tile order. */
function compareImportance(a: PlaceCandidate, b: PlaceCandidate): number {
  return (
    a.rank - b.rank ||
    PLACE_CLASSES.indexOf(a.placeClass) - PLACE_CLASSES.indexOf(b.placeClass) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    a.position.lng - b.position.lng
  );
}

/**
 * Ranks the places of a sheet that are of a class lettered at this Away zoom, most important first.
 *
 * The ground is cut into square patches, the quarters of the tiles of the sheet's own zoom level
 * (`sheetZoom` is its map's zoom, which for Home differs from the Away zoom by the zoom offset), and
 * each place gets its standing within its patch. Lettering the first few of every patch spreads the
 * names evenly instead of piling them where the data is densest. This is how the tiles themselves
 * rank places (10 + n for the n-th of a quarter tile); it is redone here so that it also holds from
 * zoom 13, where the tiles stop ranking that way, and while tiles cut for two zooms are mixed.
 */
export function rankPlaces(places: Iterable<PlaceCandidate>, awayZoom: number, sheetZoom: number): RankedPlace[] {
  const classes = classesAtZoom(awayZoom);
  const patchesPerWorld = 2 ** (Math.floor(sheetZoom) + 1);
  const patches = new Map<number, PlaceCandidate[]>();
  for (const place of places) {
    if (!classes.has(place.placeClass)) continue;
    const world = toMercator(place.position);
    const key = Math.floor(world.x * patchesPerWorld) * patchesPerWorld + Math.floor(world.y * patchesPerWorld);
    const patch = patches.get(key);
    if (patch) patch.push(place);
    else patches.set(key, [place]);
  }

  const ranked: RankedPlace[] = [];
  for (const patch of patches.values()) {
    patch.sort(compareImportance);
    patch.forEach((place, index) => {
      const standing = index + 1;
      ranked.push({
        place,
        standing,
        priority: place.rank <= LAST_WORLD_RANK ? place.rank : LAST_WORLD_RANK + standing,
      });
    });
  }
  return ranked.sort((a, b) => a.priority - b.priority || compareImportance(a.place, b.place));
}

/** Never more names than this from one patch, however empty the rest of the stage is. */
export const MAX_PER_PATCH = 8;
/**
 * The number in use is kept unless another comes this much closer to the wanted count, measured as
 * a ratio (0.2 is about a fifth more or fewer names).
 */
const CLEARLY_BETTER = 0.2;

/**
 * How many names to letter per patch so that about `wanted` of them are on the stage.
 *
 * `standingsOnStage` holds the standing of every ranked place that is on the stage. A city packed
 * into one corner of the stage thus gets more names per patch than one spread all over it, and the
 * two sheets end up with a comparable number of names.
 *
 * The number in use (`current`) is kept until another is clearly better, so that panning does not
 * add or drop a whole layer of names each time one place crosses the stage edge.
 */
export function namesPerPatch(standingsOnStage: Iterable<number>, wanted: number, current?: number): number {
  // counts[n] is the number of names on the stage when n are lettered per patch.
  const counts = new Array<number>(MAX_PER_PATCH + 1).fill(0);
  for (const standing of standingsOnStage) {
    if (standing >= 1 && standing <= MAX_PER_PATCH) counts[standing] = (counts[standing] as number) + 1;
  }
  for (let n = 2; n <= MAX_PER_PATCH; n++) counts[n] = (counts[n] as number) + (counts[n - 1] as number);

  /** How far off the wanted count n names per patch would be: 0 is exact, 0.69 is double or half. */
  const miss = (n: number): number => {
    const count = counts[n] as number;
    return count === 0 ? Infinity : Math.abs(Math.log(count / wanted));
  };
  let best = 1;
  for (let n = 2; n <= MAX_PER_PATCH; n++) {
    if (miss(n) < miss(best)) best = n;
  }
  const keep = current !== undefined && Number.isInteger(current) && current >= 1 && current <= MAX_PER_PATCH;
  return keep && miss(current) - miss(best) < CLEARLY_BETTER ? current : best;
}
