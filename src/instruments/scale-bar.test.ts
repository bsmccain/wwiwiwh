import { describe, expect, it } from 'vitest';
import { METERS_PER_MILE } from '../geo/units';
import { planScaleBar } from './scale-bar';

/** Ground scale of a map centred on London at a zoom level. */
const londonScale = (zoom: number) => (78271.517 * Math.cos((51.5073 * Math.PI) / 180)) / 2 ** zoom;

describe('planScaleBar', () => {
  it('draws 0, 5, 10 mi over 0, 5, 10 km across a metro', () => {
    const scale = londonScale(9.6);
    const miles = planScaleBar(scale, 260, 'mi');
    expect(miles?.distance).toMatchObject({ value: 10, unit: 'mi' });
    expect(miles?.segments).toBe(2);
    expect(miles?.ticks).toEqual([
      { at: 0, label: '0' },
      { at: 0.5, label: '5' },
      { at: 1, label: '10' },
    ]);
    expect(miles?.lengthPx).toBeCloseTo((10 * METERS_PER_MILE) / scale, 9);

    const kilometres = planScaleBar(scale, 260, 'km');
    expect(kilometres?.distance).toMatchObject({ value: 10, unit: 'km' });
    expect(kilometres?.ticks.map((tick) => tick.label)).toEqual(['0', '5', '10']);
    // The same ground scale: the kilometre bar is shorter by exactly the ratio of the units.
    expect((miles?.lengthPx ?? 0) / (kilometres?.lengthPx ?? 1)).toBeCloseTo(1.609344, 9);
  });

  it('is the longest round distance that fits, at every zoom', () => {
    for (const units of ['mi', 'km'] as const) {
      for (let zoom = 4; zoom <= 18; zoom += 0.23) {
        for (const room of [96, 150, 260]) {
          const plan = planScaleBar(londonScale(zoom), room, units);
          expect(plan).not.toBeNull();
          if (!plan) continue;
          expect(plan.lengthPx).toBeLessThanOrEqual(room + 1e-6);
          // The next round distance up is at most 2.64 times longer (500 ft to 0.2 mi), and it did not fit.
          expect(plan.lengthPx).toBeGreaterThan(room / 2.65);
          expect(String(plan.distance.value)).toMatch(/^(0\.)?[125]0*$/);
        }
      }
    }
  });

  it('halves a 1 or a 2 and splits a 5 into five, so every numeral is round', () => {
    const two = planScaleBar(londonScale(11.7), 260, 'mi');
    expect(two?.distance).toMatchObject({ value: 2, unit: 'mi' });
    expect(two?.segments).toBe(2);
    expect(two?.ticks.map((tick) => tick.label)).toEqual(['0', '1', '2']);

    const five = planScaleBar(londonScale(10.4), 260, 'mi');
    expect(five?.distance).toMatchObject({ value: 5, unit: 'mi' });
    expect(five?.segments).toBe(5);
    expect(five?.ticks).toEqual([
      { at: 0, label: '0' },
      { at: 1, label: '5' },
    ]);

    const fifty = planScaleBar(londonScale(7.3), 260, 'km');
    expect(fifty?.distance).toMatchObject({ value: 50, unit: 'km' });
    expect(fifty?.segments).toBe(5);
  });

  it('letters small and large distances the way a sign would', () => {
    const feet = planScaleBar(londonScale(17.5), 260, 'mi');
    expect(feet?.distance).toMatchObject({ value: 200, unit: 'ft' });
    expect(feet?.ticks.map((tick) => tick.label)).toEqual(['0', '100', '200']);

    const fifthOfMile = planScaleBar(1.3, 260, 'mi');
    expect(fifthOfMile?.distance).toMatchObject({ value: 0.2, unit: 'mi' });
    expect(fifthOfMile?.ticks.map((tick) => tick.label)).toEqual(['0', '0.1', '0.2']);

    const halfMile = planScaleBar(4, 260, 'mi');
    expect(halfMile?.distance).toMatchObject({ value: 0.5, unit: 'mi' });
    expect(halfMile?.segments).toBe(5);
    expect(halfMile?.ticks.map((tick) => tick.label)).toEqual(['0', '0.5']);

    const metres = planScaleBar(londonScale(16), 260, 'km');
    expect(metres?.distance).toMatchObject({ value: 100, unit: 'm' });
    expect(metres?.ticks.map((tick) => tick.label)).toEqual(['0', '50', '100']);

    const continent = planScaleBar(4892, 260, 'km');
    expect(continent?.distance).toMatchObject({ value: 1000, unit: 'km' });
    expect(continent?.ticks.map((tick) => tick.label)).toEqual(['0', '500', '1,000']);
  });

  it('has nothing to draw without room or without a scale', () => {
    expect(planScaleBar(londonScale(10), 0, 'mi')).toBeNull();
    expect(planScaleBar(londonScale(10), -40, 'km')).toBeNull();
    expect(planScaleBar(0, 260, 'km')).toBeNull();
    expect(planScaleBar(Number.NaN, 260, 'mi')).toBeNull();
    expect(planScaleBar(0.001, 260, 'km')).toBeNull();
  });
});
