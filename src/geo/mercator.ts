import type { LngLat, Vec2 } from './types';

/** Mean Earth radius in metres (the same value MapLibre uses). */
export const EARTH_RADIUS_M = 6371008.8;
export const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M;
/** Latitude at which the Web-Mercator square ends. */
export const MAX_MERCATOR_LAT = 85.051129;

const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Wraps a longitude into [-180, 180). */
export function wrapLng(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/** Wraps a Mercator x-delta into [-0.5, 0.5) so differences take the short way round the antimeridian. */
export function wrapDeltaX(dx: number): number {
  return ((((dx + 0.5) % 1) + 1) % 1) - 0.5;
}

export function toMercator(p: LngLat): Vec2 {
  const lat = clamp(p.lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  return {
    x: (p.lng + 180) / 360,
    y: (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))) / 360,
  };
}

export function fromMercator(m: Vec2): LngLat {
  const y = clamp(m.y, 0, 1);
  const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
  return { lng: wrapLng(m.x * 360 - 180), lat: clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) };
}

/**
 * Ground metres covered by one CSS pixel at the given latitude and zoom.
 * MapLibre's zoom levels are defined against 512px tiles.
 */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG)) / (512 * 2 ** zoom);
}

/** cos(latitude), floored so maths near the poles stays finite. */
export function cosLat(lat: number): number {
  return Math.max(Math.cos(clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * DEG), 1e-6);
}
