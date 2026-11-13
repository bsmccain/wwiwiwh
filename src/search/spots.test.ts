import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import infiniteLoop from './fixtures/spot-1-infinite-loop.json';
import downing from './fixtures/spot-10-downing.json';
import zipCode from './fixtures/spot-95014.json';
import applePark from './fixtures/spot-apple-park.json';
import bakerStreet from './fixtures/spot-baker-street.json';
import friedrichstrasse from './fixtures/spot-friedrichstrasse-43.json';
import goldenGate from './fixtures/spot-golden-gaet-bridge.json';
import heathrow from './fixtures/spot-heathrow.json';
import kingsCross from './fixtures/spot-kings-cross-station.json';
import piccadilly from './fixtures/spot-picadilly-circus.json';
import santanaRow from './fixtures/spot-santana-row.json';
import shoreditch from './fixtures/spot-shoreditch.json';
import springfield from './fixtures/spot-springfield.json';
import postcode from './fixtures/spot-sw1a-1aa.json';
import latitudeFirst from './fixtures/probes/bbox-latitude-first.json';
import biasAndBox from './fixtures/probes/bias-zoom-and-scale-with-bbox.json';
import noMatch from './fixtures/probes/no-match.json';
import unknownParameter from './fixtures/probes/unknown-parameter.json';
import { type PhotonResponse, SearchUnavailableError } from './photon';
import { createRemoteSearch, createSearchMemory, type RemoteState } from './remote-search';
import {
  buildSpotSearchUrl,
  isWorthAsking,
  normaliseSpots,
  searchSpots,
  searchSpotsInBoth,
  SPOT_SEARCH_MANNERS,
  type SpotHit,
  SURROUNDINGS_METERS,
} from './spots';

const LONDON: LngLat = { lat: 51.5074, lng: -0.1278 };
const SAN_JOSE: LngLat = { lat: 37.3362, lng: -121.8906 };
const BERLIN: LngLat = { lat: 52.52, lng: 13.405 };
/** The centres the app itself searches around (src/search/presets.ts); the postcode answers were saved through it. */
const LONDON_PRESET: LngLat = { lat: 51.5073, lng: -0.1276 };
const SAN_JOSE_PRESET: LngLat = { lat: 37.3322, lng: -121.8896 };

/** The fixtures are real answers, saved with only the fields the pickers read. */
type Fixture = { features: unknown[] };
const hits = (fixture: Fixture, around: LngLat, limit?: number): SpotHit[] =>
  normaliseSpots(fixture as unknown as PhotonResponse, around, limit);
const rows = (fixture: Fixture, around: LngLat, limit?: number): string[] =>
  hits(fixture, around, limit).map((hit) => (hit.context ? `${hit.name} | ${hit.context}` : hit.name));

let nextId = 1;
/** A made-up feature 1 km north of London per `north`, for the rules no saved answer happens to show. */
const feature = (properties: Record<string, unknown>, north = 0, around: LngLat = LONDON): unknown => ({
  properties: { osm_type: 'N', osm_id: nextId++, osm_key: 'amenity', osm_value: 'cafe', type: 'house', countrycode: 'GB', ...properties },
  geometry: { coordinates: [around.lng, around.lat + north / 111.32] },
});

describe('buildSpotSearchUrl', () => {
  it('builds exactly the requests the fixtures were saved from', () => {
    expect(buildSpotSearchUrl('10 downing', LONDON)).toBe(downing.request);
    expect(buildSpotSearchUrl('apple park', SAN_JOSE)).toBe(applePark.request);
    expect(buildSpotSearchUrl('friedrichstraße 43', BERLIN)).toBe(friedrichstrasse.request);
    expect(buildSpotSearchUrl('SW1A 1AA', LONDON_PRESET)).toBe(postcode.request);
    expect(buildSpotSearchUrl('95014', SAN_JOSE_PRESET)).toBe(zipCode.request);
  });

  it('asks in English, biased to the place and boxed to about 150 km around it', () => {
    expect([...new URL(buildSpotSearchUrl('10 downing', LONDON)).searchParams.entries()]).toEqual([
      ['q', '10 downing'],
      ['lang', 'en'],
      ['limit', '15'],
      ['lat', '51.5074'],
      ['lon', '-0.1278'],
      ['bbox', '-2.293,50.160,2.037,52.855'],
    ]);
  });

  it('draws the box west, south, east, north, with its corners beyond the reach it filters to', () => {
    const [west, south, east, north] = (new URL(buildSpotSearchUrl('x', LONDON)).searchParams.get('bbox') ?? '').split(',').map(Number);
    expect(distanceMeters(LONDON, { lat: LONDON.lat, lng: west as number })).toBeCloseTo(SURROUNDINGS_METERS, -3);
    expect(distanceMeters(LONDON, { lat: LONDON.lat, lng: east as number })).toBeCloseTo(SURROUNDINGS_METERS, -3);
    expect(distanceMeters(LONDON, { lat: south as number, lng: LONDON.lng })).toBeCloseTo(SURROUNDINGS_METERS, -3);
    expect(distanceMeters(LONDON, { lat: north as number, lng: LONDON.lng })).toBeCloseTo(SURROUNDINGS_METERS, -3);
  });

  it('keeps the box on the globe', () => {
    const box = (around: LngLat): string => new URL(buildSpotSearchUrl('x', around)).searchParams.get('bbox') ?? '';
    expect(box({ lat: -17.7134, lng: 178.065 })).toBe('176.650,-19.061,179.480,-16.366');
    expect(box({ lat: -16.8, lng: 179.9 })).toBe('178.492,-18.147,180.000,-15.453');
    expect(box({ lat: 84.9, lng: -179 })).toBe('-180.000,83.553,-163.842,86.247');
  });

  it('sends only parameters the server said it knows; it answers any other with an HTTP 400', () => {
    expect(unknownParameter.status).toBe(400);
    const allowed = /\[(.*)\]/.exec(unknownParameter.body.message)?.[1]?.split(', ') ?? [];
    const sent = [...new URL(buildSpotSearchUrl('10 downing', LONDON)).searchParams.keys()];
    expect(sent.filter((name) => !allowed.includes(name))).toEqual([]);
  });

  it('matches what the live server did with the box and the bias', () => {
    // Latitude first is not rejected, it is simply a box somewhere else.
    expect(latitudeFirst).toMatchObject({ status: 200, names: [] });
    // The bias point, and the two settings left to the server, are accepted next to the box.
    expect(biasAndBox.status).toBe(200);
    expect(biasAndBox.names[0]).toBe('10 Downing Street');
    expect(noMatch).toMatchObject({ status: 200, names: [] });
  });
});

describe('normaliseSpots: names', () => {
  it('keeps the name of a thing that has one', () => {
    expect(rows(downing, LONDON)[0]).toBe('10 Downing Street | Covent Garden, London');
    expect(rows(infiniteLoop, SAN_JOSE)[0]).toBe('Infinite Loop 1 | 1 Infinite Loop, Cupertino');
    expect(hits(heathrow, LONDON)[0]).toMatchObject({ name: 'Heathrow Airport', kind: 'landmark' });
  });

  it('calls an unnamed address by its number and street, number first where that country writes it so', () => {
    expect(hits(downing, LONDON)[1]).toMatchObject({ name: '10 Downing Road', context: 'Dagenham, London', kind: 'address' });
    const american = feature({ housenumber: '1600', street: 'Amphitheatre Parkway', city: 'Mountain View', countrycode: 'US' }, 0, SAN_JOSE);
    expect(rows({ features: [american] }, SAN_JOSE)).toEqual(['1600 Amphitheatre Parkway | Mountain View']);
  });

  it('puts the street first where that country writes it so', () => {
    expect(hits(friedrichstrasse, BERLIN)[0]).toMatchObject({ name: 'Friedrichstraße 43', kind: 'address' });
    const brazilian = feature({ housenumber: '1578', street: 'Avenida Paulista', city: 'São Paulo', countrycode: 'BR' });
    expect(rows({ features: [brazilian] }, LONDON)).toEqual(['Avenida Paulista 1578 | São Paulo']);
  });

  it('calls a street by its name and a neighbourhood by its own', () => {
    expect(hits(bakerStreet, LONDON)[0]).toMatchObject({ name: 'Baker Street', kind: 'street' });
    expect(hits(shoreditch, LONDON)[0]).toMatchObject({ name: 'Shoreditch', context: 'London', kind: 'area' });
    expect(hits(santanaRow, SAN_JOSE)[0]).toMatchObject({ name: 'Santana Row', context: 'San Jose', kind: 'area' });
  });

  it('lists a postcode typed on its own: the postcode as the name, then its district and town', () => {
    // The server answers a postcode with a thing that has a name and a point, and no OSM id or type.
    expect(Object.keys(postcode.features[0]?.properties ?? {})).not.toContain('osm_id');
    expect(hits(postcode, LONDON_PRESET)).toEqual([
      { name: 'SW1A 1AA', context: 'Westminster, London', position: { lat: 51.50134, lng: -0.1418 }, kind: 'area' },
    ]);
    expect(hits(zipCode, SAN_JOSE_PRESET)).toEqual([
      { name: '95014', context: 'Cupertino', position: { lat: 37.31779, lng: -122.03714 }, kind: 'area' },
    ]);
  });

  it('keeps apart the things of one answer that have no OSM id', () => {
    const [found] = postcode.features;
    const next = { ...found, properties: { ...found?.properties, name: 'SW1A 2AA' }, geometry: { coordinates: [-0.1276, 51.5034] } };
    expect(rows({ features: [found, next, found] }, LONDON_PRESET)).toEqual([
      'SW1A 1AA | Westminster, London',
      'SW1A 2AA | Westminster, London',
    ]);
    // Not only postcodes: anything with a name and a point is a row, id or no id.
    const folly = {
      properties: { osm_key: 'historic', osm_value: 'folly', type: 'house', name: 'The Folly', city: 'London', countrycode: 'GB' },
      geometry: { coordinates: [LONDON.lng, LONDON.lat] },
    };
    expect(hits({ features: [folly, folly] }, LONDON)).toMatchObject([{ name: 'The Folly', context: 'London', kind: 'landmark' }]);
  });

  it('rejects what has no usable name or position', () => {
    const response = {
      features: [
        feature({ street: 'Nameless Road' }),
        feature({ housenumber: '7' }),
        feature({ name: '   ', street: 'Blank Lane' }),
        feature({ name: 'Polar Station' }, (86 - LONDON.lat) * 111.32),
        feature({ name: 'Kept Café', street: 'Some Street', city: 'London' }, 1),
      ],
    };
    expect(rows(response, LONDON)).toEqual(['Kept Café | London']);
  });

  it('tidies a name and rounds the position to about a metre', () => {
    const bar = feature({ name: '  The   Long\tBar ', city: 'London' }) as object;
    const response = { features: [{ ...bar, geometry: { coordinates: [-0.12776534, 51.50744561] } }] };
    expect(hits(response, LONDON)).toEqual([
      { name: 'The Long Bar', context: 'London', position: { lat: 51.50745, lng: -0.12777 }, kind: 'landmark' },
    ]);
  });
});

describe('normaliseSpots: context', () => {
  it('gives a thing with an address of its own that address, then its town', () => {
    expect(rows(downing, LONDON, 20)).toContain('John Lewis | 10 Downing Street, Cambridge');
    expect(rows(downing, LONDON, 20)).toContain('Tapi Carpets | 10 Downing Street, Cambridge');
    expect(rows(friedrichstrasse, BERLIN)).toContain('Checkpoint Charlie | Friedrichstrasse 43-45, Berlin');
  });

  it('gives everything else its district, then its town', () => {
    expect(rows(bakerStreet, LONDON)).toEqual(['Baker Street | Marylebone, London']);
    expect(rows(heathrow, LONDON).slice(0, 3)).toEqual([
      'Heathrow Airport | London Borough of Hillingdon, London',
      'Heathrow Terminal 4 | London Borough of Hillingdon, London',
      'Heathrow Terminal 5 | Harmondsworth, London',
    ]);
    // The street Photon reports for a thing without a house number is only the nearest one.
    expect(rows(heathrow, LONDON).join()).not.toContain('Western Perimeter Road Roundabout');
  });

  it('falls back on the neighbourhood, and does not repeat the name', () => {
    expect(rows(santanaRow, SAN_JOSE, 20)).toContain('Santana Heights | Santana Row, San Jose');
    expect(rows(shoreditch, LONDON)).toContain('Shoreditch Town Hall | Shoreditch, London');
    expect(rows(applePark, SAN_JOSE)).toEqual(['Apple Park Way | Cupertino']);
  });

  it('gives a town the state it is in', () => {
    const town = feature({ osm_key: 'place', osm_value: 'city', type: 'city', name: 'Cupertino', county: 'Santa Clara', state: 'California', countrycode: 'US' }, 0, SAN_JOSE);
    expect(rows({ features: [town] }, SAN_JOSE)).toEqual(['Cupertino | California']);
  });

  it('tells two rows of one name apart by something finer, and lists them once when nothing does', () => {
    const cafe = (north: number, street?: string): unknown =>
      feature({ name: 'Corner Café', district: 'Soho', city: 'London', ...(street ? { street } : {}) }, north);
    expect(rows({ features: [cafe(1, 'Dean Street'), cafe(2, 'Frith Street')] }, LONDON)).toEqual([
      'Corner Café | Dean Street, London',
      'Corner Café | Frith Street, London',
    ]);
    expect(rows({ features: [cafe(1), cafe(2), cafe(3)] }, LONDON)).toEqual(['Corner Café | Soho, London']);
  });

  it('never shows two rows that read the same', () => {
    const fixtures: [Fixture, LngLat][] = [
      [downing, LONDON],
      [heathrow, LONDON],
      [kingsCross, LONDON],
      [piccadilly, LONDON],
      [shoreditch, LONDON],
      [friedrichstrasse, BERLIN],
      [springfield, SAN_JOSE],
      [santanaRow, SAN_JOSE],
      [goldenGate, SAN_JOSE],
    ];
    for (const [fixture, around] of fixtures) {
      const all = rows(fixture, around, 20);
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe('normaliseSpots: one row for one thing', () => {
  it('merges the pieces of a street into one row, placed on the piece nearest its middle', () => {
    expect(bakerStreet.features).toHaveLength(7);
    const [street, ...others] = hits(bakerStreet, LONDON);
    expect(others).toEqual([]);
    const pieces = bakerStreet.features.map((piece) => piece.geometry.coordinates[1] as number).sort();
    expect(street?.position).toEqual({ lat: 51.52015, lng: -0.15662 });
    expect(street?.position.lat).toBeGreaterThan(pieces[0] as number);
    expect(street?.position.lat).toBeLessThan(pieces.at(-1) as number);
  });

  it('takes the name, the context and the position of a merged street from one and the same piece', () => {
    // Three stretches of one street, each within reach of the next and each in another town.
    const stretch = (north: number, name: string, city: string): unknown =>
      feature({ osm_key: 'highway', osm_value: 'primary', type: 'street', name, city }, north);
    const pieces = [stretch(1, 'Main Street', 'Aston'), stretch(4.4, 'Main street', 'Chorley'), stretch(2.7, 'MAIN STREET', 'Burton')];
    expect(hits({ features: pieces }, LONDON)).toEqual([
      { name: 'MAIN STREET', context: 'Burton', position: { lat: 51.53165, lng: -0.1278 }, kind: 'street' },
    ]);

    // A bridge that two counties share is where its own middle is, and says so.
    const [bridge] = hits(goldenGate, SAN_JOSE);
    const middle = goldenGate.features.find(({ properties }) => properties.osm_value === 'bridge' && properties.osm_key === 'man_made');
    expect(middle?.properties).toMatchObject({ name: 'Golden Gate Bridge', county: 'Marin' });
    expect(bridge).toMatchObject({ name: 'Golden Gate Bridge', context: 'Marin', position: { lat: 37.81829, lng: -122.47838 } });
  });

  it('keeps streets of one name in different towns apart', () => {
    expect(rows(springfield, SAN_JOSE, 20).filter((row) => row.startsWith('Springfield Drive'))).toEqual([
      'Springfield Drive | Campbell',
      'Springfield Drive | San Carlos',
      'Springfield Drive | San Ramon',
      'Springfield Drive | Millbrae Meadows, Millbrae',
    ]);
  });

  it('joins two groups when a later piece turns out to lie between them', () => {
    const piece = (north: number, district: string): unknown =>
      feature({ osm_key: 'highway', osm_value: 'primary', type: 'street', name: 'Long Road', district, city: 'London' }, north);
    const [south, north, between] = [piece(1, 'Camden'), piece(4.5, 'Highgate'), piece(2.8, 'Kentish Town')];
    expect(rows({ features: [south, north] }, LONDON)).toEqual(['Long Road | Camden, London', 'Long Road | Highgate, London']);
    expect(rows({ features: [south, north, between] }, LONDON)).toEqual(['Long Road | Kentish Town, London']);
    expect(hits({ features: [south, north, between] }, LONDON)[0]?.position.lat).toBeCloseTo(LONDON.lat + 2.8 / 111.32, 4);
  });

  it('lists a thing, its entrances and the stops outside it once', () => {
    expect(piccadilly.features).toHaveLength(15);
    expect(rows(piccadilly, LONDON)).toEqual([
      'Piccadilly Circus | Covent Garden, London',
      'Zedwell Piccadilly Circus | Covent Garden, London',
      'Masala Zone Piccadilly Circus | Covent Garden, London',
    ]);
    expect(rows(santanaRow, SAN_JOSE).filter((row) => row.startsWith('Santana Row |'))).toEqual([
      'Santana Row | San Jose',
      'Santana Row | Burlingame',
    ]);
  });

  it('lists a repeated OSM object once', () => {
    const ids = goldenGate.features.map(({ properties }) => `${properties.osm_type}${properties.osm_id}`);
    expect(new Set(ids).size).toBeLessThan(ids.length);
    expect(rows(goldenGate, SAN_JOSE)).toEqual([
      'Golden Gate Bridge | Marin',
      'Golden Gate Bridge East Sidewalk | San Francisco',
      'Golden Gate Bridge West Sidewalk | Marin',
    ]);
    const twice = feature({ name: 'Twice', city: 'London' });
    expect(rows({ features: [twice, twice] }, LONDON)).toEqual(['Twice | London']);
  });
});

describe('normaliseSpots: order and reach', () => {
  it('shows at most six rows', () => {
    expect(hits(friedrichstrasse, BERLIN)).toHaveLength(6);
    expect(hits(friedrichstrasse, BERLIN, 2)).toHaveLength(2);
  });

  it('keeps the server’s order, which leads with the best match for what was typed', () => {
    expect(rows(downing, LONDON)).toEqual([
      '10 Downing Street | Covent Garden, London',
      '10 Downing Road | Dagenham, London',
      'Kullisse Downing Street No. 10 (The Crown) | Elstree and Borehamwood, Hertsmere',
      'Over the Moon Tattoo | 10 Downing Street, Waverley',
      'Downing House | North Kensington, London',
      'John Lewis | 10 Downing Street, Cambridge',
    ]);
    // An airport before a lane of the same name, a station before the footway named after it: the
    // server knows which is the better known, and a rule about spelling alone would not.
    expect(rows(heathrow, LONDON)[0]).toBe('Heathrow Airport | London Borough of Hillingdon, London');
    expect(rows(heathrow, LONDON)).toContain('Heathrow | Shere, Guildford');
    expect(rows(kingsCross, LONDON).slice(0, 3)).toEqual([
      "London King's Cross Railway Station | King's Cross, London",
      "St Pancras International Station | King's Cross, London",
      "King's Cross Station Concourse | King's Cross, London",
    ]);
  });

  it('still finds the thing when the spelling is off', () => {
    expect(new URL(piccadilly.request).searchParams.get('q')).toBe('picadilly circus');
    expect(hits(piccadilly, LONDON)[0]?.name).toBe('Piccadilly Circus');
    expect(new URL(goldenGate.request).searchParams.get('q')).toBe('golden gaet bridge');
    expect(hits(goldenGate, SAN_JOSE)[0]?.name).toBe('Golden Gate Bridge');
  });

  it('lists stops, entrances and junctions after everything else', () => {
    const all = rows(kingsCross, LONDON, 20);
    expect(all.slice(-4)).toEqual([
      "King's Cross Station | King's Cross, London",
      "King's Cross Station / York Way | Barnsbury, London",
      "King's Cross Station / Pentonville Road | Barnsbury, London",
      "London King's Cross | King's Cross, London",
    ]);
    expect(all.indexOf("Harry Potter Shop King's Cross | King's Cross, London")).toBe(6);
    expect(rows(santanaRow, SAN_JOSE, 20).at(-1)).toBe('Stevens Creek Boulevard & Santana Row | San Jose');
  });

  it('lists namesakes of one kind nearest first, each in a slot the server gave the name', () => {
    const addresses = hits(friedrichstrasse, BERLIN, 20).filter((hit) => hit.name === 'Friedrichstraße 43');
    const away = addresses.map((hit) => Math.round(distanceMeters(BERLIN, hit.position) / 1000));
    expect(away).toEqual([...away].sort((a, b) => a - b));
    expect(away[0]).toBe(26);
    // The slots themselves do not move: other names stay where the server put them.
    expect(rows(friedrichstrasse, BERLIN)[4]).toBe('BONITA | Friedrichstraße 43, Prenzlau');

    const far = feature({ name: 'The Crown', district: 'Barnet', city: 'London' }, 12);
    const near = feature({ name: 'The Crown', district: 'Soho', city: 'London' }, 1);
    const other = feature({ name: 'Crown Court', city: 'London' }, 3);
    expect(rows({ features: [far, other, near] }, LONDON)).toEqual([
      'The Crown | Soho, London',
      'Crown Court | London',
      'The Crown | Barnet, London',
    ]);
  });

  it('does not rank a lane above a suburb for being nearer', () => {
    const suburb = feature({ osm_key: 'place', osm_value: 'suburb', type: 'district', name: 'Kingston', city: 'London' }, 15);
    const lane = feature({ osm_key: 'highway', osm_value: 'residential', type: 'street', name: 'Kingston', district: 'Soho', city: 'London' }, 2);
    expect(hits({ features: [suburb, lane] }, LONDON).map((hit) => hit.kind)).toEqual(['area', 'street']);
  });

  it('leaves out what lies more than 150 km from the place, even inside the box', () => {
    const outOfReach = downing.features.filter(
      ({ geometry }) => distanceMeters(LONDON, { lng: geometry.coordinates[0] as number, lat: geometry.coordinates[1] as number }) > SURROUNDINGS_METERS,
    );
    expect(outOfReach.map(({ properties }) => properties.city)).toEqual(['Norwich', 'Dudley', 'Sandwell']);
    expect(rows(downing, LONDON, 20).join()).not.toMatch(/Norwich|Dudley|Sandwell/);
    // The same answer, asked from the other side of the world, holds nothing.
    expect(hits(downing, SAN_JOSE)).toEqual([]);
  });

  it('gives no rows for an empty answer', () => {
    expect(hits({ features: [] }, LONDON)).toEqual([]);
  });
});

describe('searchSpots', () => {
  const never = new AbortController().signal;
  const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks Photon once, with no custom headers, and returns the cleaned rows', async () => {
    const fetchMock = vi.fn(async () => answer(downing));
    vi.stubGlobal('fetch', fetchMock);
    const found = await searchSpots('  10   downing ', LONDON, never);
    expect(found).toEqual(hits(downing, LONDON));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(downing.request);
    expect(Object.keys(init)).toEqual(['signal']);
  });

  it('does not ask at all for fewer than three characters', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchSpots(' 1 ', LONDON, never)).resolves.toEqual([]);
    await expect(searchSpots(' 10  ', LONDON, never)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('finds a postcode that the server sends without an OSM id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(postcode)));
    await expect(searchSpots('SW1A 1AA', LONDON_PRESET, never)).resolves.toMatchObject([{ name: 'SW1A 1AA', context: 'Westminster, London' }]);
  });

  it('skips features it cannot read instead of failing the whole answer', async () => {
    const [first] = bakerStreet.features;
    const body = { features: [null, { properties: { housenumber: 10 }, geometry: {} }, first] };
    vi.stubGlobal('fetch', vi.fn(async () => answer(body)));
    await expect(searchSpots('baker street', LONDON, never)).resolves.toEqual(hits({ features: [first] }, LONDON));
  });

  it('fails the way the place search does when Photon is not answering', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const failure = await searchSpots('10 downing', LONDON, never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SearchUnavailableError);
    expect(failure).toMatchObject({ reason: 'network' });
    vi.stubGlobal('fetch', vi.fn(async () => answer({ message: 'overloaded' }, 503)));
    await expect(searchSpots('10 downing', LONDON, never)).rejects.toMatchObject({ reason: 'http', status: 503 });
  });

  it('does not start a request for a signal that is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchSpots('10 downing', LONDON, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a spot search as it is typed', () => {
  const answer = (body: unknown): Response => new Response(JSON.stringify(body));

  /** The remote search the spot pickers make, on vitest's clock, with a server that answers at once. */
  function setUp() {
    const fetchMock = vi.fn(async (_url: string) => answer(kingsCross));
    vi.stubGlobal('fetch', fetchMock);
    const states: RemoteState<SpotHit[]>[] = [];
    const remote = createRemoteSearch<SpotHit[]>((state) => states.push(state), {
      ...SPOT_SEARCH_MANNERS,
      search: (query, signal) => searchSpots(query, LONDON, signal),
      memory: createSearchMemory(),
    });
    const asked = (): (string | null)[] => fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('q'));
    return { remote, states, asked };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('counts three characters as worth asking about, and two where each is a syllable or a word', () => {
    expect(['', 'k', 'ki', '10', 'é1'].filter(isWorthAsking)).toEqual([]);
    expect(['kin', '10 d', 'o2 arena', '😀😀😀'].filter(isWorthAsking)).toEqual(['kin', '10 d', 'o2 arena', '😀😀😀']);
    expect(['渋', '渋谷', '강남', 'すし', 'カフェ'].filter(isWorthAsking)).toEqual(['渋谷', '강남', 'すし', 'カフェ']);
    // An emoji is one character, however it is stored.
    expect(isWorthAsking('😀😀')).toBe(false);
  });

  it('asks nothing before the third character, however long the pause', async () => {
    const { remote, states, asked } = setUp();
    remote.ask('k');
    await vi.advanceTimersByTimeAsync(5000);
    remote.ask('ki');
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked()).toEqual([]);
    expect(states).toEqual([{ status: 'idle' }, { status: 'idle' }]);
  });

  it('asks only after 400 ms without a keystroke', async () => {
    const { remote, states, asked } = setUp();
    // A slow typist: a key every 350 ms never leaves a pause long enough.
    for (const typed of ['kin', 'king', 'kings', 'kings c', 'kings cr']) {
      remote.ask(typed);
      await vi.advanceTimersByTimeAsync(350);
    }
    remote.ask('kings cross station');
    await vi.advanceTimersByTimeAsync(399);
    expect(asked()).toEqual([]);
    expect(states.at(-1)).toEqual({ status: 'waiting', query: 'kings cross station' });
    await vi.advanceTimersByTimeAsync(1);
    expect(asked()).toEqual(['kings cross station']);
    expect(states.at(-1)).toMatchObject({ status: 'done', query: 'kings cross station' });
    expect(SPOT_SEARCH_MANNERS.quietMs).toBe(400);
  });
});

describe('searchSpotsInBoth', () => {
  const never = new AbortController().signal;
  const answer = (body: unknown): Response => new Response(JSON.stringify(body));
  const placeAsked = (url: string): string => (new URL(url).searchParams.get('lat') === String(LONDON.lat) ? 'London' : 'San Jose');

  /** A stand-in for `fetch` whose requests are answered by hand, and which notes the ones that were dropped. */
  function handDrivenFetch() {
    const pending = new Map<string, { resolve: (response: Response) => void; reject: (error: unknown) => void }>();
    const dropped: string[] = [];
    const fetchMock = vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          pending.set(placeAsked(url), { resolve, reject });
          init.signal?.addEventListener('abort', () => {
            dropped.push(placeAsked(url));
            reject(init.signal?.reason);
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return { pending, dropped, fetchMock };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks about both places at once and answers for each in the order given', async () => {
    const fetchMock = vi.fn(async (_url: string) => answer(downing));
    vi.stubGlobal('fetch', fetchMock);
    const [nearSanJose, nearLondon] = await searchSpotsInBoth('10 downing', [SAN_JOSE, LONDON], never);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([buildSpotSearchUrl('10 downing', SAN_JOSE), downing.request]);
    expect(nearSanJose).toEqual([]);
    expect(nearLondon).toEqual(hits(downing, LONDON));
  });

  it('fails as a whole when either request fails, and drops the other', async () => {
    const { pending, dropped } = handDrivenFetch();
    const both = searchSpotsInBoth('heathrow', [SAN_JOSE, LONDON], never);
    pending.get('San Jose')?.reject(new TypeError('Failed to fetch'));
    await expect(both).rejects.toMatchObject({ name: 'SearchUnavailableError', reason: 'network' });
    expect(dropped).toEqual(['London']);
  });

  it('drops both requests when the caller gives up, and says so with the caller’s own reason', async () => {
    const { dropped, fetchMock } = handDrivenFetch();
    const caller = new AbortController();
    const both = searchSpotsInBoth('heathrow', [SAN_JOSE, LONDON], caller.signal);
    caller.abort(new DOMException('Typed on', 'AbortError'));
    await expect(both).rejects.toMatchObject({ name: 'AbortError', message: 'Typed on' });
    expect(dropped.sort()).toEqual(['London', 'San Jose']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for a caller that has already given up', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchSpotsInBoth('heathrow', [SAN_JOSE, LONDON], AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
