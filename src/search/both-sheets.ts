import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';

/** One of something for each of the two maps. */
export interface BothSheets<T> {
  readonly home: T;
  readonly away: T;
}

/** How many rows of the two maps together are in sight in a picker without scrolling. */
export const ROWS_IN_SIGHT = 8;
/** A spot this close to a position to skip is at that position: the same building, a door or two along. */
const SKIP_WITHIN_METERS = 30;

interface Listed {
  readonly name: string;
  readonly context: string;
  readonly position: LngLat;
}

function withoutRepeats<S extends Listed>(spots: readonly S[]): S[] {
  const readsLike = (a: S, b: S): boolean => a.name === b.name && a.context === b.context;
  return spots.filter((spot, index) => !spots.slice(0, index).some((earlier) => readsLike(earlier, spot)));
}

function clearOf<S extends Listed>(spots: readonly S[], skipped: readonly LngLat[] = []): S[] {
  return spots.filter((spot) => !skipped.some((position) => distanceMeters(position, spot.position) <= SKIP_WITHIN_METERS));
}

/**
 * What a list of both maps shows of the spots found around each place, best first. Two places can be
 * near enough to share their surroundings (San Jose and San Francisco): a spot is then listed with
 * the place it is nearer to, whichever search found it, and never twice. A spot at one of the
 * positions to `skip` on its map is left out. While both maps have something to list, each gets half
 * the room, so that the second map's rows are in sight under the first's; a map that is alone in the
 * list has all of it.
 */
export function shareBetweenSheets<S extends Listed>(
  spots: BothSheets<readonly S[]>,
  centres: BothSheets<LngLat>,
  skip: Partial<BothSheets<readonly LngLat[]>> = {},
): BothSheets<S[]> {
  const isNearerHome = (spot: S): boolean =>
    distanceMeters(centres.home, spot.position) <= distanceMeters(centres.away, spot.position);
  const home = clearOf(withoutRepeats([...spots.home, ...spots.away].filter(isNearerHome)), skip.home);
  const away = clearOf(withoutRepeats([...spots.away, ...spots.home].filter((spot) => !isNearerHome(spot))), skip.away);
  const each = home.length > 0 && away.length > 0 ? ROWS_IN_SIGHT / 2 : ROWS_IN_SIGHT;
  return { home: home.slice(0, each), away: away.slice(0, each) };
}
