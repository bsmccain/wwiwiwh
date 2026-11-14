import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '../app/types';
import london from './fixtures/london.json';
import losAngeles from './fixtures/los-angeles.json';
import mexicoCity from './fixtures/mexico-city.json';
import paloAl from './fixtures/palo-al.json';
import sanJose from './fixtures/san-jose.json';
import saoPaulo from './fixtures/sao-paulo.json';
import zipCode from './fixtures/spot-95014.json';
import postcode from './fixtures/spot-sw1a-1aa.json';
import tokyo from './fixtures/tokyo.json';
import {
  buildSearchUrl,
  identityOf,
  MAX_ANSWER_BYTES,
  MAX_FEATURES,
  MAX_RESULTS,
  MAX_TEXT_LENGTH,
  normalisePhoton,
  type PhotonFeature,
  type PhotonResponse,
  searchPlaces,
  SEARCH_TIMEOUT_MS,
  SearchUnavailableError,
} from './photon';

/** The fixtures are real answers, saved with only the fields the picker reads. */
const rows = (fixture: { features: unknown[] }, limit?: number): Place[] =>
  normalisePhoton(fixture as unknown as PhotonResponse, limit);
const labels = (fixture: { features: unknown[] }): string[] =>
  rows(fixture).map((place) => (place.context ? `${place.name} | ${place.context}` : place.name));

describe('buildSearchUrl', () => {
  it('builds exactly the request that was checked against the live server', () => {
    expect(buildSearchUrl('são paulo')).toBe(
      'https://photon.komoot.io/api/?q=s%C3%A3o+paulo&lang=en&limit=15' +
        '&include=osm.place%2Cosm.boundary.administrative%2Cosm.boundary.region' +
        '%2Cosm.boundary.local_authority%2Cosm.boundary.ceremonial%2Cosm.boundary.census',
    );
  });

  it('sends four parameters and nothing else, because an unknown parameter is an HTTP 400', () => {
    const params = [...new URL(buildSearchUrl('palo al')).searchParams.entries()];
    expect(params).toEqual([
      ['q', 'palo al'],
      ['lang', 'en'],
      ['limit', '15'],
      [
        'include',
        'osm.place,osm.boundary.administrative,osm.boundary.region,osm.boundary.local_authority,' +
          'osm.boundary.ceremonial,osm.boundary.census',
      ],
    ]);
  });

  it('is the request the fixtures were saved from', () => {
    expect(buildSearchUrl('san jose')).toBe(sanJose.request);
    expect(buildSearchUrl('palo al')).toBe(paloAl.request);
  });
});

describe('normalisePhoton', () => {
  it('builds a name and a context for each row', () => {
    expect(labels(sanJose)).toEqual([
      'San Jose | California, USA',
      'San Jose | Illinois, USA',
      'San Jose | Nueva Ecija, Philippines',
      'San Jose Province | Costa Rica',
      'San Jose del Monte | Bulacan, Philippines',
      'San José | Costa Rica',
    ]);
  });

  it('returns plain places at the point Photon gives, without a preset id', () => {
    expect(rows(sanJose)[0]).toEqual({
      name: 'San Jose',
      context: 'California, USA',
      center: { lat: 37.33617, lng: -121.89059 },
    });
    expect(rows(sanJose).every((place) => place.id === undefined)).toBe(true);
  });

  it('keeps Photon’s order and at most six rows', () => {
    expect(sanJose.features).toHaveLength(15);
    expect(rows(sanJose)).toHaveLength(MAX_RESULTS);
    expect(rows(sanJose, 2).map((place) => place.context)).toEqual(['California, USA', 'Illinois, USA']);
    expect(labels(paloAl).slice(0, 3)).toEqual([
      'Palo Alto | California, USA',
      'Palo Alto | Iowa, USA',
      'Palo Alto | Pennsylvania, USA',
    ]);
  });

  it('writes countries the way the presets do', () => {
    expect(labels(london).slice(0, 3)).toEqual([
      'London | England, UK',
      'London | Ontario, Canada',
      'London | Kentucky, USA',
    ]);
  });

  it('lifts a city above the state of the same name', () => {
    const [first, second] = rows(saoPaulo);
    expect(first).toEqual({ name: 'São Paulo', context: 'Brazil', center: { lat: -23.55065, lng: -46.63338 } });
    expect(second).toMatchObject({ name: 'São Paulo', context: 'State in Brazil' });
  });

  it('drops an OSM object that Photon lists twice', () => {
    const repeated = saoPaulo.features.filter((feature) => feature.properties.osm_id === 5349780);
    expect(repeated).toHaveLength(2);
    expect(labels(saoPaulo).filter((label) => label.startsWith('São Paulo Botanical Garden'))).toHaveLength(1);
  });

  it('merges a city with the same-named state around it and keeps the city’s point', () => {
    const named = mexicoCity.features.filter((feature) => feature.properties.name === 'Mexico City');
    expect(named.map((feature) => feature.properties.type)).toEqual(['state', 'district']);
    const merged = rows(mexicoCity).filter((place) => place.name === 'Mexico City');
    expect(merged).toEqual([{ name: 'Mexico City', context: 'Mexico', center: { lat: 19.43263, lng: -99.13318 } }]);
  });

  it('tells a city from the county of the same name', () => {
    expect(labels(losAngeles).slice(0, 3)).toEqual([
      'Los Angeles | California, USA',
      'Los Angeles | County in California, USA',
      'Los Angeles | Chiriquí, Panama',
    ]);
  });

  it('merges a town with its census twin a few kilometres away', () => {
    const twins = losAngeles.features.filter((feature) => feature.properties.name === 'Lake Los Angeles');
    expect(twins.map((feature) => feature.properties.osm_value)).toEqual(['town', 'census']);
    expect(labels(losAngeles).filter((label) => label.startsWith('Lake Los Angeles'))).toHaveLength(1);
  });

  it('drops squares, islets and other things that are not places to compare', () => {
    const junk = tokyo.features.filter((feature) => ['square', 'islet'].includes(feature.properties.osm_value));
    expect(junk.length).toBeGreaterThan(0);
    expect(labels(tokyo)).toEqual([
      'Tokyo | Japan',
      'Tokyo International Airport | Japan',
      'Tokyo | Hayapuga Rural LLG, Hela Province, Papua New Guinea',
      'Tokyo | Biguina-Akpassa, Donga Department, Benin',
      'Tokio | Central Province, Papua New Guinea',
      'Takyo | Hiya, Arunachal Pradesh, India',
    ]);
  });

  it('drops streets, shops, unlisted boundaries, nameless things and places off the map', () => {
    const feature = (properties: Record<string, unknown>, lat = 10): unknown => ({
      properties: { osm_type: 'N', osm_id: Math.round(lat * 1000), type: 'city', country: 'Testland', ...properties },
      geometry: { coordinates: [20, lat] },
    });
    const response = {
      features: [
        feature({ osm_key: 'highway', osm_value: 'residential', type: 'street', name: 'Main Street' }, 1),
        feature({ osm_key: 'amenity', osm_value: 'cafe', type: 'house', name: 'Cafe Town' }, 2),
        feature({ osm_key: 'boundary', osm_value: 'national_park', type: 'other', name: 'Bay Park' }, 3),
        feature({ osm_key: 'place', osm_value: 'city', type: 'house', name: 'Mislabelled' }, 4),
        feature({ osm_key: 'place', osm_value: 'town' }, 5),
        feature({ osm_key: 'place', osm_value: 'hamlet', name: 'Polar Station' }, 89),
        feature({ osm_key: 'boundary', osm_value: 'census', name: 'Kept Census Place' }, 6),
        feature({ osm_key: 'place', osm_value: 'town', name: 'Kept Town' }, 7),
      ],
    } as unknown as PhotonResponse;
    expect(normalisePhoton(response).map((place) => place.name)).toEqual(['Kept Census Place', 'Kept Town']);
  });

  it('leaves a postcode to the spot search: it is not a place to compare', () => {
    expect(postcode.features[0]?.properties).toMatchObject({ osm_key: 'place', osm_value: 'postcode', name: 'SW1A 1AA' });
    expect(rows(postcode)).toEqual([]);
    expect(rows(zipCode)).toEqual([]);
  });

  it('gives no rows for an empty answer', () => {
    expect(normalisePhoton({ features: [] })).toEqual([]);
  });
});

describe('identityOf', () => {
  const thing = (properties: Record<string, unknown>, coordinates: [number, number] = [-0.14, 51.5]): PhotonFeature =>
    ({ properties: { osm_key: 'place', osm_value: 'postcode', type: 'other', ...properties }, geometry: { coordinates } }) as PhotonFeature;

  it('is the OSM object, whichever layer Photon lists it under', () => {
    const asRoad = thing({ osm_type: 'W', osm_id: 7, osm_key: 'highway', type: 'street', name: 'Tower Bridge' });
    const asStructure = thing({ osm_type: 'W', osm_id: 7, osm_key: 'man_made', type: 'house', name: 'Tower Bridge' }, [-0.07, 51.5]);
    expect(identityOf(asRoad)).toBe('W7');
    expect(identityOf(asStructure)).toBe(identityOf(asRoad));
    expect(identityOf(thing({ osm_type: 'N', osm_id: 7 }))).not.toBe('W7');
  });

  it('is the tag, the name and the point of a thing that is no OSM object', () => {
    const [saved] = postcode.features as unknown as PhotonFeature[];
    expect(identityOf(saved as PhotonFeature)).toBe('place|postcode|SW1A 1AA|-0.1417955|51.50133745');
    expect(identityOf(thing({ name: 'SW1A 1AA' }))).toBe(identityOf(thing({ name: 'SW1A 1AA' })));
    expect(identityOf(thing({ name: 'SW1A 2AA' }))).not.toBe(identityOf(thing({ name: 'SW1A 1AA' })));
    expect(identityOf(thing({ name: 'SW1A 1AA' }, [-0.13, 51.5]))).not.toBe(identityOf(thing({ name: 'SW1A 1AA' })));
  });
});

describe('searchPlaces', () => {
  const never = new AbortController().signal;
  const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
  const hangUntilAborted = (_url: string, init: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks Photon once, with no custom headers, and returns the cleaned rows', async () => {
    const fetchMock = vi.fn(async () => answer(sanJose));
    vi.stubGlobal('fetch', fetchMock);
    const places = await searchPlaces('  san   jose ', never);
    expect(places).toEqual(rows(sanJose));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(buildSearchUrl('san jose'));
    expect(Object.keys(init)).toEqual(['signal']);
  });

  it('resolves with no rows when nothing matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ type: 'FeatureCollection', features: [] })));
    await expect(searchPlaces('qqqqzzzz', never)).resolves.toEqual([]);
  });

  it('does not ask at all for fewer than two characters', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchPlaces(' a ', never)).resolves.toEqual([]);
    await expect(searchPlaces('', never)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips features it cannot read instead of failing the whole answer', async () => {
    const [first] = sanJose.features;
    const wrongId = { ...first, properties: { ...first?.properties, osm_id: 'seven' } };
    const wrongType = { ...first, properties: { ...first?.properties, osm_type: 7 } };
    const body = { features: [null, { properties: {} }, { properties: { name: 7 }, geometry: {} }, wrongId, wrongType, first] };
    vi.stubGlobal('fetch', vi.fn(async () => answer(body)));
    await expect(searchPlaces('san jose', never)).resolves.toEqual(rows({ features: [first] }));
  });

  /** `count` distinct cities, the way the security audit's probe built them. */
  const cities = (count: number): unknown => ({
    features: Array.from({ length: count }, (_, at) => ({
      properties: { osm_type: 'N', osm_id: at + 1, osm_key: 'place', osm_value: 'city', type: 'city', name: `Town ${at}`, countrycode: 'US' },
      geometry: { coordinates: [0, 0] },
    })),
  });

  it('rejects an answer with far more features than were asked for, before reading them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(cities(8000))));
    await expect(searchPlaces('town', never)).rejects.toMatchObject({ name: 'SearchUnavailableError', reason: 'bad-response' });
    vi.stubGlobal('fetch', vi.fn(async () => answer(cities(MAX_FEATURES + 1))));
    await expect(searchPlaces('town', never)).rejects.toMatchObject({ reason: 'bad-response' });
    vi.stubGlobal('fetch', vi.fn(async () => answer(cities(MAX_FEATURES))));
    await expect(searchPlaces('town', never)).resolves.toHaveLength(MAX_RESULTS);
  });

  it('rejects an answer far longer than any real one while it arrives, with or without its length', async () => {
    const kilobyte = new TextEncoder().encode(' '.repeat(1024));
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += kilobyte.byteLength;
        controller.enqueue(kilobyte);
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(endless, { status: 200 })));
    await expect(searchPlaces('san jose', never)).rejects.toMatchObject({ name: 'SearchUnavailableError', reason: 'bad-response' });
    expect(sent).toBeLessThan(MAX_ANSWER_BYTES + 64 * 1024);
    const declared = new Response('{"features":[]}', { status: 200, headers: { 'content-length': String(MAX_ANSWER_BYTES + 1) } });
    vi.stubGlobal('fetch', vi.fn(async () => declared));
    await expect(searchPlaces('san jose', never)).rejects.toMatchObject({ reason: 'bad-response' });
  });

  it('skips a feature with text longer than OpenStreetMap allows', async () => {
    const [first] = sanJose.features;
    const long = (key: string): unknown => ({ ...first, properties: { ...first?.properties, [key]: 'x'.repeat(MAX_TEXT_LENGTH + 1) } });
    const longest = { ...first, properties: { ...first?.properties, name: 'x'.repeat(MAX_TEXT_LENGTH) } };
    vi.stubGlobal('fetch', vi.fn(async () => answer({ features: [long('name'), long('state'), long('osm_value'), first] })));
    await expect(searchPlaces('san jose', never)).resolves.toEqual(rows({ features: [first] }));
    vi.stubGlobal('fetch', vi.fn(async () => answer({ features: [longest] })));
    await expect(searchPlaces('san jose', never)).resolves.toHaveLength(1);
  });

  it('rejects with SearchUnavailableError on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ message: 'overloaded' }, 503)));
    const failure = await searchPlaces('san jose', never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SearchUnavailableError);
    expect(failure).toMatchObject({ name: 'SearchUnavailableError', reason: 'http', status: 503 });
  });

  it('rejects with SearchUnavailableError and warns when Photon calls the request malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => answer({ message: "Unknown query parameter 'foo'." }, 400)));
    await expect(searchPlaces('san jose', never)).rejects.toMatchObject({ reason: 'http', status: 400 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rejects with SearchUnavailableError when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(searchPlaces('san jose', never)).rejects.toMatchObject({
      name: 'SearchUnavailableError',
      reason: 'network',
    });
  });

  it('rejects with SearchUnavailableError when the answer is not what Photon sends', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 200 })));
    await expect(searchPlaces('san jose', never)).rejects.toMatchObject({ reason: 'bad-response' });
    vi.stubGlobal('fetch', vi.fn(async () => answer({ features: 'none' })));
    await expect(searchPlaces('san jose', never)).rejects.toMatchObject({ reason: 'bad-response' });
  });

  it('gives up after eight seconds of silence', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(hangUntilAborted);
    vi.stubGlobal('fetch', fetchMock);
    const outcome = searchPlaces('san jose', never).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS - 1);
    expect((fetchMock.mock.calls[0]?.[1].signal as AbortSignal).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ name: 'SearchUnavailableError', reason: 'timeout' });
    expect(SEARCH_TIMEOUT_MS).toBe(8000);
  });

  it('passes the caller’s abort through as an abort, not as "unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted));
    const typing = new AbortController();
    const outcome = searchPlaces('san jose', typing.signal).catch((error: unknown) => error);
    typing.abort();
    const failure = await outcome;
    expect(failure).not.toBeInstanceOf(SearchUnavailableError);
    expect(failure).toMatchObject({ name: 'AbortError' });
  });

  it('does not start a request for a signal that is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchPlaces('san jose', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
