import { afterEach, describe, expect, it, vi } from 'vitest';
import { distanceMeters } from '../geo/distance';
import kingsCrossToHeathrow from './fixtures/kings-cross-to-heathrow.json';
import paloAltoToSanJose from './fixtures/palo-alto-to-san-jose.json';
import noRoadNear from './fixtures/probes/no-road-near.json';
import reachAtSea from './fixtures/probes/reach-at-sea.json';
import reachDistanceOverLimit from './fixtures/probes/reach-distance-over-limit.json';
import reachTimeOverLimit from './fixtures/probes/reach-time-over-limit.json';
import routeTooLong from './fixtures/probes/route-too-long.json';
import unconnected from './fixtures/probes/unconnected.json';
import reachByDistance from './fixtures/reach-london-by-distance.json';
import reachByTime from './fixtures/reach-london-by-time.json';
import {
  buildReachUrl,
  buildRouteUrl,
  fetchReach,
  fetchRoute,
  isBeyondReach,
  MAX_ANSWER_BYTES,
  MAX_REACH_POINTS,
  MAX_ROUTE_LEGS,
  MAX_ROUTE_POINTS,
  parseReach,
  parseRoute,
  reachesNowhere,
  REACH_MAX_KILOMETRES,
  REACH_MAX_MINUTES,
  roundLimit,
  ROUTING_TIMEOUT_MS,
  RoutingUnavailableError,
} from './valhalla';

const PALO_ALTO = { lat: 37.4419, lng: -122.143 };
const SAN_JOSE = { lat: 37.3382, lng: -121.8863 };
const KINGS_CROSS = { lat: 51.5308, lng: -0.1238 };
const HEATHROW = { lat: 51.47, lng: -0.4543 };
const LONDON = { lat: 51.5074, lng: -0.1278 };
const AT_SEA = { lat: 50, lng: -30 };

/** What the server is asked: the one `json` parameter, read back. */
const questionOf = (url: string): unknown => JSON.parse(new URL(url).searchParams.get('json') ?? 'null');

describe('buildRouteUrl', () => {
  it('builds exactly the requests the fixtures were saved from', () => {
    expect(buildRouteUrl(PALO_ALTO, SAN_JOSE)).toBe(paloAltoToSanJose.request);
    expect(buildRouteUrl(KINGS_CROSS, HEATHROW)).toBe(kingsCrossToHeathrow.request);
  });

  it('asks for a car, in kilometres, without the turn-by-turn instructions', () => {
    expect(questionOf(buildRouteUrl(PALO_ALTO, SAN_JOSE))).toEqual({
      locations: [
        { lat: 37.4419, lon: -122.143 },
        { lat: 37.3382, lon: -121.8863 },
      ],
      costing: 'auto',
      units: 'kilometers',
      directions_type: 'none',
    });
  });

  it('sends one parameter and nothing else', () => {
    expect([...new URL(buildRouteUrl(PALO_ALTO, SAN_JOSE)).searchParams.keys()]).toEqual(['json']);
  });

  it('sends positions as a link writes them, so a drive reopened from its link asks the same question', () => {
    const jittered = { lat: 37.441900004, lng: -122.143000004 };
    expect(buildRouteUrl(jittered, SAN_JOSE)).toBe(buildRouteUrl(PALO_ALTO, SAN_JOSE));
  });
});

describe('buildReachUrl', () => {
  it('builds exactly the requests the fixtures were saved from', () => {
    expect(buildReachUrl(LONDON, { by: 'time', minutes: 22.3 }, 140)).toBe(reachByTime.request);
    expect(buildReachUrl(LONDON, { by: 'distance', kilometres: 28 }, 140)).toBe(reachByDistance.request);
  });

  it('asks for one contour as a polygon, by time in minutes or by distance in kilometres', () => {
    expect(questionOf(buildReachUrl(LONDON, { by: 'time', minutes: 22.3 }, 140))).toEqual({
      locations: [{ lat: 51.5074, lon: -0.1278 }],
      costing: 'auto',
      contours: [{ time: 22.3 }],
      polygons: true,
      generalize: 140,
    });
    expect(questionOf(buildReachUrl(LONDON, { by: 'distance', kilometres: 28 }, 140))).toMatchObject({ contours: [{ distance: 28 }] });
  });

  it('asks to a tenth of a minute or of a kilometre, and never for nothing', () => {
    expect(roundLimit({ by: 'time', minutes: 22.30198 })).toEqual({ by: 'time', minutes: 22.3 });
    expect(roundLimit({ by: 'distance', kilometres: 27.963 })).toEqual({ by: 'distance', kilometres: 28 });
    expect(roundLimit({ by: 'time', minutes: 0.01 })).toEqual({ by: 'time', minutes: 0.1 });
    expect(roundLimit({ by: 'distance', kilometres: 0 })).toEqual({ by: 'distance', kilometres: 0.1 });
  });

  it('keeps the detail it asks for between 10 m and 250 m', () => {
    const generalize = (detail: number): unknown => (questionOf(buildReachUrl(LONDON, { by: 'time', minutes: 5 }, detail)) as { generalize: number }).generalize;
    expect(generalize(1)).toBe(10);
    expect(generalize(87.4)).toBe(87);
    expect(generalize(5000)).toBe(250);
  });
});

describe('parseRoute', () => {
  it('reads the length in metres, the time in seconds and the road taken', () => {
    const route = parseRoute(paloAltoToSanJose.body);
    expect(route?.meters).toBeCloseTo(27_963, 0);
    expect(route?.seconds).toBeCloseTo(1338.119, 3);
    expect(route?.line).toHaveLength(411);
    // It starts and ends on the roads nearest the two spots.
    expect(distanceMeters(route?.line[0] ?? LONDON, PALO_ALTO)).toBeLessThan(100);
    expect(distanceMeters(route?.line.at(-1) ?? LONDON, SAN_JOSE)).toBeLessThan(100);
  });

  it('joins the legs of a route into one line without repeating the point they share', () => {
    const [leg] = kingsCrossToHeathrow.body.trip.legs;
    const twice = { trip: { ...kingsCrossToHeathrow.body.trip, legs: [leg, leg] } };
    const once = parseRoute(kingsCrossToHeathrow.body)?.line.length ?? 0;
    expect(parseRoute(twice)?.line).toHaveLength(2 * once - 1);
  });

  it('refuses anything that is not a route', () => {
    const { trip } = paloAltoToSanJose.body;
    expect(parseRoute(null)).toBeNull();
    expect(parseRoute({})).toBeNull();
    expect(parseRoute({ trip: { ...trip, legs: [] } })).toBeNull();
    expect(parseRoute({ trip: { ...trip, legs: [{ shape: 7 }] } })).toBeNull();
    expect(parseRoute({ trip: { ...trip, legs: [{ shape: 'not a shape' }] } })).toBeNull();
    expect(parseRoute({ trip: { ...trip, summary: { time: 'soon', length: 3 } } })).toBeNull();
    expect(parseRoute({ trip: { ...trip, summary: { time: 60, length: -1 } } })).toBeNull();
  });

  it('refuses an answer that is not in the kilometres that were asked for', () => {
    expect(parseRoute({ trip: { ...paloAltoToSanJose.body.trip, units: 'miles' } })).toBeNull();
  });

  /** A route of `points` points, all at the same spot: two characters each. */
  const standingStill = (legs: readonly number[]): unknown => ({
    trip: { summary: { length: 1, time: 1 }, units: 'kilometers', legs: legs.map((points) => ({ shape: '??'.repeat(points) })) },
  });

  it('refuses a route of more points than any real drive has, without failing', () => {
    // The probe from the security audit: 200,000 points in one leg once threw a RangeError.
    expect(() => parseRoute(standingStill([200_000]))).not.toThrow();
    expect(parseRoute(standingStill([200_000]))).toBeNull();
    expect(parseRoute(standingStill([MAX_ROUTE_POINTS + 1]))).toBeNull();
    expect(parseRoute(standingStill([MAX_ROUTE_POINTS]))?.line).toHaveLength(MAX_ROUTE_POINTS);
  });

  it('counts the points of every leg together, less the ones they share', () => {
    const half = MAX_ROUTE_POINTS / 2;
    expect(parseRoute(standingStill([half, half + 1]))?.line).toHaveLength(MAX_ROUTE_POINTS);
    expect(parseRoute(standingStill([half, half + 2]))).toBeNull();
  });

  it('refuses a route of more legs than a drive between two spots has', () => {
    expect(parseRoute(standingStill(Array.from({ length: MAX_ROUTE_LEGS }, () => 2)))).not.toBeNull();
    expect(parseRoute(standingStill(Array.from({ length: MAX_ROUTE_LEGS + 1 }, () => 2)))).toBeNull();
  });
});

describe('parseReach', () => {
  it('reads the contour as one area: an outer ring that closes on itself', () => {
    const outline = parseReach(reachByTime.body);
    expect(outline).toHaveLength(1);
    const ring = outline?.[0]?.[0] ?? [];
    expect(ring.length).toBeGreaterThan(50);
    expect(ring[0]).toEqual(ring.at(-1));
    // Twenty-two minutes of driving from the middle of London gets a few miles out, and no further.
    const furthest = Math.max(...ring.map((corner) => distanceMeters(LONDON, corner)));
    expect(furthest).toBeGreaterThan(5_000);
    expect(furthest).toBeLessThan(30_000);
  });

  it('reads several areas, holes and all', () => {
    const ring = [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ];
    const body = { features: [{ geometry: { type: 'MultiPolygon', coordinates: [[ring, ring], [ring]] } }] };
    const outline = parseReach(body);
    expect(outline?.map((polygon) => polygon.length)).toEqual([2, 1]);
    expect(outline?.[0]?.[0]?.[1]).toEqual({ lng: 0, lat: 1 });
  });

  it('refuses anything that is not a contour', () => {
    const ring = [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ];
    const polygon = (coordinates: unknown): unknown => ({ features: [{ geometry: { type: 'Polygon', coordinates } }] });
    expect(parseReach(null)).toBeNull();
    expect(parseReach({ features: [] })).toBeNull();
    expect(parseReach({ features: [{ geometry: { type: 'LineString', coordinates: ring } }] })).toBeNull();
    expect(parseReach(polygon([]))).toBeNull();
    expect(parseReach(polygon([ring.slice(0, 3)]))).toBeNull();
    expect(parseReach(polygon([[...ring, [0, 91]]]))).toBeNull();
    expect(parseReach(polygon([[...ring, ['0', 0]]]))).toBeNull();
    expect(parseReach(polygon([ring]))).not.toBeNull();
  });

  /** A closed ring of `corners` corners about the spot 0, 0. */
  const ringOf = (corners: number): number[][] =>
    Array.from({ length: corners }, (_, at) => {
      const angle = (2 * Math.PI * (at % (corners - 1))) / (corners - 1);
      return [Math.cos(angle) / 100, Math.sin(angle) / 100];
    });
  const contour = (...rings: number[][][]): unknown => ({ features: [{ geometry: { type: 'Polygon', coordinates: rings } }] });

  it('refuses a contour of more corners than any real reach has', () => {
    // The probe from the security audit: one ring of 200,000 corners was accepted.
    expect(parseReach(contour(ringOf(200_000)))).toBeNull();
    expect(parseReach(contour(ringOf(MAX_REACH_POINTS + 1)))).toBeNull();
    expect(parseReach(contour(ringOf(MAX_REACH_POINTS)))?.[0]?.[0]).toHaveLength(MAX_REACH_POINTS);
  });

  it('counts the corners of every ring, polygon and feature together', () => {
    const half = ringOf(MAX_REACH_POINTS / 2);
    expect(parseReach(contour(half, half))).not.toBeNull();
    expect(parseReach(contour(half, half, ringOf(4)))).toBeNull();
    const feature = { geometry: { type: 'MultiPolygon', coordinates: [[half]] } };
    expect(parseReach({ features: [feature, feature] })).not.toBeNull();
    expect(parseReach({ features: [feature, feature, feature] })).toBeNull();
  });
});

describe('reachesNowhere', () => {
  const squareAtSea = parseReach(reachAtSea.body) ?? [];

  it('knows the small square the server draws about a spot with no road near it', () => {
    expect(reachesNowhere(squareAtSea, AT_SEA, { by: 'time', minutes: 22.3 })).toBe(true);
    expect(reachesNowhere(squareAtSea, AT_SEA, { by: 'distance', kilometres: 28 })).toBe(true);
  });

  it('takes a real reach at its word', () => {
    expect(reachesNowhere(parseReach(reachByTime.body) ?? [], LONDON, { by: 'time', minutes: 22.3 })).toBe(false);
  });

  it('takes a small reach at its word when little driving was asked about', () => {
    expect(reachesNowhere(squareAtSea, AT_SEA, { by: 'time', minutes: 1 })).toBe(false);
    expect(reachesNowhere(squareAtSea, AT_SEA, { by: 'distance', kilometres: 0.5 })).toBe(false);
  });
});

describe('asking the server', () => {
  const never = new AbortController().signal;
  const answer = (saved: { body: unknown; status: number }): Response => new Response(JSON.stringify(saved.body), { status: saved.status });
  const hangUntilAborted = (_url: string, init: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('fetchRoute', () => {
    it('asks once, with no custom headers, and returns the route', async () => {
      const fetchMock = vi.fn(async () => answer(paloAltoToSanJose));
      vi.stubGlobal('fetch', fetchMock);
      const found = await fetchRoute(PALO_ALTO, SAN_JOSE, never);
      expect(found).toEqual({ kind: 'found', route: parseRoute(paloAltoToSanJose.body) });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(paloAltoToSanJose.request);
      expect(Object.keys(init)).toEqual(['signal']);
    });

    it('answers "no road" when the two ends are not joined by road, or one is nowhere near a road', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => answer(unconnected)));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).resolves.toEqual({ kind: 'no-road' });
      vi.stubGlobal('fetch', vi.fn(async () => answer(noRoadNear)));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).resolves.toEqual({ kind: 'no-road' });
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 400, body: { error_code: 442, error: 'No path could be found for input' } })));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).resolves.toEqual({ kind: 'no-road' });
    });

    it('answers "too far" for a drive longer than the server works out', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => answer(routeTooLong)));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).resolves.toEqual({ kind: 'too-far' });
    });

    it('rejects, with a warning, when the server calls the request itself malformed', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 400, body: { error_code: 100, error: 'Failed to parse json request' } })));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason: 'http', status: 400 });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('rejects on an HTTP error, whether or not its body can be read', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 429, body: { error: 'Too many requests' } })));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ reason: 'http', status: 429 });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
      const failure = await fetchRoute(PALO_ALTO, SAN_JOSE, never).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RoutingUnavailableError);
      expect(failure).toMatchObject({ reason: 'http', status: 502 });
    });

    it('rejects when the network fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason: 'network' });
    });

    it('rejects when the answer is not what the server sends', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Welcome</html>', { status: 200 })));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ reason: 'bad-response' });
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 200, body: { trip: { legs: 'none' } } })));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ reason: 'bad-response' });
    });

    it('gives up after fifteen seconds of silence', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(hangUntilAborted);
      vi.stubGlobal('fetch', fetchMock);
      const outcome = fetchRoute(PALO_ALTO, SAN_JOSE, never).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(ROUTING_TIMEOUT_MS - 1);
      expect((fetchMock.mock.calls[0]?.[1].signal as AbortSignal).aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatchObject({ name: 'RoutingUnavailableError', reason: 'timeout' });
      expect(ROUTING_TIMEOUT_MS).toBe(15_000);
    });

    it('passes the caller’s abort through as an abort, not as "unavailable"', async () => {
      vi.stubGlobal('fetch', vi.fn(hangUntilAborted));
      const asking = new AbortController();
      const outcome = fetchRoute(PALO_ALTO, SAN_JOSE, asking.signal).catch((error: unknown) => error);
      asking.abort();
      const failure = await outcome;
      expect(failure).not.toBeInstanceOf(RoutingUnavailableError);
      expect(failure).toMatchObject({ name: 'AbortError' });
    });

    it('does not start a request for a signal that is already aborted', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an answer far longer than any real route while it arrives, with or without its length', async () => {
      const kilobyte = new TextEncoder().encode(' '.repeat(1024));
      let sent = 0;
      const endless = (): Response =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              sent += kilobyte.byteLength;
              controller.enqueue(kilobyte);
            },
          }),
          { status: 200 },
        );
      vi.stubGlobal('fetch', vi.fn(async () => endless()));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason: 'bad-response' });
      // It stopped soon after the limit instead of reading on for ever.
      expect(sent).toBeLessThan(MAX_ANSWER_BYTES + 64 * 1024);
      const declared = new Response('{}', { status: 200, headers: { 'content-length': String(MAX_ANSWER_BYTES + 1) } });
      vi.stubGlobal('fetch', vi.fn(async () => declared));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ reason: 'bad-response' });
    });

    it('rejects the audit’s route of 200,000 points as a bad answer', async () => {
      const body = { trip: { summary: { length: 1, time: 1 }, units: 'kilometers', legs: [{ shape: '??'.repeat(200_000) }] } };
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 200, body })));
      await expect(fetchRoute(PALO_ALTO, SAN_JOSE, never)).rejects.toMatchObject({ name: 'RoutingUnavailableError', reason: 'bad-response' });
    });
  });

  describe('fetchReach', () => {
    it('asks once and returns the outline', async () => {
      const fetchMock = vi.fn(async () => answer(reachByDistance));
      vi.stubGlobal('fetch', fetchMock);
      const found = await fetchReach(LONDON, { by: 'distance', kilometres: 27.963 }, 140, never);
      expect(found).toEqual({ kind: 'found', outline: parseReach(reachByDistance.body) });
      expect(fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([reachByDistance.request]);
    });

    it('answers "beyond" without asking, for more driving than the server draws a reach for', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(fetchReach(LONDON, { by: 'time', minutes: 60.1 }, 250, never)).resolves.toEqual({ kind: 'beyond' });
      await expect(fetchReach(LONDON, { by: 'distance', kilometres: 100.1 }, 250, never)).resolves.toEqual({ kind: 'beyond' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(isBeyondReach({ by: 'time', minutes: REACH_MAX_MINUTES })).toBe(false);
      expect(isBeyondReach({ by: 'distance', kilometres: REACH_MAX_KILOMETRES })).toBe(false);
    });

    it('asks for a drive that rounds to the limit: an hour and two seconds is an hour', async () => {
      const fetchMock = vi.fn(async () => answer(reachByTime));
      vi.stubGlobal('fetch', fetchMock);
      await expect(fetchReach(LONDON, { by: 'time', minutes: 60.04 }, 250, never)).resolves.toMatchObject({ kind: 'found' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('answers "beyond" when the server itself says the contour is past its limit', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => answer(reachTimeOverLimit)));
      await expect(fetchReach(LONDON, { by: 'time', minutes: 50 }, 250, never)).resolves.toEqual({ kind: 'beyond' });
      vi.stubGlobal('fetch', vi.fn(async () => answer(reachDistanceOverLimit)));
      await expect(fetchReach(LONDON, { by: 'distance', kilometres: 90 }, 250, never)).resolves.toEqual({ kind: 'beyond' });
    });

    it('answers "no road" for a spot with no road near it, however the server puts it', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => answer(reachAtSea)));
      await expect(fetchReach(AT_SEA, { by: 'time', minutes: 22.3 }, 140, never)).resolves.toEqual({ kind: 'no-road' });
      vi.stubGlobal('fetch', vi.fn(async () => answer(noRoadNear)));
      await expect(fetchReach(AT_SEA, { by: 'time', minutes: 22.3 }, 140, never)).resolves.toEqual({ kind: 'no-road' });
    });

    it('rejects when the server fails or its answer is no contour', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 503, body: { error: 'overloaded' } })));
      await expect(fetchReach(LONDON, { by: 'time', minutes: 20 }, 140, never)).rejects.toMatchObject({ reason: 'http', status: 503 });
      vi.stubGlobal('fetch', vi.fn(async () => answer({ status: 200, body: { features: [] } })));
      await expect(fetchReach(LONDON, { by: 'time', minutes: 20 }, 140, never)).rejects.toMatchObject({ reason: 'bad-response' });
    });

    it('passes the caller’s abort through as an abort', async () => {
      vi.stubGlobal('fetch', vi.fn(hangUntilAborted));
      const asking = new AbortController();
      const outcome = fetchReach(LONDON, { by: 'time', minutes: 20 }, 140, asking.signal).catch((error: unknown) => error);
      asking.abort();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
    });
  });
});
