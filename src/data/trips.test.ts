import { describe, expect, it } from 'vitest';
import { presetPlace } from '../app/defaults';
import { METROS } from './metros';
import { DEFAULT_TRIPS, defaultTripFor } from './trips';
import { distanceMeters } from '../geo/distance';

/** The presets people most often call Home, each with the town its familiar trip starts from. */
const EXPECTED_STARTS: Readonly<Record<string, string>> = {
  'san-jose': 'Palo Alto',
  'san-francisco': 'Berkeley',
  oakland: 'Walnut Creek',
  'los-angeles': 'Santa Monica',
  'san-diego': 'La Jolla',
  seattle: 'Redmond',
  portland: 'Hillsboro',
  chicago: 'Evanston',
  'new-york': 'Newark',
  boston: 'Salem',
  washington: 'Rockville',
  london: 'Watford',
  paris: 'Versailles',
  tokyo: 'Yokohama',
};

describe('default trips', () => {
  it('cover exactly the presets they were curated for', () => {
    const starts = Object.fromEntries(Object.entries(DEFAULT_TRIPS).map(([id, trip]) => [id, trip.fromName]));
    expect(starts).toEqual(EXPECTED_STARTS);
  });

  it('end at the exact centre of their preset, under its name', () => {
    for (const [id, trip] of Object.entries(DEFAULT_TRIPS)) {
      const metro = METROS.find((candidate) => candidate.id === id);
      expect(metro, id).toBeDefined();
      expect(trip.to, id).toEqual({ lat: metro?.lat, lng: metro?.lng });
      expect(trip.toName, id).toBe(metro?.name);
    }
  });

  it('are long enough to be a yardstick and short enough to stay in the metro', () => {
    for (const [id, trip] of Object.entries(DEFAULT_TRIPS)) {
      const km = Number((distanceMeters(trip.from, trip.to) / 1000).toFixed(1));
      expect(km, id).toBeGreaterThanOrEqual(15);
      expect(km, id).toBeLessThanOrEqual(40);
    }
  });

  it('are found through the place that is used as Home', () => {
    const sanJose = presetPlace('san-jose');
    expect(sanJose && defaultTripFor(sanJose)?.fromName).toBe('Palo Alto');
    expect(defaultTripFor({ name: 'San Jose', context: 'Costa Rica', center: { lat: 9.93274, lng: -84.07967 } })).toBeNull();
    const berlin = presetPlace('berlin');
    expect(berlin && defaultTripFor(berlin)).toBeNull();
  });
});
