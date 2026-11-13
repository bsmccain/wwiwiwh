import { describe, expect, it } from 'vitest';
import type { ScreenPoint } from '../map/contracts';
import { driveFigures, ringPath } from './drive';
import { pointAtAngle } from './geometry';

describe('driveFigures', () => {
  it('gives the distance and the time of a drive that was found, and nothing until then', () => {
    const route = { status: 'found', route: { meters: 27_963, seconds: 1338, line: [] } } as const;
    expect(driveFigures(route, 'mi')).toBe('17.4 mi · 22 min');
    expect(driveFigures(route, 'km')).toBe('28 km · 22 min');
    expect(driveFigures({ status: 'finding' }, 'mi')).toBe('');
    expect(driveFigures(null, 'mi')).toBe('');
  });
});

describe('ringPath', () => {
  const CENTER: ScreenPoint = { x: -4000, y: 300 };
  const RADIUS = 5000;
  const PERIOD_PX = 13;
  /** The angle one dash and its gap take up on this ring, in degrees. */
  const PERIOD = (PERIOD_PX / RADIUS / Math.PI) * 180;

  /** Every point the path names: where each stretch starts, its middle, and where it ends. */
  function points(path: string): ScreenPoint[] {
    return [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)(?=A|M|$)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  }

  /** How far round the ring a point is, in degrees clockwise from straight up. */
  const angleOf = (point: ScreenPoint): number => (Math.atan2(point.x - CENTER.x, CENTER.y - point.y) / Math.PI) * 180;

  it('draws each stretch as an arc of the ring, clockwise, ending where the stretch ends', () => {
    const path = ringPath(CENTER, RADIUS, [{ from: 70, to: 100 }], PERIOD_PX);
    expect(path).toMatch(/^M\S+ \S+A5000\.00 5000\.00 0 0 1 \S+ \S+A5000\.00 5000\.00 0 0 1 \S+ \S+$/);
    const [start, middle, end] = points(path);
    if (!start || !middle || !end) throw new Error('The path names fewer than three points.');
    for (const point of [start, middle, end]) expect(Math.hypot(point.x - CENTER.x, point.y - CENTER.y)).toBeCloseTo(RADIUS, 1);
    expect(angleOf(middle)).toBeGreaterThan(angleOf(start));
    expect(angleOf(end)).toBeCloseTo(100, 2);
    const there = pointAtAngle(CENTER, RADIUS, 100);
    expect(end.x).toBeCloseTo(there.x, 1);
    expect(end.y).toBeCloseTo(there.y, 1);
  });

  it('starts every stretch on a whole dash from the top of the ring, no further back than one dash', () => {
    for (const from of [70, 70.05, 83.21, 99]) {
      const [start] = points(ringPath(CENTER, RADIUS, [{ from, to: 100 }], PERIOD_PX));
      if (!start) throw new Error('The path names no point.');
      const dashes = angleOf(start) / PERIOD;
      expect(Math.abs(dashes - Math.round(dashes))).toBeLessThan(0.01);
      expect(angleOf(start)).toBeLessThanOrEqual(from + 1e-3);
      expect(angleOf(start)).toBeGreaterThan(from - PERIOD - 1e-3);
    }
  });

  it('keeps the dashes where they are while the visible stretch slides along the ring', () => {
    // Two frames of a pan: the stretch in sight begins a little further round, within the same dash.
    const whole = Math.ceil(70 / PERIOD) * PERIOD;
    const before = ringPath(CENTER, RADIUS, [{ from: whole + PERIOD * 0.2, to: 100 }], PERIOD_PX);
    const after = ringPath(CENTER, RADIUS, [{ from: whole + PERIOD * 0.7, to: 100 }], PERIOD_PX);
    expect(points(after)[0]).toEqual(points(before)[0]);
  });

  it('draws a whole ring in two halves, and several stretches one after another', () => {
    const whole = points(ringPath({ x: 500, y: 400 }, 100, [{ from: 0, to: 360 }], PERIOD_PX));
    expect(whole).toEqual([
      { x: 500, y: 300 },
      { x: 500, y: 500 },
      { x: 500, y: 300 },
    ]);
    expect(ringPath(CENTER, RADIUS, [{ from: 70, to: 80 }, { from: 95, to: 100 }], PERIOD_PX).match(/M/g)).toHaveLength(2);
    expect(ringPath(CENTER, RADIUS, [], PERIOD_PX)).toBe('');
  });
});
