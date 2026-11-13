import { describe, expect, it } from 'vitest';
import { destination } from '../geo/distance';
import { presetPlace } from './defaults';
import {
  bothUnits,
  centerName,
  compassWord,
  describeSpot,
  isTurned,
  namedSpot,
  pageTitle,
  pinSentence,
  spansToText,
  tripSentence,
  turnWords,
  turnWordsSpoken,
  type Spot,
} from './readout';
import type { Place } from './types';

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
    expect(pageTitle(sanJose, london)).toBe('San Jose over London at the same scale | mapz');
  });
});
