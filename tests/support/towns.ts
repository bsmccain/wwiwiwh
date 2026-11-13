import { tileOfPlaces, type TilePlace } from './vector-tile';

/**
 * Four towns to a tile. Served as every tile, they put a named place within naming reach of any spot
 * on either sheet at any zoom, so the sentences have something to describe a spot by.
 */
export const TOWNS: readonly TilePlace[] = [
  { name: 'Alderley', kind: 'town', across: 0.25, down: 0.25 },
  { name: 'Brackwell', kind: 'town', across: 0.75, down: 0.25 },
  { name: 'Colne End', kind: 'town', across: 0.25, down: 0.75 },
  { name: 'Dunmere', kind: 'town', across: 0.75, down: 0.75 },
];

/** The names of the towns as the alternatives of a pattern. */
export const ANY_TOWN = TOWNS.map((town) => town.name).join('|');

/** The tile that holds the towns, for `MapService.tile`. */
export function tileOfTowns(): Buffer {
  return tileOfPlaces(TOWNS);
}
