import { describe, expect, it } from 'vitest';
import { placesInLayer, tilePointToLngLat, type TileFeature, type TileLayer } from './tile-places';

const EXTENT = 4096;
const POINT = 1;
const LINE = 2;

function feature(
  properties: Record<string, unknown>,
  points: readonly (readonly [number, number])[],
  type: number = POINT,
): TileFeature {
  return { type, properties, extent: EXTENT, loadGeometry: () => points.map(([x, y]) => [{ x, y }]) };
}

function layerOf(...features: TileFeature[]): TileLayer {
  return { length: features.length, feature: (index) => features[index] as TileFeature };
}

describe('tilePointToLngLat', () => {
  it('puts the corners of the one tile of zoom 0 at the corners of the world', () => {
    const world = { z: 0, x: 0, y: 0 };
    expect(tilePointToLngLat(world, EXTENT, 0, 0).lng).toBeCloseTo(-180, 9);
    expect(tilePointToLngLat(world, EXTENT, 0, 0).lat).toBeCloseTo(85.051129, 5);
    expect(tilePointToLngLat(world, EXTENT, EXTENT / 2, EXTENT / 2)).toEqual({ lng: 0, lat: expect.closeTo(0, 9) });
  });

  it('finds central London in its tile', () => {
    // Tile 10/511/340 runs from 0.3516 W to the meridian and from 51.6180 N down to 51.3992 N.
    const london = tilePointToLngLat({ z: 10, x: 511, y: 340 }, EXTENT, 2608, 2075);
    expect(london.lng).toBeCloseTo(-0.1277, 3);
    expect(london.lat).toBeCloseTo(51.5073, 3);
  });

  it('gives the same position from either of two tiles whose buffers share the point', () => {
    const fromWest = tilePointToLngLat({ z: 10, x: 511, y: 340 }, EXTENT, EXTENT + 60, 100);
    const fromEast = tilePointToLngLat({ z: 10, x: 512, y: 340 }, EXTENT, 60, 100);
    expect(fromWest.lng).toBeCloseTo(fromEast.lng, 12);
    expect(fromWest.lat).toBeCloseTo(fromEast.lat, 12);
  });

  it('brings a point in the buffer past the antimeridian back into range', () => {
    const lastColumn = 2 ** 8 - 1;
    const beyond = tilePointToLngLat({ z: 8, x: lastColumn, y: 140 }, EXTENT, EXTENT + 64, 2048);
    expect(beyond.lng).toBeGreaterThan(-180);
    expect(beyond.lng).toBeLessThan(-179.9);
  });
});

describe('placesInLayer', () => {
  const tile = { z: 10, x: 511, y: 340 };

  it('reads the named places of a tile with their positions on the globe', () => {
    const places = placesInLayer(
      layerOf(
        feature({ class: 'city', rank: 1, name_en: 'London' }, [[2608, 2075]]),
        feature({ class: 'suburb', rank: 13, name: 'Soho' }, [[2508, 1960]]),
      ),
      tile,
    );
    expect(places.map((place) => [place.name, place.placeClass, place.rank])).toEqual([
      ['London', 'city', 1],
      ['Soho', 'suburb', 13],
    ]);
    expect(places[0]?.position.lng).toBeCloseTo(-0.1277, 3);
    expect(places[0]?.position.lat).toBeCloseTo(51.5073, 3);
  });

  it('leaves out what the plate does not letter', () => {
    const places = placesInLayer(
      layerOf(
        feature({ class: 'country', rank: 1, name_en: 'United Kingdom' }, [[10, 10]]),
        feature({ class: 'town', rank: 11 }, [[20, 20]]),
        feature({ class: 'town', rank: 11, name_en: 'Watford' }, [[30, 30]]),
      ),
      tile,
    );
    expect(places.map((place) => place.name)).toEqual(['Watford']);
  });

  it('leaves out anything that is not a single point', () => {
    const places = placesInLayer(
      layerOf(
        feature({ class: 'town', name_en: 'Line' }, [[0, 0]], LINE),
        feature({ class: 'town', name_en: 'Twice' }, [
          [0, 0],
          [9, 9],
        ]),
        feature({ class: 'town', name_en: 'Nowhere' }, []),
      ),
      tile,
    );
    expect(places).toEqual([]);
  });

  it('reads an empty layer as no places', () => {
    expect(placesInLayer(layerOf(), tile)).toEqual([]);
  });
});
