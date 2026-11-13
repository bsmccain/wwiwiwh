import { describe, expect, it } from 'vitest';
import { bearingDegrees, destination, distanceMeters } from './distance';
import { fromMercator, metersPerPixel, toMercator, wrapDeltaX, wrapLng } from './mercator';
import {
  baseToOverlay,
  normalizeDegrees,
  overlayCamera,
  overlayToBase,
  relativeScale,
  repin,
  rotateOverlay,
  scaleFactor,
  slideOverlay,
  swapRegistration,
  zoomOffset,
  type Registration,
} from './registration';
import type { LngLat } from './types';

const SAN_JOSE: LngLat = { lng: -121.8863, lat: 37.3382 };
const LONDON: LngLat = { lng: -0.1276, lat: 51.5072 };
const SINGAPORE: LngLat = { lng: 103.8198, lat: 1.3521 };
const REYKJAVIK: LngLat = { lng: -21.9426, lat: 64.1466 };
const SYDNEY: LngLat = { lng: 151.2093, lat: -33.8688 };
const SUVA: LngLat = { lng: 178.4419, lat: -18.1248 };

const reg = (overlayAnchor: LngLat, baseAnchor: LngLat, rotation = 0): Registration => ({
  overlayAnchor,
  baseAnchor,
  rotation,
});

function expectClose(a: LngLat, b: LngLat, toleranceMeters = 0.01) {
  expect(distanceMeters(a, b)).toBeLessThan(toleranceMeters);
}

describe('mercator', () => {
  it('round-trips positions', () => {
    for (const p of [SAN_JOSE, LONDON, SINGAPORE, REYKJAVIK, SYDNEY, SUVA]) {
      expectClose(fromMercator(toMercator(p)), p, 1e-4);
    }
  });

  it('matches known world coordinates', () => {
    expect(toMercator({ lng: 0, lat: 0 })).toEqual({ x: 0.5, y: 0.5 });
    expect(toMercator({ lng: -180, lat: 0 }).x).toBe(0);
    expect(toMercator({ lng: 0, lat: 85.051129 }).y).toBeCloseTo(0, 6);
  });

  it('wraps longitudes and deltas the short way round', () => {
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-181)).toBe(179);
    expect(wrapLng(180)).toBe(-180);
    expect(wrapDeltaX(0.75)).toBeCloseTo(-0.25);
    expect(wrapDeltaX(-0.75)).toBeCloseTo(0.25);
  });

  it('reports the standard ground resolution', () => {
    // 512px tiles on a sphere of mean Earth radius (what MapLibre uses): 78184.04 m/px at zoom 0.
    expect(metersPerPixel(0, 0)).toBeCloseTo(78184.04, 1);
    expect(metersPerPixel(60, 10)).toBeCloseTo(78184.04 / 2 / 1024, 2);
    // Agrees with measuring one pixel's worth of longitude on the ground.
    const lat = 37.3382;
    const onePixelOfLng = 360 / (512 * 2 ** 12);
    const measured = distanceMeters({ lng: 0, lat }, { lng: onePixelOfLng, lat });
    expect(metersPerPixel(lat, 12) / measured).toBeCloseTo(1, 6);
  });
});

describe('registration', () => {
  it('pins the overlay anchor onto the base anchor', () => {
    const r = reg(SAN_JOSE, LONDON, 37);
    expectClose(baseToOverlay(r, LONDON), SAN_JOSE);
    expectClose(overlayToBase(r, SAN_JOSE), LONDON);
  });

  it('inverts exactly', () => {
    const r = reg(SAN_JOSE, LONDON, -63);
    for (const [brg, km] of [[0, 5], [90, 20], [200, 45], [311, 80]] as const) {
      const p = destination(LONDON, brg, km * 1000);
      expectClose(overlayToBase(r, baseToOverlay(r, p)), p, 0.01);
    }
  });

  it('uses the latitude cosine ratio as its scale', () => {
    const r = reg(SAN_JOSE, LONDON);
    expect(scaleFactor(r)).toBeCloseTo(Math.cos((51.5072 * Math.PI) / 180) / Math.cos((37.3382 * Math.PI) / 180), 12);
    // London is drawn larger by Mercator than San Jose, so the overlay must zoom in to match.
    expect(zoomOffset(r)).toBeGreaterThan(0);
    expect(zoomOffset(r)).toBeCloseTo(0.353, 2);
    expect(zoomOffset(reg(LONDON, LONDON))).toBeCloseTo(0, 12);
  });

  it('preserves ground distance from the pin across very different latitudes', () => {
    const pairs: [LngLat, LngLat][] = [
      [SAN_JOSE, LONDON],
      [SAN_JOSE, SINGAPORE],
      [SAN_JOSE, REYKJAVIK],
      [REYKJAVIK, SINGAPORE],
      [SYDNEY, LONDON],
      [SAN_JOSE, SUVA],
    ];
    for (const [overlayAnchor, baseAnchor] of pairs) {
      for (const rotation of [0, 45, -120]) {
        const r = reg(overlayAnchor, baseAnchor, rotation);
        for (const bearing of [0, 60, 135, 225, 300]) {
          for (const km of [2, 10, 25]) {
            const p = destination(baseAnchor, bearing, km * 1000);
            const q = baseToOverlay(r, p);
            const ratio = distanceMeters(overlayAnchor, q) / (km * 1000);
            // Within 0.6% out to 25 km even between Iceland and the equator.
            expect(Math.abs(ratio - 1)).toBeLessThan(0.006);
          }
        }
      }
    }
  });

  it('keeps distances between two off-pin points within 1% across a metro-sized area', () => {
    const r = reg(SAN_JOSE, LONDON, 20);
    const p1 = destination(LONDON, 300, 30_000);
    const p2 = destination(LONDON, 110, 35_000);
    const base = distanceMeters(p1, p2);
    const overlay = distanceMeters(baseToOverlay(r, p1), baseToOverlay(r, p2));
    expect(Math.abs(overlay / base - 1)).toBeLessThan(0.01);
  });

  it('rotates the overlay clockwise on screen', () => {
    // With the overlay turned 90 degrees clockwise its north points to the base's east,
    // so the base position due east of the pin shows the overlay place due north of the pin.
    const r = reg(SAN_JOSE, LONDON, 90);
    const east = destination(LONDON, 90, 10_000);
    const q = baseToOverlay(r, east);
    expect(bearingDegrees(SAN_JOSE, q)).toBeLessThan(1.5);
    expect(distanceMeters(SAN_JOSE, q) / 10_000).toBeCloseTo(1, 2);

    const north = destination(LONDON, 0, 10_000);
    expect(bearingDegrees(SAN_JOSE, baseToOverlay(r, north))).toBeCloseTo(270, 0);
  });

  it('derives the overlay camera from the base camera', () => {
    const r = reg(SAN_JOSE, LONDON, 30);
    const cam = overlayCamera(r, { center: LONDON, zoom: 10, bearing: 0 });
    expectClose(cam.center, SAN_JOSE);
    expect(cam.zoom).toBeCloseTo(10 + zoomOffset(r), 12);
    // A clockwise turn of the picture is a counter-clockwise turn of the camera bearing.
    expect(cam.bearing).toBeCloseTo(-30, 12);

    const panned = destination(LONDON, 45, 15_000);
    const cam2 = overlayCamera(r, { center: panned, zoom: 11.25, bearing: 10 });
    expectClose(cam2.center, baseToOverlay(r, panned));
    expect(cam2.bearing).toBeCloseTo(-20, 12);
  });

  it('gives both maps the same ground resolution at the pin', () => {
    for (const [a, b] of [[SAN_JOSE, LONDON], [REYKJAVIK, SINGAPORE], [SYDNEY, SAN_JOSE]] as const) {
      const r = reg(a, b);
      const cam = overlayCamera(r, { center: b, zoom: 9.5, bearing: 0 });
      expect(metersPerPixel(a.lat, cam.zoom) / metersPerPixel(b.lat, 9.5)).toBeCloseTo(1, 10);
    }
  });

  it('slides the overlay so the grabbed spot follows the pointer', () => {
    const r = reg(SAN_JOSE, LONDON, 15);
    const from = destination(LONDON, 250, 8_000);
    const to = destination(LONDON, 80, 12_000);
    const grabbed = baseToOverlay(r, from);
    const moved = slideOverlay(r, from, to);
    expect(moved.overlayAnchor).toEqual(r.overlayAnchor);
    expect(moved.rotation).toBe(r.rotation);
    // The overlay place that was under `from` is now under `to` (to within the tiny rescale).
    expect(distanceMeters(baseToOverlay(moved, to), grabbed)).toBeLessThan(40);
    // And the pin itself moved by the same Mercator offset.
    const b0 = toMercator(r.baseAnchor);
    const b1 = toMercator(moved.baseAnchor);
    const f = toMercator(from);
    const t = toMercator(to);
    expect(b1.x - b0.x).toBeCloseTo(t.x - f.x, 12);
    expect(b1.y - b0.y).toBeCloseTo(t.y - f.y, 12);
  });

  it('rescales the overlay for its new latitude when slid north', () => {
    const r = reg(SAN_JOSE, SINGAPORE);
    const moved = slideOverlay(r, SINGAPORE, REYKJAVIK);
    expectClose(moved.baseAnchor, REYKJAVIK, 1);
    expect(scaleFactor(moved)).toBeLessThan(scaleFactor(r));
    const p = destination(REYKJAVIK, 90, 10_000);
    expect(distanceMeters(SAN_JOSE, baseToOverlay(moved, p)) / 10_000).toBeCloseTo(1, 2);
  });

  it('turns about the pin by default', () => {
    const r = rotateOverlay(reg(SAN_JOSE, LONDON, 170), 20);
    expect(r.rotation).toBeCloseTo(-170, 12);
    expectClose(baseToOverlay(r, LONDON), SAN_JOSE);
  });

  it('turns about an arbitrary pivot, keeping what is under the pivot fixed', () => {
    const r = reg(SAN_JOSE, LONDON, 10);
    const pivot = destination(LONDON, 200, 18_000);
    const under = baseToOverlay(r, pivot);
    const turned = rotateOverlay(r, 75, pivot);
    expect(turned.rotation).toBeCloseTo(85, 12);
    expect(turned.overlayAnchor).toEqual(r.overlayAnchor);
    expect(distanceMeters(baseToOverlay(turned, pivot), under)).toBeLessThan(0.5);
    // The pin swung around the pivot at a constant radius.
    const before = distanceMeters(pivot, r.baseAnchor);
    const after = distanceMeters(pivot, turned.baseAnchor);
    expect(Math.abs(after / before - 1)).toBeLessThan(0.01);
  });

  it('re-pins without moving the picture near the new pin', () => {
    const r = reg(SAN_JOSE, LONDON, 33);
    const at = destination(LONDON, 290, 22_000);
    const pinned = repin(r, at);
    expectClose(pinned.baseAnchor, at);
    expectClose(pinned.overlayAnchor, baseToOverlay(r, at));
    expect(pinned.rotation).toBe(r.rotation);
    expect(relativeScale(pinned, at)).toBeCloseTo(1, 12);
    // Nearby content barely shifts.
    const near = destination(at, 40, 5_000);
    expect(distanceMeters(baseToOverlay(pinned, near), baseToOverlay(r, near))).toBeLessThan(25);
  });

  it('swaps roles into the exact inverse mapping', () => {
    const r = reg(SAN_JOSE, LONDON, 48);
    const swapped = swapRegistration(r);
    expect(swapped.rotation).toBeCloseTo(-48, 12);
    for (const [brg, km] of [[10, 6], [130, 30], [260, 55]] as const) {
      const p = destination(LONDON, brg, km * 1000);
      const q = baseToOverlay(r, p);
      expectClose(baseToOverlay(swapped, q), p, 0.01);
    }
    expect(swapRegistration(swapped)).toEqual({ ...r, rotation: 48 });
  });

  it('reports scale agreement of exactly 1 at the pin and drift away from it', () => {
    const r = reg(SAN_JOSE, LONDON);
    expect(relativeScale(r, LONDON)).toBeCloseTo(1, 12);
    const north = destination(LONDON, 0, 50_000);
    const drift = relativeScale(r, north);
    // 50 km north: London's Mercator stretch grows faster than San Jose's.
    expect(drift).toBeGreaterThan(1.002);
    expect(drift).toBeLessThan(1.006);
    // The reported drift predicts the real distortion of a short segment there.
    const a = destination(north, 90, 500);
    const real = distanceMeters(baseToOverlay(r, north), baseToOverlay(r, a)) / 500;
    expect(real).toBeCloseTo(drift, 3);
  });

  it('handles pins on either side of the antimeridian', () => {
    const r = reg(SAN_JOSE, SUVA, 12);
    const p = destination(SUVA, 90, 250_000); // crosses 180 degrees
    expect(p.lng).toBeLessThan(0);
    const q = baseToOverlay(r, p);
    expect(distanceMeters(SAN_JOSE, q) / 250_000).toBeCloseTo(1, 1);
    expectClose(overlayToBase(r, q), p, 0.01);
    const slid = slideOverlay(r, SUVA, p);
    expectClose(slid.baseAnchor, p, 0.01);
  });

  it('normalises angles to (-180, 180]', () => {
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(720)).toBe(0);
  });
});

describe('distance', () => {
  it('measures a known city pair', () => {
    // Downtown San Jose to downtown Palo Alto is about 25.5 km.
    const paloAlto = { lng: -122.143, lat: 37.4419 };
    expect(distanceMeters(SAN_JOSE, paloAlto) / 1000).toBeCloseTo(25.5, 0);
  });

  it('round-trips destination and bearing', () => {
    const p = destination(LONDON, 77, 42_000);
    expect(distanceMeters(LONDON, p)).toBeCloseTo(42_000, 3);
    expect(bearingDegrees(LONDON, p)).toBeCloseTo(77, 6);
  });
});
