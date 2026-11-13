import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../geo/distance';
import { centeredRegistration, presetPlace } from './defaults';
import {
  DEFAULT_MATCH,
  driveBetween,
  driveOnAway,
  onAway,
  onOtherSheet,
  otherSheet,
  placeDriveEnd,
  reachDetailMeters,
  reachLimitOf,
  startDrive,
} from './drive';
import type { Drive, Place } from './types';

const sanJose = presetPlace('san-jose') as Place;
const london = presetPlace('london') as Place;
const registration = { ...centeredRegistration(sanJose, london), rotation: 30 };
const paloAlto = { lat: 37.4419, lng: -122.143 };
const drive: Drive = { on: 'home', from: paloAlto, to: sanJose.center, match: 'time' };
const route = { meters: 27_963, seconds: 1338, line: [] };

describe('a drive and the other map', () => {
  it('knows which sheet is the other one', () => {
    expect(otherSheet('home')).toBe('away');
    expect(otherSheet('away')).toBe('home');
  });

  it('finds the spot on the other map that is drawn at the same point: there and back is the same spot', () => {
    const landed = onOtherSheet(registration, 'home', paloAlto);
    // Palo Alto is about 26 km from downtown San Jose, so it lands about that far from central London.
    expect(distanceMeters(landed, london.center) / distanceMeters(paloAlto, sanJose.center)).toBeCloseTo(1, 1);
    expect(distanceMeters(onOtherSheet(registration, 'away', landed), paloAlto)).toBeLessThan(0.01);
  });

  it('gives a position on either map as an Away position', () => {
    expect(onAway(registration, 'away', london.center)).toBe(london.center);
    expect(distanceMeters(onAway(registration, 'home', sanJose.center), london.center)).toBeLessThan(0.01);
  });

  it('gives the two ends of a drive as Away positions, whichever map it is on', () => {
    expect(driveOnAway(null, registration)).toEqual([]);
    const [from, to] = driveOnAway(drive, registration);
    expect(distanceMeters(from ?? paloAlto, onOtherSheet(registration, 'home', paloAlto))).toBeLessThan(0.01);
    expect(distanceMeters(to ?? paloAlto, london.center)).toBeLessThan(0.01);
    const onLondon: Drive = { ...drive, on: 'away', from: london.center, to: { lat: 51.47, lng: -0.4543 } };
    expect(driveOnAway(onLondon, registration)).toEqual([onLondon.from, onLondon.to]);
  });
});

describe('setting a drive', () => {
  it('joins two ends on one map, with the names they were picked by', () => {
    expect(driveBetween('away', { at: paloAlto, name: 'Start' }, { at: sanJose.center }, 'distance')).toEqual({
      on: 'away',
      from: paloAlto,
      to: sanJose.center,
      fromName: 'Start',
      match: 'distance',
    });
  });

  it('makes nothing of two ends on the same spot', () => {
    expect(driveBetween('home', { at: paloAlto }, { at: { lat: paloAlto.lat + 0.00005, lng: paloAlto.lng } }, 'time')).toBeNull();
  });

  it('puts down the start with the first press and finishes the drive with the second', () => {
    const fresh = { drive: null, driveSide: 'away', driveDraft: null } as const;
    expect(placeDriveEnd(fresh, { at: london.center })).toEqual({ driveDraft: { at: london.center } });
    const started = { ...fresh, driveDraft: { at: london.center } };
    const heathrow = { lat: 51.47, lng: -0.4543 };
    expect(placeDriveEnd(started, { at: heathrow })).toEqual({
      drive: { on: 'away', from: london.center, to: heathrow, match: DEFAULT_MATCH },
      trip: null,
      tripDraft: null,
      driveSide: 'away',
      driveDraft: null,
      mode: 'browse',
    });
  });

  it('changes nothing when the end is pressed where the start is', () => {
    expect(placeDriveEnd({ drive: null, driveSide: 'home', driveDraft: { at: paloAlto } }, { at: paloAlto })).toBeNull();
  });

  it('keeps matching what the drive before it matched', () => {
    const before = { drive: { ...drive, match: 'distance' }, driveSide: 'home', driveDraft: { at: paloAlto } } as const;
    expect(placeDriveEnd(before, { at: sanJose.center })).toMatchObject({ drive: { match: 'distance' } });
  });

  it('takes the place of a trip, and ends the setting of it', () => {
    expect(startDrive(drive)).toEqual({ drive, trip: null, tripDraft: null, driveSide: 'home', driveDraft: null, mode: 'browse' });
  });
});

describe('what the road service is asked', () => {
  it('draws the reach for as long as the route takes, or as far as it goes', () => {
    expect(reachLimitOf(route, 'time')).toEqual({ by: 'time', minutes: 22.3 });
    expect(reachLimitOf(route, 'distance')).toEqual({ by: 'distance', kilometres: 27.963 });
  });

  it('asks for a coarser outline the longer the drive', () => {
    expect(reachDetailMeters(route)).toBeCloseTo(140, 0);
    expect(reachDetailMeters({ ...route, meters: 2000 })).toBe(10);
  });
});
