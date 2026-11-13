import { describe, expect, it } from 'vitest';
import { fromMercator, toMercator } from '../geo/mercator';
import type { LngLat } from '../geo/types';
import {
  distance,
  easeOut,
  fitView,
  gestureKind,
  MOVE_MS,
  nearestWorldCopy,
  offsetHasDrifted,
  panView,
  planMove,
  toInsets,
  wheelZoomChange,
  type FitLimits,
  type StageSize,
} from './engine-math';

const STAGE: StageSize = { width: 1440, height: 900 };
const LONDON: LngLat = { lng: -0.1276, lat: 51.5073 };
const WATFORD: LngLat = { lng: -0.3962, lat: 51.6565 };
const TOKYO: LngLat = { lng: 139.6917, lat: 35.6895 };

const limits = (overrides: Partial<FitLimits> = {}): FitLimits => ({
  padding: toInsets(48, 48),
  minZoom: 4,
  maxZoom: 18,
  zoomWhenPoint: 10,
  ...overrides,
});

/** Where a position lands on a north-up stage showing `view`. */
function project(point: LngLat, view: { center: LngLat; zoom: number }, size: StageSize) {
  const worldPx = 512 * 2 ** view.zoom;
  const c = toMercator(view.center);
  const p = toMercator(point);
  return { x: (p.x - c.x) * worldPx + size.width / 2, y: (p.y - c.y) * worldPx + size.height / 2 };
}

describe('distance', () => {
  it('measures between two stage positions', () => {
    expect(distance({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(5);
  });
});

describe('gestureKind', () => {
  const SAN_JOSE: LngLat = { lng: -121.8896, lat: 37.3322 };
  const before = { overlayAnchor: SAN_JOSE, baseAnchor: LONDON, rotation: 10 };

  it('is a turn when only the rotation differs', () => {
    expect(gestureKind(before, { ...before, rotation: 25 })).toBe('turn');
  });

  it('is a slide when the pin moved on either sheet, turned or not', () => {
    expect(gestureKind(before, { ...before, baseAnchor: WATFORD })).toBe('slide');
    expect(gestureKind(before, { ...before, overlayAnchor: TOKYO })).toBe('slide');
    expect(gestureKind(before, { ...before, baseAnchor: WATFORD, rotation: 25 })).toBe('slide');
  });

  it('is nothing when the registration is the same', () => {
    expect(gestureKind(before, { ...before, baseAnchor: { ...LONDON } })).toBeNull();
  });
});

describe('nearestWorldCopy', () => {
  it('keeps a longitude that is already near the reference', () => {
    expect(nearestWorldCopy(-0.13, 2.35)).toBeCloseTo(-0.13);
  });

  it('follows a centre that was panned across the antimeridian', () => {
    expect(nearestWorldCopy(-175, 185)).toBeCloseTo(185);
    expect(nearestWorldCopy(178, -182)).toBeCloseTo(-182);
    expect(nearestWorldCopy(10, 365)).toBeCloseTo(370);
  });
});

describe('toInsets', () => {
  it('spreads a number to every side and falls back when unset', () => {
    expect(toInsets(12, 48)).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    expect(toInsets(undefined, 48)).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });
    expect(toInsets({ top: 1, right: 2, bottom: 3, left: 4 }, 48)).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });
});

describe('fitView', () => {
  it('returns null when there is nothing to frame', () => {
    expect(fitView([], STAGE, limits())).toBeNull();
  });

  it('frames positions inside the padding, touching it on the tighter axis', () => {
    const view = fitView([LONDON, WATFORD], STAGE, limits());
    expect(view).not.toBeNull();
    const a = project(LONDON, view!, STAGE);
    const b = project(WATFORD, view!, STAGE);
    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(48 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(STAGE.width - 48 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(48 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(STAGE.height - 48 + 1e-6);
    }
    const spanX = Math.abs(a.x - b.x);
    const spanY = Math.abs(a.y - b.y);
    const tight = Math.max(spanX / (STAGE.width - 96), spanY / (STAGE.height - 96));
    expect(tight).toBeCloseTo(1, 6);
  });

  it('centres the positions in the clear area when padding is uneven', () => {
    const padding = { top: 20, right: 40, bottom: 260, left: 400 };
    const view = fitView([LONDON, WATFORD], STAGE, limits({ padding }))!;
    const a = project(LONDON, view, STAGE);
    const b = project(WATFORD, view, STAGE);
    expect((a.x + b.x) / 2).toBeCloseTo((padding.left + STAGE.width - padding.right) / 2, 4);
    expect((a.y + b.y) / 2).toBeCloseTo((padding.top + STAGE.height - padding.bottom) / 2, 4);
  });

  it('respects the zoom limits', () => {
    expect(fitView([LONDON, WATFORD], STAGE, limits({ maxZoom: 9 }))!.zoom).toBe(9);
    expect(fitView([LONDON, TOKYO], STAGE, limits({ minZoom: 6 }))!.zoom).toBe(6);
  });

  it('keeps the given zoom for a single spot, clamped', () => {
    const view = fitView([LONDON], STAGE, limits({ zoomWhenPoint: 11 }))!;
    expect(view.zoom).toBe(11);
    expect(view.center.lng).toBeCloseTo(LONDON.lng, 9);
    expect(view.center.lat).toBeCloseTo(LONDON.lat, 9);
    expect(fitView([LONDON], STAGE, limits({ zoomWhenPoint: 11, maxZoom: 9 }))!.zoom).toBe(9);
  });

  it('frames positions on both sides of the antimeridian the short way round', () => {
    const suva: LngLat = { lng: 178.44, lat: -18.12 };
    const apia: LngLat = { lng: -171.76, lat: -13.83 };
    const view = fitView([suva, apia], STAGE, limits())!;
    expect(Math.abs(view.center.lng)).toBeGreaterThan(170);
    expect(view.zoom).toBeGreaterThan(5);
  });

  it('survives padding larger than the stage', () => {
    const view = fitView([LONDON, WATFORD], { width: 200, height: 200 }, limits({ padding: toInsets(150, 48) }));
    expect(Number.isFinite(view!.zoom)).toBe(true);
  });
});

describe('planMove', () => {
  const here = { center: LONDON, zoom: 10 };

  it('jumps when there is nowhere to go', () => {
    expect(planMove(here, here, STAGE)).toEqual({ kind: 'jump' });
  });

  it('eases short hops, longer for more travel, within 600 to 900ms', () => {
    const nudge = planMove(here, { center: { lng: -0.2, lat: 51.52 }, zoom: 10 }, STAGE);
    const hop = planMove(here, { center: WATFORD, zoom: 10 }, STAGE);
    const zoomOnly = planMove(here, { center: LONDON, zoom: 13 }, STAGE);
    for (const plan of [nudge, hop, zoomOnly]) {
      expect(plan.kind).toBe('ease');
      if (plan.kind !== 'ease') continue;
      expect(plan.duration).toBeGreaterThanOrEqual(MOVE_MS.min);
      expect(plan.duration).toBeLessThanOrEqual(MOVE_MS.max);
    }
    expect(nudge.kind === 'ease' && hop.kind === 'ease' && hop.duration > nudge.duration).toBe(true);
  });

  it('jumps to somewhere far away', () => {
    expect(planMove(here, { center: TOKYO, zoom: 10 }, STAGE)).toEqual({ kind: 'jump' });
  });

  it('eases right up to two stage diagonals of travel', () => {
    const diagonalPx = Math.hypot(STAGE.width, STAGE.height);
    const east = (px: number) => fromMercator({ x: toMercator(LONDON).x + px / (512 * 2 ** 10), y: toMercator(LONDON).y });
    expect(planMove(here, { center: east(1.9 * diagonalPx), zoom: 10 }, STAGE).kind).toBe('ease');
    expect(planMove(here, { center: east(2.1 * diagonalPx), zoom: 10 }, STAGE).kind).toBe('jump');
  });

  it('measures travel at the wider of the two zooms', () => {
    const paris = { lng: 2.3522, lat: 48.8566 };
    expect(planMove({ center: LONDON, zoom: 5 }, { center: paris, zoom: 10 }, STAGE).kind).toBe('ease');
    expect(planMove({ center: LONDON, zoom: 10 }, { center: paris, zoom: 10 }, STAGE).kind).toBe('jump');
  });
});

describe('easeOut', () => {
  it('runs from 0 to 1 and is ahead of linear', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe('easeOut, restarted partway', () => {
  it('carries on along the same curve for the time that was left', () => {
    for (const elapsed of [0.1, 0.35, 0.8]) {
      const done = easeOut(elapsed);
      for (const later of [0.2, 0.5, 0.9]) {
        // `later` of the remaining time, on a fresh curve over the remaining distance.
        const restarted = done + (1 - done) * easeOut(later);
        expect(restarted).toBeCloseTo(easeOut(elapsed + (1 - elapsed) * later), 12);
      }
    }
  });
});

describe('panView', () => {
  const view = { center: LONDON, zoom: 10 };

  it('moves the view right and down by the pixels given, keeping the zoom', () => {
    const moved = panView(view, 240, -120);
    expect(moved.zoom).toBe(10);
    const at = project(LONDON, moved, STAGE);
    expect(at.x).toBeCloseTo(STAGE.width / 2 - 240, 6);
    expect(at.y).toBeCloseTo(STAGE.height / 2 + 120, 6);
  });

  it('moves half as far over the ground one zoom level further in', () => {
    const near = panView({ center: LONDON, zoom: 11 }, 100, 0);
    const far = panView(view, 100, 0);
    expect(near.center.lng - LONDON.lng).toBeCloseTo((far.center.lng - LONDON.lng) / 2, 9);
  });

  it('leaves the view alone for no pixels', () => {
    const same = panView(view, 0, 0);
    expect(same.center.lng).toBeCloseTo(LONDON.lng, 9);
    expect(same.center.lat).toBeCloseTo(LONDON.lat, 9);
  });
});

describe('offsetHasDrifted', () => {
  it('ignores small changes and reports noticeable ones', () => {
    expect(offsetHasDrifted(0.35, 0.4)).toBe(false);
    expect(offsetHasDrifted(0.35, 0.42)).toBe(false);
    expect(offsetHasDrifted(0.35, 0.44)).toBe(true);
    expect(offsetHasDrifted(0.35, -0.35)).toBe(true);
  });
});

describe('wheelZoomChange', () => {
  const notch = (deltaY: number, extra: Partial<{ deltaMode: number; shiftKey: boolean }> = {}) => ({
    deltaY,
    deltaMode: 0,
    shiftKey: false,
    ...extra,
  });
  const LONG_AGO = 5000;

  it('zooms in when the wheel turns away from the person, out when it turns towards them', () => {
    expect(wheelZoomChange(notch(-100), LONG_AGO)).toBeGreaterThan(0);
    expect(wheelZoomChange(notch(100), LONG_AGO)).toBeCloseTo(-wheelZoomChange(notch(-100), LONG_AGO), 12);
  });

  it('gives a wheel notch what MapLibre gives it', () => {
    expect(wheelZoomChange(notch(-100), LONG_AGO)).toBeCloseTo(Math.log2(2 / (1 + Math.exp(-100 / 450))), 12);
    expect(wheelZoomChange(notch(-300), LONG_AGO)).toBeCloseTo(0.402, 3);
  });

  it('reads wheels that report lines', () => {
    expect(wheelZoomChange(notch(-3, { deltaMode: 1 }), LONG_AGO)).toBeCloseTo(wheelZoomChange(notch(-120), LONG_AGO), 12);
  });

  it('gives the small steps of a trackpad the finer rate', () => {
    expect(wheelZoomChange(notch(-2), LONG_AGO)).toBeCloseTo(Math.log2(2 / (1 + Math.exp(-2 / 100))), 12);
    // A stream of middling steps a frame apart is a trackpad too; the same step out of the blue is a wheel.
    expect(wheelZoomChange(notch(-10), 16)).toBeGreaterThan(wheelZoomChange(notch(-10), LONG_AGO));
  });

  it('zooms a quarter as far with Shift held', () => {
    expect(wheelZoomChange(notch(-100, { shiftKey: true }), LONG_AGO)).toBeCloseTo(wheelZoomChange(notch(-25), LONG_AGO), 12);
  });

  it('never asks for more than one level, and for nothing when the wheel did not turn', () => {
    expect(wheelZoomChange(notch(-100000), LONG_AGO)).toBeCloseTo(1, 9);
    expect(wheelZoomChange(notch(0), LONG_AGO)).toBe(0);
  });
});
