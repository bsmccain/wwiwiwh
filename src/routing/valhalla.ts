import { distanceMeters } from '../geo/distance';
import type { LngLat, Outline } from '../geo/types';
import { readJsonWithin } from '../net/read-json';
import { decodePolyline, SHAPE_DIGITS } from './polyline';

/*
 * Driving routes, and how far a drive reaches, from the public Valhalla server that FOSSGIS runs for
 * OpenStreetMap (https://valhalla1.openstreetmap.de). It is free, needs no key and promises nothing;
 * its terms allow one request a second and no heavy use. Every rule below was checked against the
 * live server on 2026-11-13:
 *  - a GET with the whole question in one `json` parameter is answered with
 *    `access-control-allow-origin: *`, errors included, and needs no preflight;
 *  - `units: kilometers` makes every length a number of kilometres; times are seconds;
 *  - `directions_type: none` leaves the turn-by-turn instructions out, which are most of an answer;
 *  - a route's shape is an encoded polyline with six decimal places, one per leg;
 *  - "no way by road" is an HTTP 400 with an `error_code`: 170 (the ends are in road networks that
 *    do not touch), 171 (no road near an end), 442 (no path found). 154 is a drive of more than
 *    1,500 km, which the server will not work out;
 *  - /isochrone draws one polygon per contour, by `time` in minutes (60 at most, error 151 beyond)
 *    or by `distance` in kilometres (100 at most, error 166 beyond). Fractions are accepted;
 *  - asked for the reach of a spot with no road near it (out at sea), /isochrone does not refuse:
 *    it answers 200 with a square a few hundred metres across.
 */

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';

/** Longer than a search waits: a contour of 100 km took the server close to five seconds. */
export const ROUTING_TIMEOUT_MS = 15_000;
/** The longest drive whose reach the server will draw by time, in minutes. */
export const REACH_MAX_MINUTES = 60;
/** The longest drive whose reach the server will draw by distance, in kilometres. */
export const REACH_MAX_KILOMETRES = 100;
/** The longest drive the server will work out at all, in kilometres. */
export const ROUTE_MAX_KILOMETRES = 1500;

/*
 * How much of an answer is read and drawn. A real answer is far inside each: the reach of 28 km about
 * London is 1,563 points in 33 kB, and a route through London's streets is 33 points a kilometre, so
 * the longest drive the server works out would be 50,000 points if it were all streets like those.
 * Anything past these is refused as no answer.
 */
/** Longer than this, an answer is refused while it arrives. */
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
/** Points on a route, all its legs together. */
export const MAX_ROUTE_POINTS = 150_000;
/** A route between two spots is one leg; a few more is room for the server to split one. */
export const MAX_ROUTE_LEGS = 8;
/** Corners in a reach, all its rings together. */
export const MAX_REACH_POINTS = 100_000;

/** Positions are sent as a link writes them, so that a drive reopened from its link asks the same question. */
const COORD_DIGITS = 5;
/** Contours are asked for to a tenth of a minute and a tenth of a kilometre, and never smaller than that. */
const LIMIT_DIGITS = 1;
const SMALLEST_LIMIT = 0.1;
/** How coarsely a contour may be drawn, in metres. */
const DETAIL_RANGE_METERS = { finest: 10, coarsest: 250 } as const;

/** What the server says when there is no way by road between the two ends. */
const NO_ROAD_CODES: ReadonlySet<number> = new Set([170, 171, 442]);
const TOO_FAR_CODE = 154;
/** A contour beyond what the server draws: by time, by distance. */
const BEYOND_CODES: ReadonlySet<number> = new Set([151, 166]);
const NO_ROAD_NEAR_CODE = 171;

/**
 * The square the server draws about a spot with no road near it reaches no further than this from
 * the spot (430 m was the most seen, for the longest contour it draws).
 */
const NOWHERE_REACH_METERS = 600;
/** Limits below these can honestly reach no further than that square, so they are taken at their word. */
const NOWHERE_MIN_MINUTES = 3;
const NOWHERE_MIN_KILOMETRES = 2;

/** A drive along real roads. */
export interface DrivenRoute {
  readonly meters: number;
  /** The server's estimate for a car, without traffic. */
  readonly seconds: number;
  /** The road taken, end to end. */
  readonly line: readonly LngLat[];
}

export type RouteAnswer =
  | { readonly kind: 'found'; readonly route: DrivenRoute }
  /** The two ends are not joined by road, or one of them is nowhere near one. */
  | { readonly kind: 'no-road' }
  /** Further than the server works out. */
  | { readonly kind: 'too-far' };

/** How much driving a reach is drawn for. */
export type ReachLimit =
  | { readonly by: 'time'; readonly minutes: number }
  | { readonly by: 'distance'; readonly kilometres: number };

export type ReachAnswer =
  | { readonly kind: 'found'; readonly outline: Outline }
  /** No road is near the spot, so there is nowhere to drive from it. */
  | { readonly kind: 'no-road' }
  /** More driving than the server draws a reach for. */
  | { readonly kind: 'beyond' };

export type RoutingFailure = 'network' | 'timeout' | 'http' | 'bad-response';

/** The routing server could not be reached or did not answer usefully. Everything else keeps working. */
export class RoutingUnavailableError extends Error {
  readonly reason: RoutingFailure;
  /** The HTTP status when `reason` is "http". */
  readonly status: number | undefined;

  constructor(reason: RoutingFailure, status?: number) {
    super(status === undefined ? `Routing unavailable (${reason})` : `Routing unavailable (HTTP ${status})`);
    this.name = 'RoutingUnavailableError';
    this.reason = reason;
    this.status = status;
  }
}

function rounded(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function location(at: LngLat): { lat: number; lon: number } {
  return { lat: rounded(at.lat, COORD_DIGITS), lon: rounded(at.lng, COORD_DIGITS) };
}

/** The key order is fixed so that a repeated question is answered by the browser's HTTP cache. */
function questionUrl(action: 'route' | 'isochrone', question: object): string {
  return `${VALHALLA_URL}/${action}?json=${encodeURIComponent(JSON.stringify(question))}`;
}

export function buildRouteUrl(from: LngLat, to: LngLat): string {
  return questionUrl('route', {
    locations: [location(from), location(to)],
    costing: 'auto',
    units: 'kilometers',
    directions_type: 'none',
  });
}

/** A limit as the server is asked for it: to a tenth, and never nothing at all. */
export function roundLimit(limit: ReachLimit): ReachLimit {
  const tidy = (value: number): number => Math.max(SMALLEST_LIMIT, rounded(value, LIMIT_DIGITS));
  return limit.by === 'time' ? { by: 'time', minutes: tidy(limit.minutes) } : { by: 'distance', kilometres: tidy(limit.kilometres) };
}

/** Whether a limit is more driving than the server draws a reach for. */
export function isBeyondReach(limit: ReachLimit): boolean {
  return limit.by === 'time' ? limit.minutes > REACH_MAX_MINUTES : limit.kilometres > REACH_MAX_KILOMETRES;
}

/**
 * `detailMeters` is how closely the contour follows the roads: bends smaller than that are cut off.
 * A contour of a long drive is tens of thousands of points unless it is told to be coarser.
 */
export function buildReachUrl(from: LngLat, limit: ReachLimit, detailMeters: number): string {
  const asked = roundLimit(limit);
  const generalize = Math.round(Math.min(DETAIL_RANGE_METERS.coarsest, Math.max(DETAIL_RANGE_METERS.finest, detailMeters)));
  return questionUrl('isochrone', {
    locations: [location(from)],
    costing: 'auto',
    contours: [asked.by === 'time' ? { time: asked.minutes } : { distance: asked.kilometres }],
    polygons: true,
    generalize,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A length or a time: a number that is not negative. */
function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Reads a route out of the server's answer, or null when the answer is not one. */
export function parseRoute(body: unknown): DrivenRoute | null {
  if (!isRecord(body) || !isRecord(body['trip'])) return null;
  const { summary, legs, units } = body['trip'];
  if (!isRecord(summary) || !Array.isArray(legs) || legs.length > MAX_ROUTE_LEGS) return null;
  const { length, time } = summary;
  // Kilometres were asked for; an answer in anything else is not an answer to the question.
  if (!isAmount(length) || !isAmount(time) || units !== 'kilometers') return null;
  const line: LngLat[] = [];
  for (const leg of legs) {
    // One point more than is left, because the first point of every leg after the first is dropped.
    const room = MAX_ROUTE_POINTS - line.length + (line.length > 0 ? 1 : 0);
    const shape = isRecord(leg) && typeof leg['shape'] === 'string' ? decodePolyline(leg['shape'], SHAPE_DIGITS, room) : null;
    if (!shape) return null;
    // Each leg starts where the one before it ended.
    for (let at = line.length > 0 ? 1 : 0; at < shape.length; at++) line.push(shape[at] as LngLat);
  }
  if (line.length < 2) return null;
  return { meters: length * 1000, seconds: time, line };
}

/** How many more corners a reach may have: shared by every ring of one answer. */
interface Budget {
  left: number;
}

function parseRing(value: unknown, budget: Budget): LngLat[] | null {
  if (!Array.isArray(value)) return null;
  // Refused before a single corner is read, so a ring that is too long costs no more than its length.
  budget.left -= value.length;
  if (budget.left < 0) return null;
  const ring: LngLat[] = [];
  for (const pair of value) {
    if (!Array.isArray(pair)) return null;
    const [lng, lat] = pair as unknown[];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null;
    ring.push({ lng, lat });
  }
  // Three corners and the first again: anything less encloses nothing.
  return ring.length >= 4 ? ring : null;
}

function parsePolygon(value: unknown, budget: Budget): LngLat[][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings: LngLat[][] = [];
  for (const candidate of value) {
    const ring = parseRing(candidate, budget);
    if (!ring) return null;
    rings.push(ring);
  }
  return rings;
}

/** Reads the one contour out of the server's answer, or null when the answer is not one. */
export function parseReach(body: unknown): Outline | null {
  if (!isRecord(body) || !Array.isArray(body['features'])) return null;
  // Every ring has at least four corners and every polygon at least one ring, so the corners bound them all.
  const budget: Budget = { left: MAX_REACH_POINTS };
  const outline: LngLat[][][] = [];
  for (const feature of body['features'] as unknown[]) {
    const geometry = isRecord(feature) ? feature['geometry'] : null;
    if (!isRecord(geometry)) return null;
    const { type, coordinates } = geometry;
    // Places that can only be reached over water come as areas of their own.
    const polygons: unknown[] = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' && Array.isArray(coordinates) ? coordinates : [];
    if (polygons.length === 0) return null;
    for (const candidate of polygons) {
      const polygon = parsePolygon(candidate, budget);
      if (!polygon) return null;
      outline.push(polygon);
    }
  }
  return outline.length > 0 ? outline : null;
}

/**
 * Whether an outline is the small square the server draws about a spot with no road near it, when
 * it was asked about enough driving to get out of that square from any road at all.
 */
export function reachesNowhere(outline: Outline, from: LngLat, limit: ReachLimit): boolean {
  const worthJudging = limit.by === 'time' ? limit.minutes >= NOWHERE_MIN_MINUTES : limit.kilometres >= NOWHERE_MIN_KILOMETRES;
  return worthJudging && outline.every((polygon) => polygon.every((ring) => ring.every((corner) => distanceMeters(from, corner) <= NOWHERE_REACH_METERS)));
}

/** What the server answered, whatever its status: a refusal is told apart by the code in its body. */
interface Answer {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

async function ask(url: string, signal: AbortSignal): Promise<Answer> {
  signal.throwIfAborted();
  const request = new AbortController();
  const cancel = (): void => request.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, ROUTING_TIMEOUT_MS);
  try {
    // No custom headers: the request stays CORS-simple, and the browser's Referer is how the server knows the site.
    const response = await fetch(url, { signal: request.signal });
    const body: unknown = await readJsonWithin(response, MAX_ANSWER_BYTES).catch(() => {
      // A refusal that cannot be read is still a refusal; an answer that cannot be read, or is far
      // longer than any real one, is no answer. An abort or a timeout is told apart below.
      if (response.ok) throw new RoutingUnavailableError('bad-response');
      return null;
    });
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timedOut) throw new RoutingUnavailableError('timeout');
    if (error instanceof RoutingUnavailableError) throw error;
    // A refused connection, a DNS failure, or being offline.
    throw new RoutingUnavailableError('network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/** The server's own code for why it refused, when it gave one. */
function refusalCode(answer: Answer): number | null {
  const code = isRecord(answer.body) ? answer.body['error_code'] : null;
  return typeof code === 'number' ? code : null;
}

function unavailable(answer: Answer, url: string): RoutingUnavailableError {
  // A 400 that is none of the refusals above means the question itself was wrong, which is a bug here.
  if (answer.status === 400) console.warn(`The routing server rejected the request: ${url}`);
  return new RoutingUnavailableError('http', answer.status);
}

/**
 * Asks for the drive between two spots. Resolves with the route, or with why there is none. Rejects
 * with `RoutingUnavailableError` when the server cannot be reached, answers with an error of its own
 * or stays silent for fifteen seconds, and with the signal's own abort reason when the caller aborts.
 */
export async function fetchRoute(from: LngLat, to: LngLat, signal: AbortSignal): Promise<RouteAnswer> {
  const url = buildRouteUrl(from, to);
  const answer = await ask(url, signal);
  if (!answer.ok) {
    const code = refusalCode(answer);
    if (code !== null && NO_ROAD_CODES.has(code)) return { kind: 'no-road' };
    if (code === TOO_FAR_CODE) return { kind: 'too-far' };
    throw unavailable(answer, url);
  }
  const route = parseRoute(answer.body);
  if (!route) throw new RoutingUnavailableError('bad-response');
  return { kind: 'found', route };
}

/**
 * Asks how far that much driving gets from a spot. Resolves with the outline of everywhere within
 * reach, or with why there is none; a limit beyond what the server draws is answered without asking
 * it. Rejects as `fetchRoute` does.
 */
export async function fetchReach(from: LngLat, limit: ReachLimit, detailMeters: number, signal: AbortSignal): Promise<ReachAnswer> {
  signal.throwIfAborted();
  const asked = roundLimit(limit);
  if (isBeyondReach(asked)) return { kind: 'beyond' };
  const url = buildReachUrl(from, asked, detailMeters);
  const answer = await ask(url, signal);
  if (!answer.ok) {
    const code = refusalCode(answer);
    if (code !== null && BEYOND_CODES.has(code)) return { kind: 'beyond' };
    if (code === NO_ROAD_NEAR_CODE) return { kind: 'no-road' };
    throw unavailable(answer, url);
  }
  const outline = parseReach(answer.body);
  if (!outline) throw new RoutingUnavailableError('bad-response');
  return reachesNowhere(outline, from, asked) ? { kind: 'no-road' } : { kind: 'found', outline };
}

/** The routing server as the app asks it; faked in tests. */
export interface RoadService {
  route(from: LngLat, to: LngLat, signal: AbortSignal): Promise<RouteAnswer>;
  reach(from: LngLat, limit: ReachLimit, detailMeters: number, signal: AbortSignal): Promise<ReachAnswer>;
}

export const valhalla: RoadService = { route: fetchRoute, reach: fetchReach };
