import type { BrowserContext } from '@playwright/test';
import { destination, distanceMeters } from '../../src/geo/distance';
import type { LngLat } from '../../src/geo/types';
import { encodePolyline } from '../../src/routing/polyline';

/** One question the page put to the routing server. */
export interface RoadRequest {
  readonly action: 'route' | 'isochrone';
  /** For a route its two ends, for a reach the one spot it starts from. */
  readonly locations: readonly LngLat[];
  /** For a reach: how much driving it is drawn for. */
  readonly contour: { readonly time?: number; readonly distance?: number } | null;
}

/** The stand-in for the public routing server, and the switches a test can throw on it. */
export interface RoadService {
  /** The server is out of reach: nothing it is asked arrives. */
  down: boolean;
  /** No two spots are joined by road: every route is refused as the server refuses those. */
  noRoad: boolean;
  /** What the page has asked so far, in order. */
  readonly requests: RoadRequest[];
}

/** By road is this much further than straight there, here. */
export const ROAD_DETOUR = 1.3;
/** Every road here is driven at this speed. */
export const ROAD_KMH = 60;
/** A reach by distance gets this share of the distance away in every direction. */
const REACH_SHARE = 0.7;

interface Question {
  readonly locations?: readonly { readonly lat: number; readonly lon: number }[];
  readonly contours?: readonly { readonly time?: number; readonly distance?: number }[];
}

/** How far and how long the stand-in says the drive between two spots is. */
export function standInDrive(from: LngLat, to: LngLat): { meters: number; seconds: number } {
  const meters = Math.round(distanceMeters(from, to) * ROAD_DETOUR);
  return { meters, seconds: (meters / 1000 / ROAD_KMH) * 3600 };
}

/** A road with one bend in it, so that it is plainly not the straight line between its ends. */
function standInRoad(from: LngLat, to: LngLat): LngLat[] {
  const corner = { lat: from.lat, lng: to.lng };
  return [from, corner, to];
}

/** How far the stand-in says that much driving gets from a spot, in metres, the same in every direction. */
export function standInReachMeters(contour: { readonly time?: number; readonly distance?: number }): number {
  const kilometres = contour.distance ?? ((contour.time ?? 0) / 60) * ROAD_KMH;
  return kilometres * 1000 * REACH_SHARE;
}

function ring(center: LngLat, meters: number): [number, number][] {
  const corners = Array.from({ length: 24 }, (_unused, index) => destination(center, index * 15, meters));
  return [...corners, corners[0] as LngLat].map(({ lng, lat }) => [lng, lat]);
}

/**
 * Answers the routing server's two questions with made-up roads, so no test leans on the public
 * server: every drive is a road with one bend, 1.3 times as long as the straight line and driven at
 * 60 km/h, and every reach is a round area. The answers are shaped as the live server's are (see
 * src/routing/fixtures).
 */
export async function stubRoadService(context: BrowserContext): Promise<RoadService> {
  const service: RoadService = { down: false, noRoad: false, requests: [] };
  await context.route('https://valhalla1.openstreetmap.de/**', (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.endsWith('/isochrone') ? 'isochrone' : 'route';
    const question = JSON.parse(url.searchParams.get('json') ?? '{}') as Question;
    const locations = (question.locations ?? []).map(({ lat, lon }) => ({ lat, lng: lon }));
    const contour = question.contours?.[0] ?? null;
    service.requests.push({ action, locations, contour });
    if (service.down) return route.abort('connectionrefused');
    const answer = (status: number, body: unknown): Promise<void> =>
      route.fulfill({ status, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(body) });

    const [from, to] = locations;
    if (action === 'route') {
      if (service.noRoad || !from || !to) {
        return answer(400, { error_code: 170, error: 'Locations are in unconnected regions. Go check/edit the map at osm.org', status_code: 400, status: 'Bad Request' });
      }
      const { meters, seconds } = standInDrive(from, to);
      return answer(200, {
        trip: { legs: [{ shape: encodePolyline(standInRoad(from, to)) }], summary: { time: seconds, length: meters / 1000 }, units: 'kilometers' },
      });
    }
    if (!from || !contour) return answer(400, { error_code: 100, error: 'Failed to parse json request', status_code: 400, status: 'Bad Request' });
    return answer(200, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { contour: contour.time ?? contour.distance, metric: contour.time === undefined ? 'distance' : 'time' },
          geometry: { type: 'Polygon', coordinates: [ring(from, standInReachMeters(contour))] },
        },
      ],
    });
  });
  return service;
}
