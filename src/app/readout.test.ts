import { describe, expect, it } from 'vitest';
import { destination } from '../geo/distance';
import { presetPlace } from './defaults';
import {
  bothUnits,
  centerName,
  compassWord,
  describeSpot,
  driveSentence,
  isTurned,
  namedSpot,
  pageTitle,
  pinSentence,
  spansToText,
  tripSentence,
  turnWords,
  turnWordsSpoken,
  type DriveWords,
  type Spot,
} from './readout';
import type { Place, RouteFinding } from './types';

const sanJose = presetPlace('san-jose') as Place;
const london = presetPlace('london') as Place;
const custom: Place = { name: 'Stanford', context: '', center: { lat: 37.4275, lng: -122.1697 } };

describe('describing a spot', () => {
  it('names the centre of a preset the way locals do', () => {
    expect(centerName(sanJose)).toBe('downtown San Jose');
    expect(centerName(london)).toBe('central London');
    expect(centerName(custom)).toBe('Stanford');
    expect(describeSpot(london.center, london, null, 'mi')).toEqual({ text: 'central London', exact: true });
    expect(
      describeSpot(destination(london.center, 90, 300), london, { name: 'Soho', distanceMeters: 50, bearingDeg: 0 }, 'mi'),
    ).toEqual({ text: 'central London', exact: true });
  });

  it('grades nearness into the place, near the place, and a distance with a direction', () => {
    const far = destination(london.center, 315, 25_000);
    expect(describeSpot(far, london, { name: 'Watford', distanceMeters: 500, bearingDeg: 10 }, 'mi')).toEqual({
      text: 'Watford',
      exact: true,
    });
    expect(describeSpot(far, london, { name: 'Watford', distanceMeters: 3000, bearingDeg: 10 }, 'mi')).toEqual({
      text: 'near Watford',
      exact: false,
    });
    expect(describeSpot(far, london, { name: 'Watford', distanceMeters: 6437, bearingDeg: 320 }, 'mi')?.text).toBe(
      '4 mi north-west of Watford',
    );
    expect(describeSpot(far, london, { name: 'Watford', distanceMeters: 6437, bearingDeg: 320 }, 'km')?.text).toBe(
      '6.4 km north-west of Watford',
    );
    expect(describeSpot(far, london, null, 'mi')).toBeNull();
  });

  it('does not call a spot inside the city "near" the city', () => {
    const inTown = destination(london.center, 200, 3000);
    expect(describeSpot(inTown, london, { name: 'London', distanceMeters: 3000, bearingDeg: 200 }, 'mi')?.text).toBe(
      'near central London',
    );
    expect(describeSpot(inTown, london, { name: 'london', distanceMeters: 700, bearingDeg: 200 }, 'mi')).toEqual({
      text: 'central London',
      exact: true,
    });
    const outOfTown = destination(london.center, 200, 9000);
    expect(describeSpot(outOfTown, london, { name: 'London', distanceMeters: 9000, bearingDeg: 200 }, 'km')?.text).toBe(
      '9 km south of central London',
    );
  });

  it('maps bearings onto eight compass words', () => {
    expect([0, 44, 46, 90, 135, 180, 225, 270, 315, 338, 359, -45].map(compassWord)).toEqual([
      'north', 'north-east', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north', 'north-west',
    ]);
  });
});

describe('sentences', () => {
  it('gives distances in both units, the viewer’s first', () => {
    expect(bothUnits(25_400, 'mi')).toBe('15.8 mi (25.4 km)');
    expect(bothUnits(25_400, 'km')).toBe('25.4 km (15.8 mi)');
  });

  const near = (text: string): Spot => ({ text, exact: false });

  it('tells a trip in full', () => {
    const spans = tripSentence({
      meters: 26_900,
      units: 'mi',
      homeFrom: namedSpot('Palo Alto'),
      homeTo: namedSpot('San Jose'),
      awayFrom: near('near Rickmansworth'),
      awayTo: namedSpot('central London'),
      awayName: 'London',
    });
    expect(spansToText(spans)).toBe(
      'Palo Alto to San Jose is 16.7 mi (26.9 km) in a straight line. Laid on London, that runs from near Rickmansworth to central London.',
    );
    expect(spans.filter((s) => s.ink).map((s) => s.ink)).toEqual(['home', 'figure', 'away']);
  });

  it('tells it briefly for a small screen', () => {
    const spans = tripSentence({
      meters: 26_900,
      units: 'mi',
      homeFrom: namedSpot('Palo Alto'),
      homeTo: namedSpot('San Jose'),
      awayFrom: near('near Rickmansworth'),
      awayTo: namedSpot('central London'),
      awayName: 'London',
      compact: true,
    });
    expect(spansToText(spans)).toBe(
      'Palo Alto to San Jose is 16.7 mi in a straight line. On London: near Rickmansworth to central London.',
    );
  });

  it('opens with "From" when the start is only near a named place, and copes with unknown names', () => {
    const base = { meters: 1609.344, units: 'mi' as const, awayName: 'Paris' };
    expect(
      spansToText(
        tripSentence({
          ...base,
          homeFrom: near('near Cupertino'),
          homeTo: namedSpot('downtown San Jose'),
          awayFrom: null,
          awayTo: namedSpot('Versailles'),
        }),
      ),
    ).toBe('From near Cupertino to downtown San Jose is 1 mi (1.6 km) in a straight line.');
    expect(
      spansToText(tripSentence({ ...base, homeFrom: null, homeTo: namedSpot('x'), awayFrom: namedSpot('A'), awayTo: namedSpot('B') })),
    ).toBe('This line is 1 mi (1.6 km) in a straight line. Laid on Paris, that runs from A to B.');
  });

  it('says what the pin holds together, grammatically, whatever is known', () => {
    const say = (home: Spot | null, away: Spot | null) => {
      const spans = pinSentence(home, away);
      return spans && spansToText(spans);
    };
    expect(say(namedSpot('downtown San Jose'), namedSpot('central London'))).toBe('Downtown San Jose sits on central London.');
    expect(say(namedSpot('Palo Alto'), near('near Ealing'))).toBe('Palo Alto sits near Ealing.');
    expect(say(near('near Mountain View'), namedSpot('Watford'))).toBe('A spot near Mountain View sits on Watford.');
    expect(say(near('near Mountain View'), near('near Ealing'))).toBe('A spot near Mountain View sits near Ealing.');
    expect(say(near('4 mi south of Gilroy'), near('2 mi east of Ware'))).toBe('A spot 4 mi south of Gilroy sits 2 mi east of Ware.');
    expect(say(null, namedSpot('central London'))).toBeNull();
    expect(say(namedSpot('Palo Alto'), null)).toBeNull();
  });

  it('words the turn for eyes and for ears', () => {
    expect(turnWords(0)).toBe('not turned');
    expect(turnWords(28.2)).toBe('turned 28° right');
    expect(turnWords(-28)).toBe('turned 28° left');
    expect(turnWords(332)).toBe('turned 28° left');
    expect(turnWords(180)).toBe('turned upside down');
    expect(turnWords(-179.6)).toBe('turned upside down');
    expect(turnWordsSpoken(28)).toBe('turned 28 degrees clockwise');
    expect(turnWordsSpoken(-90)).toBe('turned 90 degrees counterclockwise');
    expect(turnWordsSpoken(1)).toBe('turned 1 degree clockwise');
  });

  it('never reads a slight turn as no turn', () => {
    expect(turnWords(0.4)).toBe('turned 0.4° right');
    expect(turnWords(-0.02)).toBe('turned 0.1° left');
    expect(turnWords(0.96)).toBe('turned 1° right');
    expect(turnWordsSpoken(0.4)).toBe('turned 0.4 degrees clockwise');
    expect(isTurned(0)).toBe(false);
    expect(isTurned(360)).toBe(false);
    expect(isTurned(0.01)).toBe(true);
  });

  it('titles the page after the pair', () => {
    expect(pageTitle(sanJose, london)).toBe('San Jose over London at the same scale | wwiwiwh');
  });
});

describe('the drive sentence', () => {
  const near = (text: string): Spot => ({ text, exact: false });
  const found: RouteFinding = { status: 'found', route: { meters: 27_963, seconds: 1338, line: [] } };
  const drive: DriveWords = {
    on: 'home',
    from: namedSpot('Palo Alto'),
    to: namedSpot('San Jose'),
    route: found,
    reach: { status: 'found', outline: [] },
    match: 'time',
    reachFrom: near('near Rickmansworth'),
    otherName: 'London',
    units: 'mi',
  };
  const say = (words: Partial<DriveWords>): string => spansToText(driveSentence({ ...drive, ...words }));

  it('gives the distance by road, the time, and how far the same time gets on the other place', () => {
    const spans = driveSentence(drive);
    expect(spansToText(spans)).toBe(
      'Palo Alto to San Jose is 17.4 mi (28 km) by road, about 22 min. Driving that long from near Rickmansworth reaches the shaded part of London.',
    );
    expect(spans.filter((s) => s.ink).map((s) => s.ink)).toEqual(['home', 'figure', 'figure', 'away']);
  });

  it('says "that far" when the reach is matched to the distance', () => {
    expect(say({ match: 'distance' })).toMatch(/\. Driving that far from near Rickmansworth reaches the shaded part of London\.$/);
  });

  it('letters a drive on Away in Away’s ink, and the spot its reach starts from in Home’s', () => {
    const spans = driveSentence({ ...drive, on: 'away', from: namedSpot('King’s Cross'), to: namedSpot('Heathrow'), reachFrom: namedSpot('Sunnyvale'), otherName: 'San Jose' });
    expect(spansToText(spans)).toMatch(/^King’s Cross to Heathrow is .* Driving that long from Sunnyvale reaches the shaded part of San Jose\.$/);
    expect(spans.filter((s) => s.ink).map((s) => s.ink)).toEqual(['away', 'figure', 'figure', 'home']);
  });

  it('tells it briefly for a small screen', () => {
    expect(say({ compact: true })).toBe('Palo Alto to San Jose is 17.4 mi by road, about 22 min. Shaded on London: that long from near Rickmansworth.');
  });

  it('says "From" before an end that is only placed, and "This drive" when the ends cannot be named', () => {
    expect(say({ from: near('near Cupertino') })).toMatch(/^From near Cupertino to San Jose is /);
    expect(say({ from: null })).toMatch(/^This drive is 17\.4 mi \(28 km\) by road, about 22 min\./);
  });

  it('starts the reach from "the same spot" when where the start lands has no name', () => {
    expect(say({ reachFrom: null })).toMatch(/Driving that long from the same spot reaches the shaded part of London\.$/);
  });

  it('says it is asking while the road service has not answered', () => {
    expect(say({ route: { status: 'finding' } })).toBe('Finding the road from Palo Alto to San Jose…');
    expect(say({ route: { status: 'finding' }, to: null })).toBe('Finding the road…');
    expect(say({ reach: { status: 'finding' } })).toMatch(/about 22 min\. Working out how far that gets on London…$/);
    expect(say({ reach: null })).toMatch(/about 22 min\. Working out how far that gets on London…$/);
  });

  it('says so when there is no way by road, or the drive is too long to work out', () => {
    expect(say({ route: { status: 'no-road' } })).toBe('No road joins Palo Alto and San Jose.');
    expect(say({ route: { status: 'no-road' }, from: null })).toBe('No road joins these two spots.');
    expect(say({ route: { status: 'too-far' } })).toBe('That drive is too long to work out: the road service stops at 932 mi (1,500 km).');
    expect(say({ route: { status: 'too-far' }, compact: true })).toBe('That drive is too long to work out.');
  });

  it('says so when the road service does not answer, about the drive or about its reach', () => {
    expect(say({ route: { status: 'unavailable' } })).toBe("Directions aren't answering right now. Try again.");
    expect(say({ reach: { status: 'unavailable' } })).toMatch(/about 22 min\. How far that gets on London could not be worked out\. Try again\.$/);
  });

  it('gives the limit when the drive is more than a reach is worked out for', () => {
    expect(say({ reach: { status: 'beyond' } })).toMatch(/\. Nothing is shaded on London: reach is only worked out for drives of up to 60 min\.$/);
    expect(say({ reach: { status: 'beyond' }, match: 'distance' })).toMatch(/drives of up to 62\.1 mi \(100 km\)\.$/);
    expect(say({ reach: { status: 'beyond' }, match: 'distance', units: 'km', compact: true })).toMatch(/\. No reach on London: it is only worked out up to 100 km\.$/);
  });

  it('says so when the start lands where there is no road', () => {
    expect(say({ reach: { status: 'no-road' } })).toMatch(/\. Nothing is shaded on London: there is no road near where it starts there\.$/);
    expect(say({ reach: { status: 'no-road' }, compact: true })).toMatch(/\. No road near its start on London\.$/);
  });
});
