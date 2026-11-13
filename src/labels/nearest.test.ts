import { describe, expect, it } from 'vitest';
import { destination } from '../geo/distance';
import type { LngLat } from '../geo/types';
import type { PlaceCandidate, PlaceClass } from './candidates';
import { nameCarries, nearestPlace, NAMING_REACH_METERS } from './nearest';

const HERE: LngLat = { lng: -0.3957, lat: 51.6554 };

/** A place `meters` away from HERE in the given compass direction. */
function place(name: string, placeClass: PlaceClass, meters: number, bearing = 90, rank = 12): PlaceCandidate {
  return { id: name, name, placeClass, rank, position: destination(HERE, bearing, meters) };
}

describe('nearestPlace', () => {
  it('names a spot after the only place around', () => {
    const found = nearestPlace([place('Watford', 'town', 700)], HERE);
    expect(found?.name).toBe('Watford');
    expect(found?.distanceMeters).toBeCloseTo(700, 0);
  });

  it('prefers a town 1.2 km away to a hamlet 900 m away', () => {
    const found = nearestPlace([place('Tiny', 'hamlet', 900), place('Town', 'town', 1200)], HERE);
    expect(found?.name).toBe('Town');
  });

  it('prefers a town 2.5 km away to a village 1.2 km away', () => {
    const found = nearestPlace([place('Hill End', 'village', 1200), place('Bushey', 'town', 2500, 200)], HERE);
    expect(found?.name).toBe('Bushey');
  });

  it('prefers a city centre 2.5 km away to a suburb 1 km away', () => {
    const city = place('London', 'city', 2500, 180, 1);
    expect(nearestPlace([place('Suburbia', 'suburb', 1000), city], HERE)?.name).toBe('London');
    expect(nearestPlace([place('Village', 'village', 1000), city], HERE)?.name).toBe('London');
    expect(nearestPlace([place('Tiny', 'hamlet', 600), city], HERE)?.name).toBe('London');
  });

  it('still names the spot after a small place when standing in the middle of it', () => {
    const city = place('London', 'city', 2500, 180, 1);
    expect(nearestPlace([place('Tiny', 'hamlet', 150), city], HERE)?.name).toBe('Tiny');
    expect(nearestPlace([place('Soho', 'suburb', 300), city], HERE)?.name).toBe('Soho');
  });

  it('does not let a far city swallow a town at hand', () => {
    const city = place('London', 'city', 9000, 180, 1);
    expect(nearestPlace([place('Watford', 'town', 2500), city], HERE)?.name).toBe('Watford');
  });

  it('takes the nearer of two places of the same kind', () => {
    const found = nearestPlace([place('Far', 'town', 3000), place('Near', 'town', 2000), place('Farther', 'town', 5000)], HERE);
    expect(found?.name).toBe('Near');
  });

  it('gives a world city more pull than a ward that is also classed as a city', () => {
    expect(nameCarries({ placeClass: 'city', rank: 1 })).toBeGreaterThan(nameCarries({ placeClass: 'city', rank: 14 }));
    const ward = place('Westminster', 'city', 1900, 0, 12);
    const centre = place('London', 'city', 2200, 180, 1);
    expect(nearestPlace([ward, centre], HERE)?.name).toBe('London');
  });

  it('lets the bigger place name a spot that two places share exactly', () => {
    const quarter: PlaceCandidate = { id: 'q', name: 'Westminster quarter', placeClass: 'quarter', rank: 41, position: HERE };
    const city: PlaceCandidate = { id: 'c', name: 'Westminster', placeClass: 'city', rank: 12, position: HERE };
    expect(nearestPlace([quarter, city], HERE)?.name).toBe('Westminster');
    expect(nearestPlace([city, quarter], HERE)?.name).toBe('Westminster');
  });

  it('gives the bearing from the place to the spot', () => {
    // The place lies to the east of the spot, so the spot is west of the place.
    expect(nearestPlace([place('East', 'town', 3000, 90)], HERE)?.bearingDeg).toBeCloseTo(270, 0);
    expect(nearestPlace([place('South', 'town', 3000, 180)], HERE)?.bearingDeg).toBeCloseTo(0, 0);
    expect(nearestPlace([place('North-west', 'town', 3000, 315)], HERE)?.bearingDeg).toBeCloseTo(135, 0);
  });

  it('hands back the position of the place it named', () => {
    const town = place('Watford', 'town', 700);
    expect(nearestPlace([town], HERE)?.position).toBe(town.position);
  });

  it('knows no name for a spot further than 40 km from every place', () => {
    expect(NAMING_REACH_METERS).toBe(40_000);
    expect(nearestPlace([], HERE)).toBeNull();
    expect(nearestPlace([place('Far', 'city', 41_000, 45, 1)], HERE)).toBeNull();
    expect(nearestPlace([place('Just', 'city', 39_000, 45, 1)], HERE)?.name).toBe('Just');
    expect(nearestPlace([place('East', 'city', 39_500, 90, 1)], HERE)?.name).toBe('East');
    expect(nearestPlace([place('North', 'city', 39_500, 0, 1)], HERE)?.name).toBe('North');
  });

  it('finds a place across the antimeridian', () => {
    const spot: LngLat = { lng: 179.99, lat: -16.8 };
    const across: PlaceCandidate = { id: 't', name: 'Taveuni', placeClass: 'town', rank: 11, position: { lng: -179.99, lat: -16.8 } };
    const found = nearestPlace([across], spot);
    expect(found?.name).toBe('Taveuni');
    expect(found?.distanceMeters).toBeLessThan(3000);
  });
});
