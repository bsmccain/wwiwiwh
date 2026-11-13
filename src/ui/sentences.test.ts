import { describe, expect, it } from 'vitest';
import { centeredRegistration, presetPlace } from '../app/defaults';
import { spansToText, type NearbyPlace } from '../app/readout';
import type { Drive, Place, RouteFinding, Trip } from '../app/types';
import { defaultTripFor } from '../data/trips';
import { destination, distanceMeters } from '../geo/distance';
import { driveSpans, pinSpans, pinSpot, sameSpans, sameWords, spotLabel, spotWords, tripSpans, type NearestLookup, type Scene } from './sentences';

const sanJose = presetPlace('san-jose') as Place;
const london = presetPlace('london') as Place;
const watford = { lat: 51.6554, lng: -0.3957 };

const scene: Scene = {
  home: sanJose,
  away: london,
  registration: centeredRegistration(sanJose, london),
  trip: defaultTripFor(sanJose) as Trip,
  units: 'mi',
};

/** A plate that knows Watford on Away and Cupertino on Home, and nothing else. */
const nearest: NearestLookup = (sheet, at) => {
  const known = sheet === 'away' ? { name: 'Watford', position: watford } : { name: 'Cupertino', position: { lat: 37.323, lng: -122.0322 } };
  const place: NearbyPlace = { name: known.name, distanceMeters: distanceMeters(known.position, at), bearingDeg: 0 };
  return place.distanceMeters < 40_000 ? place : null;
};
const nothingKnown: NearestLookup = () => null;

describe('the pin sentence', () => {
  it('names both centres when Home is pinned centre on centre', () => {
    const spans = pinSpans(scene, nothingKnown);
    expect(spans && spansToText(spans)).toBe('Downtown San Jose sits on central London.');
    expect(spans?.map((span) => span.ink)).toEqual(['home', undefined, 'away', undefined]);
  });

  it('names the nearest places once the pin has moved off the centres', () => {
    const registration = { overlayAnchor: { lat: 37.323, lng: -122.0322 }, baseAnchor: watford, rotation: 0 };
    const spans = pinSpans({ ...scene, registration }, nearest);
    expect(spans && spansToText(spans)).toBe('Cupertino sits on Watford.');
  });

  it('has nothing to say while a spot has no name', () => {
    const registration = { ...scene.registration, baseAnchor: destination(london.center, 0, 30_000) };
    expect(pinSpans({ ...scene, registration }, nothingKnown)).toBeNull();
  });
});

describe('a spot under the pin, in words of its own', () => {
  const offCentre = { overlayAnchor: destination(sanJose.center, 0, 3000), baseAnchor: destination(watford, 90, 3000), rotation: 0 };

  it('reads as the pin sentence has it: after "on", and at the start of a sentence', () => {
    const home = pinSpot(scene, 'home', nothingKnown);
    const away = pinSpot(scene, 'away', nothingKnown);
    expect(home && spotLabel(home)).toBe('Downtown San Jose');
    expect(away && spotWords(away)).toBe('central London');
    expect(away && spotLabel(away)).toBe('Central London');
  });

  it('is "a spot" where it can only be placed, not named', () => {
    const away = pinSpot({ ...scene, registration: offCentre }, 'away', nearest);
    expect(away && spotWords(away)).toBe('a spot near Watford');
    expect(away && spotLabel(away)).toBe('A spot near Watford');
  });

  it('goes by the name it was given for as long as the pin stays on it', () => {
    const named: Scene = { ...scene, spots: { home: null, away: { name: '10 Downing Street', at: london.center } } };
    const away = pinSpot(named, 'away', nothingKnown);
    expect(away && spotWords(away)).toBe('10 Downing Street');
    const slid = pinSpot({ ...named, registration: { ...scene.registration, baseAnchor: watford } }, 'away', nearest);
    expect(slid && spotWords(slid)).toBe('Watford');
  });

  it('is the same words only when it reads the same', () => {
    const away = pinSpot(scene, 'away', nothingKnown);
    expect(sameWords(away, pinSpot(scene, 'away', nothingKnown))).toBe(true);
    expect(sameWords(away, pinSpot({ ...scene, registration: offCentre }, 'away', nearest))).toBe(false);
    expect(sameWords(away, null)).toBe(false);
    expect(sameWords(null, null)).toBe(true);
    expect(sameWords({ text: 'Watford', exact: true }, { text: 'Watford', exact: false })).toBe(false);
  });
});

describe('the trip sentence', () => {
  it('uses the names a curated trip carries and names where it lands on Away', () => {
    const spans = tripSpans(scene, nearest);
    expect(spans && spansToText(spans)).toMatch(
      /^Palo Alto to San Jose is \d+(\.\d)? mi \(\d+(\.\d)? km\) in a straight line\. Laid on London, that runs from .*Watford to central London\.$/,
    );
  });

  it('names the ends of a hand-drawn trip from the nearest places on Home', () => {
    const trip: Trip = { from: { lat: 37.323, lng: -122.0322 }, to: sanJose.center };
    const spans = tripSpans({ ...scene, trip }, nearest);
    expect(spans && spansToText(spans)).toMatch(/^Cupertino to downtown San Jose is /);
  });

  it('gives only the length when the ends cannot be named', () => {
    const trip: Trip = { from: destination(sanJose.center, 90, 60_000), to: destination(sanJose.center, 90, 80_000) };
    const spans = tripSpans({ ...scene, trip, units: 'km' }, nothingKnown);
    expect(spans && spansToText(spans)).toBe('This line is 20 km (12.4 mi) in a straight line.');
  });

  it('follows Home when it is slid: the same trip lands somewhere else on Away', () => {
    const slid = { ...scene.registration, baseAnchor: watford };
    const spans = tripSpans({ ...scene, registration: slid }, nearest);
    expect(spans && spansToText(spans)).toMatch(/to Watford\.$/);
  });

  it('calls a line whose two ends go by the same words "This line"', () => {
    const cupertino = { lat: 37.323, lng: -122.0322 };
    const trip: Trip = { from: destination(cupertino, 90, 2000), to: destination(cupertino, 270, 2000) };
    const spans = tripSpans({ ...scene, trip }, nearest);
    expect(spans && spansToText(spans)).toMatch(/^This line is /);
  });

  it('is absent without a trip', () => {
    expect(tripSpans({ ...scene, trip: null }, nearest)).toBeNull();
  });

  describe('in short, for small screens', () => {
    it('gives one unit and keeps the names a curated trip carries', () => {
      const spans = tripSpans(scene, nearest, true);
      expect(spans && spansToText(spans)).toMatch(/^Palo Alto to San Jose is \d+(\.\d)? mi in a straight line\. On London: .*Watford to central London\.$/);
    });

    it('keeps the ends of a hand-drawn trip that fall on named places', () => {
      const trip: Trip = { from: { lat: 37.323, lng: -122.0322 }, to: sanJose.center };
      const spans = tripSpans({ ...scene, trip }, nearest, true);
      expect(spans && spansToText(spans)).toMatch(/^Cupertino to downtown San Jose is /);
    });

    it('calls a trip between unnamed spots "This line" and spends the words on where it lands', () => {
      const trip: Trip = { from: destination({ lat: 37.323, lng: -122.0322 }, 0, 3000), to: sanJose.center };
      const short = tripSpans({ ...scene, trip }, nearest, true);
      expect(short && spansToText(short)).toMatch(/^This line is \d+(\.\d)? mi in a straight line\. On London: .+ to central London\.$/);
      // The full wording still places both ends on Home.
      const full = tripSpans({ ...scene, trip }, nearest);
      expect(full && spansToText(full)).toMatch(/^From near Cupertino to downtown San Jose is /);
    });
  });
});

describe('the drive in words', () => {
  const cupertino = { lat: 37.323, lng: -122.0322 };
  const found: RouteFinding = { status: 'found', route: { meters: 16_000, seconds: 900, line: [] } };
  const drive: Drive = { on: 'home', from: cupertino, to: sanJose.center, match: 'time' };
  const driven: Scene = { ...scene, trip: null, drive, route: found, reach: { status: 'found', outline: [] } };

  it('is absent without a drive', () => {
    expect(driveSpans(scene, nearest)).toBeNull();
  });

  it('names the ends by what is near them, and the spot on Away that the start lands on', () => {
    const spans = driveSpans(driven, nearest);
    // Cupertino lies west of downtown San Jose, so with centre pinned on centre it lands west of central London.
    expect(spans && spansToText(spans)).toMatch(
      /^Cupertino to downtown San Jose is 9\.9 mi \(16 km\) by road, about 15 min\. Driving that long from .+ reaches the shaded part of London\.$/,
    );
  });

  it('prefers the names the ends were picked by', () => {
    const named: Drive = { ...drive, fromName: 'My old house', toName: 'School' };
    const spans = driveSpans({ ...driven, drive: named }, nearest);
    expect(spans && spansToText(spans)).toMatch(/^My old house to School is /);
  });

  it('follows Home when it is slid: the same drive starts its reach somewhere else on Away', () => {
    // Cupertino itself is put on Watford.
    const slid = { overlayAnchor: cupertino, baseAnchor: watford, rotation: 0 };
    const spans = driveSpans({ ...driven, registration: slid }, nearest);
    expect(spans && spansToText(spans)).toMatch(/Driving that long from Watford reaches the shaded part of London\.$/);
  });

  it('reads a drive on Away the other way round: its ends on Away, its reach on Home', () => {
    const onAway: Drive = { on: 'away', from: watford, to: london.center, match: 'distance' };
    const pinned = { overlayAnchor: cupertino, baseAnchor: watford, rotation: 0 };
    const spans = driveSpans({ ...driven, drive: onAway, registration: pinned }, nearest);
    expect(spans && spansToText(spans)).toMatch(/^Watford to central London is .* Driving that far from Cupertino reaches the shaded part of San Jose\.$/);
    expect(spans?.filter((span) => span.ink === 'home' || span.ink === 'away').map((span) => span.ink)).toEqual(['away', 'home']);
  });

  it('says it is finding the road until the road service has answered', () => {
    const asked = driveSpans({ ...driven, route: null, reach: null }, nearest);
    expect(asked && spansToText(asked)).toBe('Finding the road from Cupertino to downtown San Jose…');
  });

  it('calls a drive whose two ends go by the same words "This drive"', () => {
    const short: Drive = { ...drive, from: destination(cupertino, 90, 2000), to: destination(cupertino, 270, 2000) };
    const spans = driveSpans({ ...driven, drive: short }, nearest);
    expect(spans && spansToText(spans)).toMatch(/^This drive is /);
  });

  it('in short, names the ends only when both have names of their own', () => {
    const placed: Drive = { ...drive, from: destination(cupertino, 0, 3000) };
    const short = driveSpans({ ...driven, drive: placed }, nearest, true);
    expect(short && spansToText(short)).toMatch(/^This drive is 9\.9 mi by road, about 15 min\. Shaded on London: that long from .+\.$/);
    const full = driveSpans({ ...driven, drive: placed }, nearest);
    expect(full && spansToText(full)).toMatch(/^From near Cupertino to downtown San Jose is /);
  });
});

describe('comparing sentences', () => {
  it('tells apart text, ink and absence', () => {
    expect(sameSpans(null, null)).toBe(true);
    expect(sameSpans(null, [])).toBe(false);
    expect(sameSpans([{ text: 'a', ink: 'home' }], [{ text: 'a', ink: 'home' }])).toBe(true);
    expect(sameSpans([{ text: 'a', ink: 'home' }], [{ text: 'a', ink: 'away' }])).toBe(false);
    expect(sameSpans([{ text: 'a' }], [{ text: 'a' }, { text: 'b' }])).toBe(false);
  });
});
