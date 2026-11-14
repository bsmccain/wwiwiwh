import type { Place } from '../app/types';
import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { readJsonWithin } from '../net/read-json';
import { SAME_PLACE_METERS } from './place';
import { cleanQuery, fold } from './text';

/*
 * Place search on the public Photon server (https://photon.komoot.io), which is free and promises nothing.
 * Every rule below was checked against the live server on 2026-11-11:
 *  - any parameter the server does not know is an HTTP 400, so nothing may be appended to the URL;
 *  - `lang` must be sent, because without it the browser's language decides the names and the ranking;
 *  - ONE `include` holding a comma list keeps a hit that has any of the tags (repeating the parameter
 *    would require all of them, which nothing has);
 *  - no location bias: people search for places far from what they are looking at.
 */

export const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';

/** Settlements, regions and administrative areas. Leaves out shops, streets, parks, fire and council districts. */
const PLACE_TAGS = [
  'osm.place',
  'osm.boundary.administrative',
  'osm.boundary.region',
  'osm.boundary.local_authority',
  'osm.boundary.ceremonial',
  'osm.boundary.census',
].join(',');

export const MIN_QUERY_LENGTH = 2;
export const SEARCH_TIMEOUT_MS = 8000;
/** Ask for more than is shown: duplicates and junk kinds take up to six of fifteen rows. */
export const FETCH_LIMIT = 15;
export const MAX_RESULTS = 6;
/**
 * An answer with more features than this is not an answer to the question asked: the server keeps to
 * `limit`. The room above it is for a server that rounds up, not for one that ignores the limit.
 */
export const MAX_FEATURES = FETCH_LIMIT * 2;
/** A real answer of fifteen features is a few kilobytes; one longer than this is refused while it arrives. */
export const MAX_ANSWER_BYTES = 256 * 1024;
/** OpenStreetMap caps a tag's value at 255 characters, which is up to 510 UTF-16 code units. */
export const MAX_TEXT_LENGTH = 510;

/** The parameter order is fixed so that a repeated query is answered by the browser's HTTP cache (the server allows an hour). */
export function buildSearchUrl(query: string): string {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('lang', 'en');
  params.set('limit', String(FETCH_LIMIT));
  params.set('include', PLACE_TAGS);
  return `${PHOTON_SEARCH_URL}?${params.toString()}`;
}

export type SearchFailure = 'network' | 'timeout' | 'http' | 'bad-response';

/** Photon could not be reached or did not answer usefully. Presets keep working. */
export class SearchUnavailableError extends Error {
  readonly reason: SearchFailure;
  /** The HTTP status when `reason` is "http". */
  readonly status: number | undefined;

  constructor(reason: SearchFailure, status?: number) {
    super(status === undefined ? `Search unavailable (${reason})` : `Search unavailable (HTTP ${status})`);
    this.name = 'SearchUnavailableError';
    this.reason = reason;
    this.status = status;
  }
}

/** The fields of a Photon feature that the pickers read. The server sends a few more. */
export interface PhotonProperties {
  /** Both are left out for what is no OSM object of its own: a postcode, which the server puts at the middle of its addresses. */
  readonly osm_type?: string;
  readonly osm_id?: number;
  /** Main OSM tag, for example place=city or boundary=administrative. */
  readonly osm_key: string;
  readonly osm_value: string;
  /** Photon's layer: house, street, locality, district, city, county, state, country or other. */
  readonly type: string;
  readonly name?: string;
  readonly housenumber?: string;
  /** For a house, the street of its address when it has a number, and otherwise the street nearest to it. */
  readonly street?: string;
  /** The neighbourhood and the suburb it lies in. */
  readonly locality?: string;
  readonly district?: string;
  readonly postcode?: string;
  readonly city?: string;
  readonly county?: string;
  readonly state?: string;
  readonly country?: string;
  /** Upper-case ISO 3166-1 alpha-2. */
  readonly countrycode?: string;
}

export interface PhotonFeature {
  readonly properties: PhotonProperties;
  readonly geometry: { readonly coordinates: readonly [lng: number, lat: number] };
}

export interface PhotonResponse {
  readonly features: readonly PhotonFeature[];
}

/**
 * What tells one thing in an answer from another: Photon lists an OSM object twice when it files it
 * under two layers. A thing that is no OSM object is known by its tag, its name and its point.
 */
export function identityOf({ properties, geometry }: PhotonFeature): string {
  const { osm_type: type, osm_id: id } = properties;
  if (type !== undefined && id !== undefined) return `${type}${id}`;
  return [properties.osm_key, properties.osm_value, properties.name ?? '', ...geometry.coordinates].join('|');
}

type PlaceKind = 'country' | 'state' | 'county' | 'city' | 'district' | 'locality' | 'region' | 'other';

interface Hit {
  readonly identity: string;
  readonly name: string;
  readonly foldedName: string;
  readonly kind: PlaceKind;
  readonly center: LngLat;
  readonly properties: PhotonProperties;
  context: string;
}

const KEPT_BOUNDARIES = new Set(['administrative', 'region', 'local_authority', 'ceremonial', 'census']);
const DROPPED_PLACES = new Set([
  // A postcode is a spot of a place (spots.ts lists it), not a place to lay over another.
  'postcode',
  'house',
  'farm',
  'isolated_dwelling',
  'square',
  'islet',
  'plot',
  'block',
  'city_block',
  'allotments',
]);
/** Web Mercator ends here; a place further north or south cannot be drawn. */
export const MAX_LATITUDE = 85;
/** About a metre. */
export const COORD_DIGITS = 5;

function isMappablePlace(properties: PhotonProperties, center: LngLat): boolean {
  if (!properties.name || Math.abs(center.lat) > MAX_LATITUDE) return false;
  if (properties.type === 'house' || properties.type === 'street') return false;
  if (properties.osm_key === 'boundary') return KEPT_BOUNDARIES.has(properties.osm_value);
  if (properties.osm_key === 'place') return !DROPPED_PLACES.has(properties.osm_value);
  return false;
}

function kindOf(properties: PhotonProperties): PlaceKind {
  if (properties.osm_value === 'region' || properties.osm_value === 'local_authority') return 'region';
  // London, Mexico City and Shibuya are place=city objects that Photon files under the layer "district".
  if (properties.osm_key === 'place' && properties.osm_value === 'city') return 'city';
  switch (properties.type) {
    case 'country':
    case 'state':
    case 'county':
    case 'city':
    case 'district':
    case 'locality':
      return properties.type;
    default:
      return 'other';
  }
}

/** Written the way the presets write them, so rows from both sources read alike. */
const SHORT_COUNTRY: Readonly<Record<string, string>> = { US: 'USA', GB: 'UK' };

/**
 * The parents that tell this place from its namesakes: "California, USA", "Berlin, Germany", "Costa Rica".
 * A parent is left out when it only repeats the place's own name ("San Jose Province", Los Angeles County).
 */
function buildContext(properties: PhotonProperties, kind: PlaceKind, withCounty: boolean): string {
  const name = fold(properties.name ?? '');
  const parts: string[] = [];
  const add = (parent: string | undefined): boolean => {
    if (!parent) return false;
    const folded = fold(parent);
    if (folded === name || folded.startsWith(`${name} `) || parts.some((part) => fold(part) === folded)) return false;
    parts.push(parent);
    return true;
  };
  switch (kind) {
    case 'district':
    case 'locality':
      if (!add(properties.city)) add(properties.county);
      add(properties.state);
      break;
    case 'city':
      if (withCounty) add(properties.county);
      if (properties.state) add(properties.state);
      else if (!add(properties.city)) add(properties.county);
      break;
    case 'county':
      add(properties.state);
      break;
    case 'region':
    case 'other':
      add(properties.county);
      add(properties.state);
      break;
    case 'state':
    case 'country':
      break;
  }
  if (kind !== 'country') add(SHORT_COUNTRY[properties.countrycode ?? ''] ?? properties.country);
  return parts.join(', ');
}

function toHit(feature: PhotonFeature): Hit | null {
  const properties = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const center = { lng: Number(lng.toFixed(COORD_DIGITS)), lat: Number(lat.toFixed(COORD_DIGITS)) };
  if (!isMappablePlace(properties, center)) return null;
  const kind = kindOf(properties);
  const name = properties.name ?? '';
  return {
    identity: identityOf(feature),
    name,
    foldedName: fold(name),
    kind,
    center,
    properties,
    context: buildContext(properties, kind, false),
  };
}

function isSameSpot(a: Hit, b: Hit): boolean {
  return (
    a.properties.countrycode === b.properties.countrycode &&
    a.foldedName === b.foldedName &&
    distanceMeters(a.center, b.center) < SAME_PLACE_METERS
  );
}

/**
 * Photon lists one OSM object twice under different layers, and lists a city next to its own boundary,
 * state or county of the same name. Keeps the first of each, except that the city takes the slot of a
 * wider area it shares a name with, because its point is the one people mean by "the centre".
 */
function mergeDuplicates(hits: readonly Hit[]): Hit[] {
  const kept: Hit[] = [];
  for (const hit of hits) {
    const at = kept.findIndex((earlier) => earlier.identity === hit.identity || isSameSpot(earlier, hit));
    const earlier = kept[at];
    if (!earlier) {
      kept.push(hit);
      continue;
    }
    const earlierIsWider = earlier.kind === 'state' || earlier.kind === 'county' || earlier.kind === 'other';
    if (earlier.identity !== hit.identity && hit.kind === 'city' && earlierIsWider) kept[at] = hit;
  }
  return kept;
}

function isCityOf(hit: Hit, parent: Hit): boolean {
  const parentName = parent.kind === 'state' ? hit.properties.state : hit.properties.county;
  return (
    hit.kind === 'city' &&
    hit.properties.countrycode === parent.properties.countrycode &&
    hit.foldedName === parent.foldedName &&
    fold(parentName ?? '') === parent.foldedName
  );
}

/** São Paulo the state is ranked above São Paulo the city, and its point is 250 km away. The city goes first. */
function liftCitiesAboveTheirNamesakes(hits: readonly Hit[]): Hit[] {
  const ordered = [...hits];
  for (let index = 0; index < ordered.length; index++) {
    const parent = ordered[index];
    if (!parent || (parent.kind !== 'state' && parent.kind !== 'county')) continue;
    const cityAt = ordered.findIndex((hit, at) => at > index && isCityOf(hit, parent));
    const [city] = cityAt === -1 ? [] : ordered.splice(cityAt, 1);
    if (!city) continue;
    ordered.splice(index, 0, city);
    index++;
  }
  return ordered;
}

const KIND_WORD: Readonly<Record<PlaceKind, string>> = {
  country: 'Country',
  state: 'State',
  county: 'County',
  city: 'City',
  district: 'District',
  locality: 'Neighbourhood',
  region: 'Region',
  other: 'Area',
};

function clashing(hits: readonly Hit[]): Hit[] {
  const count = new Map<string, number>();
  const label = (hit: Hit): string => `${hit.foldedName}|${hit.context}`;
  for (const hit of hits) count.set(label(hit), (count.get(label(hit)) ?? 0) + 1);
  return hits.filter((hit) => (count.get(label(hit)) ?? 0) > 1);
}

/** Rows that would read the same are told apart: first by county, then by what kind of place each is. */
function tellApart(hits: readonly Hit[]): void {
  for (const hit of clashing(hits)) {
    if (hit.kind === 'city') hit.context = buildContext(hit.properties, hit.kind, true);
  }
  for (const hit of clashing(hits)) {
    if (hit.kind === 'city') continue;
    const word = KIND_WORD[hit.kind];
    hit.context = hit.context ? `${word} in ${hit.context}` : word;
  }
}

/** Turns a Photon answer into the rows to show: junk dropped, duplicates merged, cities first, labels built. */
export function normalisePhoton(response: PhotonResponse, limit: number = MAX_RESULTS): Place[] {
  const hits = response.features.flatMap((feature) => toHit(feature) ?? []);
  const shown = liftCitiesAboveTheirNamesakes(mergeDuplicates(hits)).slice(0, limit);
  tellApart(shown);
  return shown.map(({ name, context, center }) => ({ name, context, center }));
}

const OPTIONAL_TEXT_FIELDS = [
  'osm_type',
  'name',
  'housenumber',
  'street',
  'locality',
  'district',
  'postcode',
  'city',
  'county',
  'state',
  'country',
  'countrycode',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFeature(value: unknown): value is PhotonFeature {
  if (!isRecord(value)) return false;
  const { properties, geometry } = value;
  if (!isRecord(properties) || !isRecord(geometry)) return false;
  const coordinates = geometry['coordinates'];
  const isText = (key: string): boolean => {
    const text = properties[key];
    return typeof text === 'string' && text.length <= MAX_TEXT_LENGTH;
  };
  const isTextOrAbsent = (key: string): boolean => properties[key] === undefined || isText(key);
  const osmId = properties['osm_id'];
  return (
    Array.isArray(coordinates) &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1]) &&
    (osmId === undefined || typeof osmId === 'number') &&
    ['osm_key', 'osm_value', 'type'].every(isText) &&
    OPTIONAL_TEXT_FIELDS.every(isTextOrAbsent)
  );
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const request = new AbortController();
  const cancel = (): void => request.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    request.abort();
  }, SEARCH_TIMEOUT_MS);
  try {
    // No custom headers: the request stays CORS-simple, and the browser's Referer is how Photon knows the site.
    const response = await fetch(url, { signal: request.signal });
    if (!response.ok) {
      if (response.status === 400) console.warn(`Photon rejected the search request: ${url}`);
      throw new SearchUnavailableError('http', response.status);
    }
    return await readJsonWithin(response, MAX_ANSWER_BYTES).catch(() => {
      // Too long, not JSON, or cut off; an abort or a timeout is told apart below.
      throw new SearchUnavailableError('bad-response');
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timedOut) throw new SearchUnavailableError('timeout');
    if (error instanceof SearchUnavailableError) throw error;
    // A refused connection (how Photon's automatic block has shown up), DNS failure, or being offline.
    throw new SearchUnavailableError('network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Fetches one answer from Photon and returns its well-formed features. Rejects with
 * `SearchUnavailableError` when Photon cannot be reached, answers with an error, stays silent for
 * eight seconds or answers with far more than was asked for, and with the signal's own abort reason
 * when the caller aborts.
 */
export async function fetchFeatures(url: string, signal: AbortSignal): Promise<PhotonFeature[]> {
  const body = await fetchJson(url, signal);
  if (!isRecord(body) || !Array.isArray(body['features'])) throw new SearchUnavailableError('bad-response');
  if (body['features'].length > MAX_FEATURES) throw new SearchUnavailableError('bad-response');
  return body['features'].filter(isFeature);
}

/**
 * Looks a place up by name. Resolves with at most six cleaned rows, or with none when nothing matches.
 * Rejects as `fetchFeatures` does.
 */
export async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const text = cleanQuery(query);
  // A blank `q` next to `include` makes the server return arbitrary places instead of an error.
  if (text.length < MIN_QUERY_LENGTH) return [];
  signal.throwIfAborted();
  return normalisePhoton({ features: await fetchFeatures(buildSearchUrl(text), signal) });
}
