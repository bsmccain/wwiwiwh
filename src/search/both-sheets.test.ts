import { describe, expect, it } from 'vitest';
import { destination } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { ROWS_IN_SIGHT, shareBetweenSheets } from './both-sheets';
import infiniteLoop from './fixtures/spot-1-infinite-loop.json';
import downing from './fixtures/spot-10-downing.json';
import kingsCross from './fixtures/spot-kings-cross-station.json';
import santanaRow from './fixtures/spot-santana-row.json';
import type { PhotonResponse } from './photon';
import { normaliseSpots } from './spots';

const SAN_JOSE: LngLat = { lat: 37.3362, lng: -121.8906 };
const SAN_FRANCISCO: LngLat = { lat: 37.7793, lng: -122.4193 };
const LONDON: LngLat = { lat: 51.5074, lng: -0.1278 };

interface Spot {
  readonly name: string;
  readonly context: string;
  readonly position: LngLat;
}

/** A spot some kilometres north of a place's centre. */
const spot = (name: string, around: LngLat, north = 1, context = ''): Spot => ({ name, context, position: destination(around, 0, north * 1000) });
const spots = (prefix: string, around: LngLat, count: number, firstNorth = 1): Spot[] =>
  Array.from({ length: count }, (_, index) => spot(`${prefix} ${index + 1}`, around, index + firstNorth));
const names = (list: readonly Spot[]): string[] => list.map(({ name }) => name);

describe('shareBetweenSheets', () => {
  const farApart = { home: SAN_JOSE, away: LONDON };
  const neighbours = { home: SAN_JOSE, away: SAN_FRANCISCO };

  it('gives each map half the room when both have plenty', () => {
    const shown = shareBetweenSheets({ home: spots('Home', SAN_JOSE, 6), away: spots('Away', LONDON, 6) }, farApart);
    expect(names(shown.home)).toEqual(['Home 1', 'Home 2', 'Home 3', 'Home 4']);
    expect(names(shown.away)).toEqual(['Away 1', 'Away 2', 'Away 3', 'Away 4']);
    expect(shown.home.length + shown.away.length).toBe(ROWS_IN_SIGHT);
  });

  it('never lists more than four of a map while the other has anything, so that both are in sight', () => {
    const lopsided = shareBetweenSheets({ home: spots('Home', SAN_JOSE, 6), away: spots('Away', LONDON, 1) }, farApart);
    expect(names(lopsided.home)).toEqual(['Home 1', 'Home 2', 'Home 3', 'Home 4']);
    expect(names(lopsided.away)).toEqual(['Away 1']);
    const theOtherWay = shareBetweenSheets({ home: spots('Home', SAN_JOSE, 2), away: spots('Away', LONDON, 6) }, farApart);
    expect(theOtherWay.home).toHaveLength(2);
    expect(theOtherWay.away).toHaveLength(4);
  });

  it('lists the best four of each place for words both answer, as the saved answers have them', () => {
    const found = {
      home: normaliseSpots(santanaRow as unknown as PhotonResponse, SAN_JOSE),
      away: normaliseSpots(kingsCross as unknown as PhotonResponse, LONDON),
    };
    expect([found.home.length, found.away.length]).toEqual([6, 6]);
    const shown = shareBetweenSheets(found, farApart);
    expect(names(shown.home)).toEqual(['Santana Row', 'Santana Row Security', 'Santana Row Living', 'Santana Row']);
    expect(names(shown.away)).toEqual([
      "London King's Cross Railway Station",
      'St Pancras International Station',
      "King's Cross Station Concourse",
      "King's Cross Station | Lewis Cubitt",
    ]);
  });

  it('gives a map that is alone in the list all the room', () => {
    const oneSided = shareBetweenSheets({ home: [], away: spots('Away', LONDON, 6) }, farApart);
    expect(oneSided).toEqual({ home: [], away: spots('Away', LONDON, 6) });
    // Neighbouring places: both searches find things of the one place.
    const found = { home: spots('Found from Home', SAN_FRANCISCO, 6), away: spots('Found from Away', SAN_FRANCISCO, 6, 7) };
    const crowded = shareBetweenSheets(found, neighbours);
    expect(crowded.home).toEqual([]);
    expect(crowded.away).toHaveLength(ROWS_IN_SIGHT);
  });

  it('leaves out a spot within 30 m of a position to skip on its own map', () => {
    const pinnedHome = spot('Infinite Loop 1', SAN_JOSE, 2);
    const pinnedAway = spot('10 Downing Street', LONDON, 1);
    const found = { home: [pinnedHome, ...spots('Home', SAN_JOSE, 5, 3)], away: [pinnedAway, spot('Downing College', LONDON, 3)] };
    const skip = { home: [destination(pinnedHome.position, 90, 25)], away: [destination(pinnedAway.position, 180, 29)] };
    const shown = shareBetweenSheets(found, farApart, skip);
    expect(names(shown.home)).toEqual(['Home 1', 'Home 2', 'Home 3', 'Home 4']);
    expect(names(shown.away)).toEqual(['Downing College']);
    // A little further off it is another spot.
    const further = { home: [destination(pinnedHome.position, 90, 35)], away: [destination(pinnedAway.position, 180, 31)] };
    expect(names(shareBetweenSheets(found, farApart, further).home)[0]).toBe('Infinite Loop 1');
    expect(names(shareBetweenSheets(found, farApart, further).away)[0]).toBe('10 Downing Street');
  });

  it('does not offer the two spots the pin holds together, as the saved answers have them', () => {
    const found = {
      home: normaliseSpots(infiniteLoop as unknown as PhotonResponse, SAN_JOSE),
      away: normaliseSpots(downing as unknown as PhotonResponse, LONDON),
    };
    expect(names(shareBetweenSheets(found, farApart).home)).toEqual(['Infinite Loop 1', 'BJ’s']);
    expect(names(shareBetweenSheets(found, farApart).away)[0]).toBe('10 Downing Street');
    // The pin as a link rounds it: Infinite Loop 1 held on 10 Downing Street.
    const pin = { home: [{ lat: 37.33167, lng: -122.0301 }], away: [{ lat: 51.50349, lng: -0.1277 }] };
    const offered = shareBetweenSheets(found, farApart, pin);
    expect(names(offered.home)).toEqual(['BJ’s']);
    expect(names(offered.away)).toEqual(['10 Downing Road', 'Kullisse Downing Street No. 10 (The Crown)', 'Over the Moon Tattoo', 'Downing House']);
  });

  it('skips on the map a spot is listed with, and lets the other map have the room of a map left empty', () => {
    const pinned = spot('10 Downing Street', LONDON, 1);
    // A position of Home means nothing on Away, even at the same coordinates.
    expect(shareBetweenSheets({ home: [], away: [pinned] }, farApart, { home: [pinned.position] }).away).toEqual([pinned]);
    const onlyTheStart = shareBetweenSheets({ home: spots('Home', SAN_JOSE, 6), away: [pinned] }, farApart, { away: [pinned.position] });
    expect(onlyTheStart.away).toEqual([]);
    expect(onlyTheStart.home).toHaveLength(6);
    expect(shareBetweenSheets({ home: [], away: [pinned] }, farApart, { away: [pinned.position] })).toEqual({ home: [], away: [] });
  });

  it('lists nothing for nothing', () => {
    expect(shareBetweenSheets({ home: [], away: [] }, farApart)).toEqual({ home: [], away: [] });
  });

  it('lists a spot that both searches found once, with the place it is nearer to', () => {
    const ferryBuilding = spot('Ferry Building', SAN_FRANCISCO, 2, 'San Francisco');
    const santanaRow = spot('Santana Row', SAN_JOSE, 2, 'San Jose');
    const shown = shareBetweenSheets({ home: [santanaRow, ferryBuilding], away: [ferryBuilding, santanaRow] }, neighbours);
    expect(shown).toEqual({ home: [santanaRow], away: [ferryBuilding] });
  });

  it('hands a spot found only by the other place’s search to the place it is nearer to, after that place’s own', () => {
    const pier = spot('Pier 39', SAN_FRANCISCO, 3, 'San Francisco');
    const ferryBuilding = spot('Ferry Building', SAN_FRANCISCO, 2, 'San Francisco');
    const shown = shareBetweenSheets({ home: [pier], away: [ferryBuilding] }, neighbours);
    expect(shown).toEqual({ home: [], away: [ferryBuilding, pier] });
  });

  it('counts a spot just as far from both places as one of Home', () => {
    const halfway: Spot = { name: 'Halfway House', context: '', position: SAN_JOSE };
    expect(shareBetweenSheets({ home: [halfway], away: [halfway] }, { home: SAN_JOSE, away: SAN_JOSE })).toEqual({
      home: [halfway],
      away: [],
    });
  });

  it('keeps two spots of one name that read differently', () => {
    const one = spot('Main Street', SAN_JOSE, 1, 'San Jose');
    const other = spot('Main Street', SAN_JOSE, 9, 'Milpitas');
    expect(shareBetweenSheets({ home: [one, other], away: [] }, neighbours).home).toEqual([one, other]);
  });
});
