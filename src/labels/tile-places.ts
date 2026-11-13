import type { Map as MapLibreMap, Tile } from 'maplibre-gl';
import { fromMercator } from '../geo/mercator';
import type { LngLat } from '../geo/types';
import { SOURCE_ID } from '../map/contracts';
import { readPlace, type RawPlace } from './candidates';

/** The layer of the tiles that holds the named places. */
const PLACE_LAYER = 'place';
/** The geometry type of point features in a vector tile. */
const POINT = 1;

/** Which tile of the pyramid: zoom level, column and row. */
export interface TileAddress {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** A feature of a vector tile, as far as reading a place needs it. */
export interface TileFeature {
  readonly type: number;
  readonly properties: Readonly<Record<string, unknown>>;
  /** The side of the tile in the units of the feature's geometry. */
  readonly extent: number;
  loadGeometry(): readonly (readonly { readonly x: number; readonly y: number }[])[];
}

export interface TileLayer {
  readonly length: number;
  feature(index: number): TileFeature;
}

/**
 * Where a point given in a tile's own units lies on the globe. Points in a tile's buffer lie outside
 * 0 to `extent`; past the antimeridian they come back wrapped into -180 to 180.
 */
export function tilePointToLngLat(tile: TileAddress, extent: number, x: number, y: number): LngLat {
  const tilesAcross = 2 ** tile.z;
  return fromMercator({ x: (tile.x + x / extent) / tilesAcross, y: (tile.y + y / extent) / tilesAcross });
}

function positionOf(feature: TileFeature, tile: TileAddress): LngLat | null {
  if (feature.type !== POINT) return null;
  const points = feature.loadGeometry();
  const point = points.length === 1 ? points[0]?.[0] : undefined;
  return point ? tilePointToLngLat(tile, feature.extent, point.x, point.y) : null;
}

/** The places one tile's `place` layer carries. */
export function placesInLayer(layer: TileLayer, tile: TileAddress): RawPlace[] {
  const places: RawPlace[] = [];
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    const place = readPlace(feature.properties, positionOf(feature, tile));
    if (place) places.push(place);
  }
  return places;
}

/** One tile a map is drawing from. */
export interface ShownTile {
  /**
   * Stands for the tile's data: the same object until the tile is fetched again. Restyling a map
   * parses its tiles afresh but keeps this, so a change of theme does not make every tile new.
   */
  readonly data: object;
  /** Reads the places the tile carries. This decodes every feature of its `place` layer. */
  places(): RawPlace[];
}

function shownTile(tile: Tile): ShownTile | null {
  const index = tile.latestFeatureIndex;
  const data = index?.rawTileData;
  if (!index || !data) return null;
  return {
    data,
    places() {
      const layer = index.loadVTLayers()[PLACE_LAYER];
      return layer ? placesInLayer(layer, tile.tileID.canonical) : [];
    },
  };
}

/**
 * The tiles a map is drawing from right now that have data: the ones `map.querySourceFeatures` goes
 * through.
 *
 * That call decodes every feature of every one of them each time it is made, tens of milliseconds
 * over a big city. Taking the tiles one by one lets each be read once, when it arrives, in a
 * millisecond or two. MapLibre has no public call for that, so this goes through its tile manager.
 * Everything used here is in its type declarations, so an upgrade that moves any of it fails the
 * typecheck rather than the page.
 */
export function shownTiles(map: MapLibreMap): ShownTile[] {
  const manager = map.style?.tileManagers[SOURCE_ID];
  if (!manager) return [];
  const tiles: ShownTile[] = [];
  for (const id of manager.getRenderableIds()) {
    const tile = manager.getTileByID(id);
    const shown = tile && shownTile(tile);
    if (shown) tiles.push(shown);
  }
  return tiles;
}
