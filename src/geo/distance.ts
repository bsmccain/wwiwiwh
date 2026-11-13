import { EARTH_RADIUS_M, wrapLng } from './mercator';
import type { LngLat } from './types';

const DEG = Math.PI / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b in degrees [0, 360). */
export function bearingDegrees(a: LngLat, b: LngLat): number {
  const dLng = (b.lng - a.lng) * DEG;
  const y = Math.sin(dLng) * Math.cos(b.lat * DEG);
  const x =
    Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) -
    Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** The point reached by travelling `meters` from `origin` along the given compass bearing. */
export function destination(origin: LngLat, bearingDeg: number, meters: number): LngLat {
  const d = meters / EARTH_RADIUS_M;
  const brg = bearingDeg * DEG;
  const lat1 = origin.lat * DEG;
  const lng1 = origin.lng * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lng: wrapLng(lng2 / DEG), lat: lat2 / DEG };
}
