import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';
import type { LngLat } from '../../src/geo/types';

/** Answers saved from the live Photon server; the pickers' unit tests read the same files. */
const SAVED_ANSWERS = fileURLToPath(new URL('../../src/search/fixtures/', import.meta.url));

/**
 * The two searches the app makes of Photon. A place search asks for settlements and regions only
 * (its request carries `include`). A spot search asks for anything with a name or a house number, in
 * a box around a place (its request carries `bbox` and no `include`).
 */
type SearchKind = 'place' | 'spot';

interface SavedFeature {
  readonly properties: { readonly name?: string };
  readonly geometry: { readonly coordinates: readonly [lng: number, lat: number] };
}

interface SavedAnswer {
  /** The address the answer was fetched from. */
  readonly request: string;
  readonly features: readonly SavedFeature[];
}

/** One search the page made. */
export interface SearchRequest {
  readonly kind: SearchKind;
  readonly query: string;
  /** For a spot search: the point the request leans towards, which is the centre of the place searched in. */
  readonly near: LngLat | null;
}

/** The stand-in for the public Photon server, and the switches a test can throw on it. */
export interface PlaceSearch {
  /** The server is out of reach: nothing it is asked arrives. */
  down: boolean;
  /** What the page has asked so far, in order. */
  readonly requests: SearchRequest[];
  /** Has the spot search answer a query with these features, in place of what is saved for it (if anything is). */
  answerSpots(query: string, features: readonly SavedFeature[]): void;
}

function kindOf(params: URLSearchParams): SearchKind {
  return params.has('bbox') && !params.has('include') ? 'spot' : 'place';
}

const keyOf = (kind: SearchKind, query: string): string => `${kind}:${query.toLowerCase()}`;

/** The saved answers by the kind of search and the query that got them. */
function loadAnswers(): Map<string, readonly SavedFeature[]> {
  const answers = new Map<string, readonly SavedFeature[]>();
  for (const file of readdirSync(SAVED_ANSWERS)) {
    if (!file.endsWith('.json')) continue;
    const saved = JSON.parse(readFileSync(`${SAVED_ANSWERS}${file}`, 'utf8')) as SavedAnswer;
    const params = new URL(saved.request).searchParams;
    const query = params.get('q');
    if (query) answers.set(keyOf(kindOf(params), query), saved.features);
  }
  return answers;
}

const SAVED = loadAnswers();

/** What the live server answered a spot search with. Throws when no answer to that query is saved. */
export function savedSpots(query: string): readonly SavedFeature[] {
  const features = SAVED.get(keyOf('spot', query));
  if (!features) throw new Error(`No spot search for "${query}" is saved.`);
  return features;
}

/** Where the saved answer to a spot search puts the thing of this name. Throws when it does not list one. */
export function savedSpot(query: string, name: string): LngLat {
  const feature = savedSpots(query).find((candidate) => candidate.properties.name === name);
  if (!feature) throw new Error(`The saved answer to "${query}" has no "${name}".`);
  const [lng, lat] = feature.geometry.coordinates;
  return { lng, lat };
}

function coordinate(text: string | null): number {
  return text === null ? NaN : Number(text);
}

/**
 * Answers both searches from the saved files, so no test leans on the public Photon server. A query
 * with no saved answer of its kind finds nothing. A spot search gets the same answer whichever place
 * it is made around, as far as the saved files go: the app itself drops what is out of the place's reach.
 */
export async function stubPlaceSearch(context: BrowserContext): Promise<PlaceSearch> {
  const answers = new Map(SAVED);
  const search: PlaceSearch = {
    down: false,
    requests: [],
    answerSpots(query, features) {
      answers.set(keyOf('spot', query), features);
    },
  };
  await context.route('https://photon.komoot.io/**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const kind = kindOf(params);
    const query = params.get('q') ?? '';
    const near = kind === 'spot' ? { lat: coordinate(params.get('lat')), lng: coordinate(params.get('lon')) } : null;
    search.requests.push({ kind, query, near });
    if (search.down) return route.abort('connectionrefused');
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ type: 'FeatureCollection', features: answers.get(keyOf(kind, query)) ?? [] }),
    });
  });
  return search;
}
