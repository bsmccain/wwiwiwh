import { bearingDegrees, distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { LAST_WORLD_RANK, type PlaceCandidate, type PlaceClass } from './candidates';

export interface NearestPlace {
  readonly name: string;
  readonly position: LngLat;
  readonly distanceMeters: number;
  /** compass bearing FROM the named place TO the queried position, degrees 0-360 */
  readonly bearingDeg: number;
}

/** Further than this from every known place, a spot has no name. */
export const NAMING_REACH_METERS = 40_000;

const METERS_PER_DEGREE_LAT = 111_195;

/**
 * How far a place's name carries, in rough kilometres: the distance at which "near Watford" still
 * says more than the name of the hamlet next door. A spot is named after the place with the smallest
 * distance divided by this. So a town 1.2 km away is preferred to a hamlet 900 m away, and a city
 * centre 2.5 km away to a suburb 1 km away, while standing in the middle of the hamlet still reads
 * as the hamlet.
 */
const NAME_CARRIES: Readonly<Record<PlaceClass, number>> = {
  city: 4,
  town: 3,
  suburb: 1.5,
  village: 1,
  quarter: 0.8,
  neighbourhood: 0.8,
  hamlet: 0.5,
};
/** Cities known worldwide (the tiles rank them 10 or better) carry further than a ward or a satellite city. */
const WORLD_CITY_CARRIES = 6;

export function nameCarries(place: Pick<PlaceCandidate, 'placeClass' | 'rank'>): number {
  if (place.placeClass === 'city' && place.rank <= LAST_WORLD_RANK) return WORLD_CITY_CARRIES;
  return NAME_CARRIES[place.placeClass];
}

/**
 * The place a position is best named after, among the places given, or null when none of them is
 * within `NAMING_REACH_METERS`.
 */
export function nearestPlace(places: Iterable<PlaceCandidate>, at: LngLat): NearestPlace | null {
  const reachLat = NAMING_REACH_METERS / METERS_PER_DEGREE_LAT;
  const reachLng = reachLat / Math.max(Math.cos((at.lat * Math.PI) / 180), 0.01);

  let best: PlaceCandidate | null = null;
  let bestDistance = Infinity;
  let bestScore = Infinity;
  let bestCarries = 0;
  for (const place of places) {
    // A cheap box first: most known places are nowhere near.
    if (Math.abs(place.position.lat - at.lat) > reachLat) continue;
    const dLng = Math.abs(place.position.lng - at.lng);
    if (Math.min(dLng, 360 - dLng) > reachLng) continue;
    const distance = distanceMeters(place.position, at);
    if (distance > NAMING_REACH_METERS) continue;
    const carries = nameCarries(place);
    const score = distance / carries;
    // Standing exactly on two places at once, the bigger one names the spot.
    if (score < bestScore || (score === bestScore && carries > bestCarries)) {
      best = place;
      bestDistance = distance;
      bestScore = score;
      bestCarries = carries;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    position: best.position,
    distanceMeters: bestDistance,
    bearingDeg: bearingDegrees(best.position, at),
  };
}
