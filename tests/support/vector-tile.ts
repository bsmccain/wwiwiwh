/**
 * Just enough of the Mapbox Vector Tile format (a protobuf message) to write a tile whose `place`
 * layer holds a few named points. That is all the app reads place names from.
 */

/** The side of a tile in its own units. */
const EXTENT = 4096;
const POINT_GEOMETRY = 1;
/** "Move to", once: the whole geometry of a single point. */
const MOVE_TO_ONCE = (1 << 3) | 1;

const WIRE_VARINT = 0;
const WIRE_BYTES = 2;

/** Field numbers of the format's messages. */
const TILE = { layers: 3 } as const;
const LAYER = { name: 1, features: 2, keys: 3, values: 4, extent: 5, version: 15 } as const;
const FEATURE = { tags: 2, type: 3, geometry: 4 } as const;
const VALUE = { text: 1 } as const;

export interface TilePlace {
  readonly name: string;
  /** The kind of place, as the tiles' `class` property has it. */
  readonly kind: 'city' | 'town' | 'village';
  /** Where in the tile, as shares of its side from the top-left corner. */
  readonly across: number;
  readonly down: number;
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return bytes;
}

function number(field: number, value: number): number[] {
  return [...varint((field << 3) | WIRE_VARINT), ...varint(value)];
}

function bytes(field: number, payload: readonly number[]): number[] {
  return [...varint((field << 3) | WIRE_BYTES), ...varint(payload.length), ...payload];
}

function text(field: number, value: string): number[] {
  return bytes(field, [...Buffer.from(value, 'utf8')]);
}

/** Signed numbers are stored folded, so that small ones of either sign stay short. */
function zigzag(value: number): number {
  return (value << 1) ^ (value >> 31);
}

/** A vector tile with one layer, `place`, holding these places as points with a `name` and a `class`. */
export function tileOfPlaces(places: readonly TilePlace[]): Buffer {
  const keys = ['name', 'class'];
  const values: string[] = [];
  const valueIndex = (value: string): number => {
    const known = values.indexOf(value);
    return known === -1 ? values.push(value) - 1 : known;
  };

  const features = places.map((place) =>
    bytes(LAYER.features, [
      ...bytes(FEATURE.tags, [...varint(0), ...varint(valueIndex(place.name)), ...varint(1), ...varint(valueIndex(place.kind))]),
      ...number(FEATURE.type, POINT_GEOMETRY),
      ...bytes(FEATURE.geometry, [
        ...varint(MOVE_TO_ONCE),
        ...varint(zigzag(Math.round(place.across * EXTENT))),
        ...varint(zigzag(Math.round(place.down * EXTENT))),
      ]),
    ]),
  );

  const layer = [
    ...number(LAYER.version, 2),
    ...text(LAYER.name, 'place'),
    ...features.flat(),
    ...keys.flatMap((key) => text(LAYER.keys, key)),
    ...values.flatMap((value) => bytes(LAYER.values, text(VALUE.text, value))),
    ...number(LAYER.extent, EXTENT),
  ];
  return Buffer.from(bytes(TILE.layers, layer));
}
