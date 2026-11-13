/** A WGS84 position in degrees. */
export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

/** One or more areas on the ground, each an outer ring followed by any holes in it. Every ring ends where it starts. */
export type Outline = readonly (readonly (readonly LngLat[])[])[];

/** A point in Web-Mercator world space: x and y in [0, 1], y pointing south (same convention as MapLibre's MercatorCoordinate). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A flat (unpitched) map camera. Bearing is the compass direction that points up, in degrees. */
export interface Camera {
  readonly center: LngLat;
  readonly zoom: number;
  readonly bearing: number;
}
