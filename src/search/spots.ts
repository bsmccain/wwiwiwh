import { tidyName } from '../app/spots';
import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import {
  COORD_DIGITS,
  FETCH_LIMIT,
  fetchFeatures,
  identityOf,
  MAX_LATITUDE,
  MAX_RESULTS,
  MIN_QUERY_LENGTH,
  PHOTON_SEARCH_URL,
  type PhotonFeature,
  type PhotonProperties,
  type PhotonResponse,
} from './photon';
import type { RemoteSearchDeps } from './remote-search';
import { cleanQuery, fold } from './text';

/*
 * Spot search: an address, a street, a station, a landmark, a shop, a neighbourhood or a postcode in
 * or near a place, on the same public Photon server as the place search (photon.ts has the rules that
 * hold for both). Checked against the live server on 2026-11-12; the answers are under fixtures/
 * (spot-*.json and probes/):
 *  - without `include`, everything that has a name or a house number can match;
 *  - a postcode typed on its own is answered with the postcode itself, as a thing with a name and a
 *    point but no OSM id;
 *  - `bbox` is minLon,minLat,maxLon,maxLat and nothing outside it is returned. Latitude first is not an
 *    error, just another box;
 *  - `lat` and `lon` pull the order towards a point and are accepted next to `bbox`. So are `zoom` and
 *    `location_bias_scale`, which changed nothing in the answers tried and are left to the server;
 *  - the order that comes back already weighs how well a name matches, how well known the thing is and
 *    how near it is, and it finds things by names it does not return (other languages, nicknames). It
 *    is kept; see `normaliseSpots` for the two exceptions.
 */

export interface SpotHit {
  readonly name: string;
  /** What tells this spot from another of the same name: its street or district, then its town. */
  readonly context: string;
  readonly position: LngLat;
  readonly kind: 'address' | 'street' | 'landmark' | 'area';
}

/** How far from a place's centre a spot can be and still count as in or near it. */
export const SURROUNDINGS_METERS = 150_000;
/** Of latitude. Good enough to draw a box with; the distance itself is measured properly afterwards. */
const METERS_PER_DEGREE = 111_320;
const DEG = Math.PI / 180;

/** The point the order is pulled towards is sent to about ten metres: finer would only split the cache. */
const BIAS_DIGITS = 4;

/** One more than the place search waits for: the two letters a slow typist pauses on match streets all over a city. */
const MIN_SPOT_QUERY_LENGTH = 3;
/** Scripts that write a syllable or a word with each character, in which two characters are a name already (渋谷). */
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Whether enough has been typed for a spot search to be worth a request. Expects the query cleaned. */
export function isWorthAsking(query: string): boolean {
  const length = Array.from(query).length;
  return length >= MIN_SPOT_QUERY_LENGTH || (length >= MIN_QUERY_LENGTH && DENSE_SCRIPT.test(query));
}

/**
 * How a spot search behaves while it is typed. It waits longer than the place search does: an address
 * is a longer thing to type, a pause in the middle of it is not its end, and the list of both maps
 * sends two requests for every pause.
 */
export const SPOT_SEARCH_MANNERS = {
  worthAsking: isWorthAsking,
  quietMs: 400,
} as const satisfies Pick<RemoteSearchDeps<unknown>, 'worthAsking' | 'quietMs'>;

const roundTo = (degrees: number, digits: number): number => Number(degrees.toFixed(digits));

/** Things of one name this close together are one spot: a station, its entrances and the stops outside. */
const SAME_THING_METERS = 300;
/** A street or a bridge comes back in pieces, each with its own point. */
const SAME_STREET_METERS = 2000;

/** The box that holds everything within reach of a place: west, south, east, north. */
function boxAround(around: LngLat): string {
  const reachLat = SURROUNDINGS_METERS / METERS_PER_DEGREE;
  const reachLng = reachLat / Math.cos(Math.min(Math.abs(around.lat), MAX_LATITUDE) * DEG);
  const box = [
    Math.max(-180, around.lng - reachLng),
    Math.max(-90, around.lat - reachLat),
    Math.min(180, around.lng + reachLng),
    Math.min(90, around.lat + reachLat),
  ];
  return box.map((degrees) => degrees.toFixed(3)).join(',');
}

/** As in photon.ts, the parameters and their order are fixed: an unknown one is an HTTP 400, and a stable address is cached. */
export function buildSpotSearchUrl(query: string, around: LngLat): string {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('lang', 'en');
  params.set('limit', String(FETCH_LIMIT));
  params.set('lat', String(roundTo(around.lat, BIAS_DIGITS)));
  params.set('lon', String(roundTo(around.lng, BIAS_DIGITS)));
  params.set('bbox', boxAround(around));
  return `${PHOTON_SEARCH_URL}?${params.toString()}`;
}

/**
 * Countries that write the house number before the street ("10 Downing Street"): the English-speaking
 * world, France and the countries that took their addresses from either. Everywhere else the street
 * comes first ("Friedrichstraße 43").
 */
const NUMBER_FIRST = new Set(
  'US CA GB IE AU NZ FR LU MC MT IN PK BD LK SG MY PH TH VN HK ZA NG GH KE UG TZ ZW EG MA DZ TN SN CI JM TT'.split(' '),
);

/**
 * Things that only borrow the name of what they serve or lead to, or that are not built. Sometimes
 * nothing else carries the name (a bus stop called after a crossing), so they are kept, at the end.
 */
const LESSER = new Set([
  'highway=bus_stop',
  'highway=platform',
  'highway=motorway_junction',
  'railway=stop',
  'railway=platform',
  'railway=subway_entrance',
  'railway=train_station_entrance',
  'railway=proposed',
  'railway=construction',
  'railway=disused',
  'railway=abandoned',
  'public_transport=stop_position',
  'public_transport=platform',
]);

const AREA_LAYERS = new Set(['locality', 'district', 'city', 'county', 'state', 'country']);

interface Candidate {
  readonly identity: string;
  readonly properties: PhotonProperties;
  readonly name: string;
  readonly foldedName: string;
  readonly kind: SpotHit['kind'];
  readonly position: LngLat;
  /** From the place being searched in. */
  readonly metersAway: number;
  /** Comes back in pieces along its length. */
  readonly linear: boolean;
  readonly lesser: boolean;
}

function addressLine(properties: PhotonProperties): string | null {
  const { housenumber, street } = properties;
  if (!housenumber || !street) return null;
  return NUMBER_FIRST.has(properties.countrycode ?? '') ? `${housenumber} ${street}` : `${street} ${housenumber}`;
}

/** Photon files a postcode under no layer of its own, but it is an area like the others: a few streets, or a town. */
function isPostcode(properties: PhotonProperties): boolean {
  return properties.osm_key === 'place' && properties.osm_value === 'postcode';
}

function kindOf(properties: PhotonProperties, hasOwnName: boolean): SpotHit['kind'] {
  if (properties.type === 'street') return 'street';
  if (AREA_LAYERS.has(properties.type) || isPostcode(properties)) return 'area';
  return hasOwnName ? 'landmark' : 'address';
}

function isLinear(properties: PhotonProperties): boolean {
  return (
    properties.type === 'street' ||
    properties.osm_key === 'bridge' ||
    properties.osm_key === 'tunnel' ||
    properties.osm_value === 'bridge'
  );
}

/** Null for a feature with nothing to call it by, with a point that cannot be drawn, or out of reach of the place. */
function toCandidate(feature: PhotonFeature, around: LngLat): Candidate | null {
  const properties = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const ownName = tidyName(properties.name ?? '');
  const name = ownName || tidyName(addressLine(properties) ?? '');
  if (!name || Math.abs(lat) > MAX_LATITUDE || Math.abs(lng) > 180) return null;
  const position = { lng: roundTo(lng, COORD_DIGITS), lat: roundTo(lat, COORD_DIGITS) };
  const metersAway = distanceMeters(around, position);
  if (metersAway > SURROUNDINGS_METERS) return null;
  return {
    identity: identityOf(feature),
    properties,
    name,
    foldedName: fold(name),
    kind: kindOf(properties, ownName !== ''),
    position,
    metersAway,
    linear: isLinear(properties),
    lesser: LESSER.has(`${properties.osm_key}=${properties.osm_value}`),
  };
}

/** Photon lists one OSM object twice when it files it under two layers (a bridge as a road and as a structure). */
function withoutRepeats(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((candidate, index) => candidates.findIndex((other) => other.identity === candidate.identity) === index);
}

function isSameThing(group: readonly Candidate[], candidate: Candidate): boolean {
  if (group[0]?.foldedName !== candidate.foldedName) return false;
  return group.some((member) => {
    const apart = distanceMeters(member.position, candidate.position);
    return apart <= SAME_THING_METERS || (member.linear && candidate.linear && apart <= SAME_STREET_METERS);
  });
}

/**
 * Gathers what is one thing to the person choosing: the pieces of a street, and things of the same
 * name that stand together. Each group begins with its best-placed member, and the groups stay in the
 * order of those.
 */
function gather(candidates: readonly Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const candidate of candidates) {
    const [home, ...joined] = groups.filter((group) => isSameThing(group, candidate));
    if (!home) {
      groups.push([candidate]);
      continue;
    }
    home.push(candidate);
    // A piece that lies between two groups shows them to be one street.
    for (const other of joined) {
      home.push(...other);
      groups.splice(groups.indexOf(other), 1);
    }
  }
  return groups;
}

/**
 * One row for a group: its first member, or for a street in pieces the piece nearest the middle of
 * the stretch they cover (not their average, which leans to the end that is cut finer). The row is
 * that one piece in everything it says (name, district, town, point), so that a street that runs
 * through two towns is never named after one and placed in the other.
 */
function standFor(group: readonly Candidate[]): Candidate[] {
  const [lead] = group;
  if (!lead) return [];
  const pieces = group.filter((member) => member.linear);
  if (!lead.linear || pieces.length < 2) return [lead];
  const midway = (along: 'lng' | 'lat'): number => {
    const degrees = pieces.map((piece) => piece.position[along]);
    return (Math.min(...degrees) + Math.max(...degrees)) / 2;
  };
  const middle = { lng: midway('lng'), lat: midway('lat') };
  return [pieces.reduce((best, piece) => (distanceMeters(piece.position, middle) < distanceMeters(best.position, middle) ? piece : best))];
}

/** Among things of one name and one kind there is nothing to choose by but distance: the nearer takes the higher slot. */
function nearerNamesakesFirst(rows: readonly Candidate[]): Candidate[] {
  const slotsByName = new Map<string, number[]>();
  rows.forEach((row, slot) => {
    const key = `${row.kind}|${row.lesser}|${row.foldedName}`;
    slotsByName.set(key, [...(slotsByName.get(key) ?? []), slot]);
  });
  const ordered = [...rows];
  for (const slots of slotsByName.values()) {
    const nearestFirst = slots.flatMap((slot) => rows[slot] ?? []).sort((a, b) => a.metersAway - b.metersAway);
    slots.forEach((slot, rank) => {
      const row = nearestFirst[rank];
      if (row) ordered[slot] = row;
    });
  }
  return ordered;
}

/** The town a spot is in, or for a town the state it is in. */
function townOf(properties: PhotonProperties): string | undefined {
  const { city, county, state, country } = properties;
  if (properties.type === 'city' || properties.type === 'county') return state ?? country;
  if (properties.type === 'state') return country;
  return city ?? county ?? state ?? country;
}

interface Whereabouts {
  /** What the spot stands on or in: its address when it has one of its own, otherwise its district. */
  readonly usual: string | undefined;
  /** Something finer, for when two rows would otherwise read the same. */
  readonly closer: string | undefined;
}

function whereaboutsOf(candidate: Candidate): Whereabouts {
  const properties = candidate.properties;
  const town = fold(townOf(properties) ?? '');
  const tells = (part: string | null | undefined): part is string =>
    !!part && fold(part) !== candidate.foldedName && fold(part) !== town;
  const isLandmark = candidate.kind === 'landmark';
  const [usual, ...others] = [isLandmark ? addressLine(properties) : null, properties.district, properties.locality].filter(tells);
  // Without a house number, the street Photon gives is only the nearest one, so it is a last resort.
  const finer = [...others, isLandmark ? properties.street : null].filter(tells);
  return { usual, closer: finer.find((part) => !usual || !fold(usual).includes(fold(part))) };
}

function contextOf(candidate: Candidate, standsOn: string | undefined): string {
  return [standsOn, townOf(candidate.properties)]
    .filter((part) => part && fold(part) !== candidate.foldedName)
    .join(', ');
}

interface Row {
  readonly candidate: Candidate;
  readonly closer: string | undefined;
  context: string;
}

const readsLike = (a: Row, b: Row): boolean => a.candidate.foldedName === b.candidate.foldedName && a.context === b.context;

/** Rows that read the same are told apart by something finer; where nothing does, one of them is enough. */
function tellApart(rows: readonly Row[]): Row[] {
  const clashing = rows.filter((row) => rows.some((other) => other !== row && readsLike(other, row)));
  for (const row of clashing) {
    if (row.closer) row.context = contextOf(row.candidate, row.closer);
  }
  return rows.filter((row, index) => !rows.slice(0, index).some((earlier) => readsLike(earlier, row)));
}

/**
 * Turns a Photon answer into the rows to show. The server's order is kept, with two exceptions: things
 * that only borrow a name (stops, entrances) go last, and namesakes are listed nearest first.
 */
export function normaliseSpots(response: PhotonResponse, around: LngLat, limit: number = MAX_RESULTS): SpotHit[] {
  const candidates = withoutRepeats(response.features.flatMap((feature) => toCandidate(feature, around) ?? []));
  const best = [...candidates.filter((candidate) => !candidate.lesser), ...candidates.filter((candidate) => candidate.lesser)];
  const rows = nearerNamesakesFirst(gather(best).flatMap(standFor)).map((candidate): Row => {
    const { usual, closer } = whereaboutsOf(candidate);
    return { candidate, closer, context: contextOf(candidate, usual) };
  });
  return tellApart(rows)
    .slice(0, limit)
    .map(({ candidate, context }) => ({ name: candidate.name, context, position: candidate.position, kind: candidate.kind }));
}

/**
 * Looks up a spot in or near a place: `around` is the place's centre. Resolves with at most six cleaned
 * rows, or with none when nothing matches or too little was typed to ask about. Rejects as
 * `fetchFeatures` does.
 */
export async function searchSpots(query: string, around: LngLat, signal: AbortSignal): Promise<SpotHit[]> {
  const text = cleanQuery(query);
  if (!isWorthAsking(text)) return [];
  signal.throwIfAborted();
  return normaliseSpots({ features: await fetchFeatures(buildSpotSearchUrl(text, around), signal) }, around);
}

/**
 * Looks the same words up in and near two places at once, and answers for them in the order given.
 * The server that fails one request is the one the other is waiting on, so a failure of either is the
 * answer for both, and the other request is not left running.
 */
export async function searchSpotsInBoth(
  query: string,
  around: readonly [LngLat, LngLat],
  signal: AbortSignal,
): Promise<[SpotHit[], SpotHit[]]> {
  signal.throwIfAborted();
  const requests = new AbortController();
  const cancel = (): void => requests.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await Promise.all([searchSpots(query, around[0], requests.signal), searchSpots(query, around[1], requests.signal)]);
  } catch (error) {
    requests.abort();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
