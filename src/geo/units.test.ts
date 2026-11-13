import { describe, expect, it } from 'vitest';
import {
  METERS_PER_FOOT,
  METERS_PER_MILE,
  defaultUnits,
  formatDistance,
  formatFigure,
  formatRoundDistance,
  longestRoundDistance,
  planRings,
} from './units';

describe('formatDistance', () => {
  it('formats miles the way people say them', () => {
    expect(formatDistance(30, 'mi')).toBe('98 ft');
    expect(formatDistance(200, 'mi')).toBe('660 ft');
    expect(formatDistance(0.4 * METERS_PER_MILE, 'mi')).toBe('0.4 mi');
    expect(formatDistance(METERS_PER_MILE, 'mi')).toBe('1 mi');
    expect(formatDistance(12.54 * METERS_PER_MILE, 'mi')).toBe('12.5 mi');
    expect(formatDistance(99.96 * METERS_PER_MILE, 'mi')).toBe('100 mi');
    expect(formatDistance(1234.4 * METERS_PER_MILE, 'mi')).toBe('1,234 mi');
  });

  it('formats kilometres', () => {
    expect(formatDistance(42, 'km')).toBe('42 m');
    expect(formatDistance(254, 'km')).toBe('250 m');
    expect(formatDistance(996, 'km')).toBe('1 km');
    expect(formatDistance(3240, 'km')).toBe('3.2 km');
    expect(formatDistance(25_000, 'km')).toBe('25 km');
    expect(formatDistance(140_400, 'km')).toBe('140 km');
  });

  it('ignores sign', () => {
    expect(formatDistance(-5000, 'km')).toBe('5 km');
  });
});

describe('formatFigure', () => {
  it('groups thousands and keeps small fractions', () => {
    expect(formatFigure(0)).toBe('0');
    expect(formatFigure(0.2)).toBe('0.2');
    expect(formatFigure(2.5)).toBe('2.5');
    expect(formatFigure(500)).toBe('500');
    expect(formatFigure(1000)).toBe('1,000');
    expect(formatFigure(12_500)).toBe('12,500');
  });
});

describe('defaultUnits', () => {
  it('uses miles only where roads are signed in miles', () => {
    expect(defaultUnits('en-US')).toBe('mi');
    expect(defaultUnits('en-GB')).toBe('mi');
    expect(defaultUnits('es-US')).toBe('mi');
    expect(defaultUnits('en-CA')).toBe('km');
    expect(defaultUnits('de-DE')).toBe('km');
    expect(defaultUnits('ja')).toBe('km');
    expect(defaultUnits(undefined)).toBe('km');
    expect(defaultUnits('zh-Hans-US')).toBe('mi');
  });
});

describe('longestRoundDistance', () => {
  it('snaps down to 1, 2 or 5 times a power of ten of the unit', () => {
    expect(longestRoundDistance(12 * METERS_PER_MILE, 'mi')).toMatchObject({ value: 10, unit: 'mi' });
    expect(longestRoundDistance(19.9 * METERS_PER_MILE, 'mi')).toMatchObject({ value: 10, unit: 'mi' });
    expect(longestRoundDistance(20 * METERS_PER_MILE, 'mi')).toMatchObject({ value: 20, unit: 'mi' });
    expect(longestRoundDistance(7400, 'km')).toMatchObject({ value: 5, unit: 'km', meters: 5000 });
    expect(longestRoundDistance(1_250_000, 'km')).toMatchObject({ value: 1000, unit: 'km' });
  });

  it('hands over from feet to miles and from metres to kilometres', () => {
    expect(longestRoundDistance(0.19 * METERS_PER_MILE, 'mi')).toMatchObject({ value: 500, unit: 'ft' });
    expect(longestRoundDistance(0.2 * METERS_PER_MILE, 'mi')).toMatchObject({ value: 0.2, unit: 'mi' });
    expect(longestRoundDistance(0.7 * METERS_PER_MILE, 'mi')).toMatchObject({ value: 0.5, unit: 'mi' });
    expect(longestRoundDistance(999, 'km')).toMatchObject({ value: 500, unit: 'm' });
    expect(longestRoundDistance(1000, 'km')).toMatchObject({ value: 1, unit: 'km' });
  });

  it('accepts a distance that falls short of a round one only by a rounding hair', () => {
    expect(longestRoundDistance(50 * (1 - 1e-12), 'km')).toMatchObject({ value: 50, unit: 'm' });
    expect(longestRoundDistance(500 * METERS_PER_FOOT * (1 - 1e-12), 'mi')).toMatchObject({ value: 500, unit: 'ft' });
    expect(longestRoundDistance(50 * (1 - 1e-6), 'km')).toMatchObject({ value: 20, unit: 'm' });
  });

  it('has nothing shorter than one foot or one metre', () => {
    expect(longestRoundDistance(0.2, 'mi')).toBeNull();
    expect(longestRoundDistance(0.9, 'km')).toBeNull();
    expect(longestRoundDistance(0, 'km')).toBeNull();
    expect(longestRoundDistance(Number.NaN, 'km')).toBeNull();
  });
});

describe('formatRoundDistance', () => {
  it('letters a round distance the way formatDistance would', () => {
    for (const units of ['mi', 'km'] as const) {
      for (const meters of [3, 40, 170, 400, 900, 1700, 9000, 40_000, 170_000, 900_000, 4_000_000]) {
        const round = longestRoundDistance(meters, units);
        expect(round).not.toBeNull();
        if (round) expect(formatRoundDistance(round)).toBe(formatDistance(round.meters, units));
      }
    }
    expect(formatRoundDistance({ meters: 0.2 * METERS_PER_MILE, value: 0.2, unit: 'mi' })).toBe('0.2 mi');
    expect(formatRoundDistance({ meters: 2_000_000, value: 2000, unit: 'km' })).toBe('2,000 km');
  });

  it('letters the same distance the same way every time it is asked', () => {
    const round = longestRoundDistance(1_250_000, 'km');
    expect(round).not.toBeNull();
    if (!round) return;
    expect(formatRoundDistance(round)).toBe('1,000 km');
    expect(formatRoundDistance(round)).toBe('1,000 km');
    // A distance that happens to equal a rung of the other ladder is still lettered in its own unit.
    expect(formatRoundDistance({ ...round, unit: 'm' })).toBe('1,000 m');
  });
});

describe('planRings', () => {
  const labels = (metersPerPixel: number, reach: number, units: 'mi' | 'km', minPixels = 0) =>
    planRings(metersPerPixel, reach, units, { minPixels }).map(formatRoundDistance);

  it('draws 5, 10 and 20 mi across a metro and 1, 2 and 5 closer in', () => {
    // London at zoom 9.2 is about 83 m/px: 400 px of reach is 20.6 mi.
    expect(labels(83, 400, 'mi')).toEqual(['5 mi', '10 mi', '20 mi']);
    // Zoom 11.2 is about 20.7 m/px: 400 px of reach is 5.1 mi.
    expect(labels(20.7, 400, 'mi')).toEqual(['1 mi', '2 mi', '5 mi']);
    expect(labels(83, 400, 'km')).toEqual(['5 km', '10 km', '20 km']);
  });

  it('keeps the largest ring within reach, innermost first', () => {
    for (const units of ['mi', 'km'] as const) {
      for (let zoom = 4; zoom <= 18; zoom += 0.37) {
        const metersPerPixel = (78271.517 * Math.cos((51.5 * Math.PI) / 180)) / 2 ** zoom;
        for (const reach of [181, 390, 520]) {
          const rings = planRings(metersPerPixel, reach, units);
          expect(rings).toHaveLength(3);
          const radii = rings.map((ring) => ring.meters / metersPerPixel);
          expect(radii[2]).toBeLessThanOrEqual(reach + 1e-6);
          // The next round distance up would not fit: the largest ring uses at least 40% of the reach.
          expect(radii[2]).toBeGreaterThan(reach * 0.4 - 1e-6);
          expect(radii[0]).toBeLessThan(radii[1] as number);
          expect(radii[1]).toBeLessThan(radii[2] as number);
        }
      }
    }
  });

  it('crosses from feet into miles and from metres into kilometres', () => {
    expect(labels(1, 400, 'mi')).toEqual(['200 ft', '500 ft', '0.2 mi']);
    expect(labels(2.1, 400, 'mi')).toEqual(['500 ft', '0.2 mi', '0.5 mi']);
    expect(labels(3, 400, 'km')).toEqual(['200 m', '500 m', '1 km']);
    expect(labels(0.19, 181, 'km')).toEqual(['5 m', '10 m', '20 m']);
    expect(labels(4892, 500, 'km')).toEqual(['500 km', '1,000 km', '2,000 km']);
  });

  it('leaves out rings that would sit on the pin', () => {
    // 5 mi is 97 px here, so 1 mi is 19 px and 2 mi is 39 px.
    expect(labels(83, 100, 'mi')).toEqual(['1 mi', '2 mi', '5 mi']);
    expect(labels(83, 100, 'mi', 24)).toEqual(['2 mi', '5 mi']);
  });

  it('draws fewer rings when asked, and none in a degenerate view', () => {
    expect(planRings(83, 400, 'mi', { count: 2 }).map(formatRoundDistance)).toEqual(['10 mi', '20 mi']);
    expect(planRings(0, 400, 'km')).toEqual([]);
    expect(planRings(50, 0, 'mi')).toEqual([]);
    expect(planRings(Number.NaN, 400, 'mi')).toEqual([]);
    expect(planRings(0.001, 100, 'km')).toEqual([]);
  });
});
