import { cosLat, fromMercator, toMercator, wrapDeltaX } from './mercator';
import type { Camera, LngLat, Vec2 } from './types';

/**
 * How the overlay map is registered onto the base map.
 *
 * The overlay's `overlayAnchor` is pinned onto the base's `baseAnchor`, and the overlay is turned
 * `rotation` degrees clockwise (as seen on screen) about that pin.
 *
 * Both maps are Web-Mercator, which stretches ground distance by 1/cos(latitude). The registration is
 * therefore a similarity transform in Mercator world space whose scale cancels the two stretches at
 * the pin:
 *
 *     overlayMerc = A + s * R(-rotation) * (baseMerc - B),   s = cos(lat B) / cos(lat A)
 *
 * Because it is a single rigid similarity, the two maps never drift against each other while panning.
 * Ground scale is exact at the pin and degrades slowly away from it (see `relativeScale`).
 */
export interface Registration {
  readonly overlayAnchor: LngLat;
  readonly baseAnchor: LngLat;
  /** Clockwise rotation of the overlay as seen on screen, in degrees, normalised to (-180, 180]. */
  readonly rotation: number;
}

const DEG = Math.PI / 180;

/** Normalises an angle in degrees to (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Overlay Mercator units per base Mercator unit: cos(lat B) / cos(lat A). */
export function scaleFactor(reg: Registration): number {
  return cosLat(reg.baseAnchor.lat) / cosLat(reg.overlayAnchor.lat);
}

/** What must be added to the base map's zoom to get the overlay map's zoom. */
export function zoomOffset(reg: Registration): number {
  return -Math.log2(scaleFactor(reg));
}

function rotate(v: Vec2, deg: number): Vec2 {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

function baseMercToOverlayMerc(reg: Registration, p: Vec2): Vec2 {
  const a = toMercator(reg.overlayAnchor);
  const b = toMercator(reg.baseAnchor);
  const s = scaleFactor(reg);
  const d = rotate({ x: wrapDeltaX(p.x - b.x), y: p.y - b.y }, -reg.rotation);
  return { x: a.x + s * d.x, y: a.y + s * d.y };
}

function overlayMercToBaseMerc(reg: Registration, q: Vec2): Vec2 {
  const a = toMercator(reg.overlayAnchor);
  const b = toMercator(reg.baseAnchor);
  const s = scaleFactor(reg);
  const d = rotate({ x: wrapDeltaX(q.x - a.x), y: q.y - a.y }, reg.rotation);
  return { x: b.x + d.x / s, y: b.y + d.y / s };
}

/** The overlay position drawn on top of the given base position. */
export function baseToOverlay(reg: Registration, p: LngLat): LngLat {
  return fromMercator(baseMercToOverlayMerc(reg, toMercator(p)));
}

/** The base position lying underneath the given overlay position. */
export function overlayToBase(reg: Registration, q: LngLat): LngLat {
  return fromMercator(overlayMercToBaseMerc(reg, toMercator(q)));
}

/** The camera the overlay map needs so that it lines up with the base map's camera. */
export function overlayCamera(reg: Registration, base: Camera): Camera {
  return {
    center: baseToOverlay(reg, base.center),
    zoom: base.zoom + zoomOffset(reg),
    bearing: normalizeDegrees(base.bearing - reg.rotation),
  };
}

/**
 * Slides the overlay across the base: whatever was drawn over `from` is now drawn over `to`
 * (both are base positions). The pin stays on the same overlay place; only where it sits on the base
 * changes, so the overlay is re-scaled for its new latitude exactly as true ground size requires.
 */
export function slideOverlay(reg: Registration, from: LngLat, to: LngLat): Registration {
  const f = toMercator(from);
  const t = toMercator(to);
  const b = toMercator(reg.baseAnchor);
  return {
    ...reg,
    baseAnchor: fromMercator({ x: b.x + wrapDeltaX(t.x - f.x), y: b.y + (t.y - f.y) }),
  };
}

/**
 * Turns the overlay by `deltaDeg` clockwise. With no pivot it turns about the pin. With a pivot (a base
 * position) the overlay place drawn over the pivot stays put, and the pin swings around it.
 */
export function rotateOverlay(reg: Registration, deltaDeg: number, pivot?: LngLat): Registration {
  const rotation = normalizeDegrees(reg.rotation + deltaDeg);
  if (!pivot) return { ...reg, rotation };
  const p = toMercator(pivot);
  const q = baseMercToOverlayMerc(reg, p);
  const a = toMercator(reg.overlayAnchor);
  // Solve A + s' * R(-rotation') * (P - B') = Q for B'. s' depends on B' latitude, so iterate: it
  // converges in a couple of rounds because s' varies very slowly with B'.
  let baseAnchor = reg.baseAnchor;
  for (let i = 0; i < 4; i++) {
    const s = cosLat(baseAnchor.lat) / cosLat(reg.overlayAnchor.lat);
    const d = rotate({ x: wrapDeltaX(q.x - a.x), y: q.y - a.y }, rotation);
    baseAnchor = fromMercator({ x: p.x - d.x / s, y: p.y - d.y / s });
  }
  return { ...reg, baseAnchor, rotation };
}

/**
 * Moves the pin to a new spot without moving the picture: the base position `at` becomes the new
 * base anchor and the overlay place currently drawn over it becomes the new overlay anchor.
 * (Ground scale becomes exact at the new pin, so far-away parts of the overlay shift by a hair.)
 */
export function repin(reg: Registration, at: LngLat): Registration {
  return { ...reg, overlayAnchor: baseToOverlay(reg, at), baseAnchor: { lng: at.lng, lat: at.lat } };
}

/** Exchanges the roles of the two maps. `baseToOverlay` of the result is `overlayToBase` of the input. */
export function swapRegistration(reg: Registration): Registration {
  return {
    overlayAnchor: reg.baseAnchor,
    baseAnchor: reg.overlayAnchor,
    rotation: normalizeDegrees(-reg.rotation),
  };
}

/**
 * Overlay ground distance per unit of base ground distance, for features drawn at the base position
 * `at`. Exactly 1 at the pin. A value of 1.004 means a stretch of screen that spans one base mile
 * spans 1.004 overlay miles there, i.e. the overlay is drawn 0.4% too small at that spot.
 */
export function relativeScale(reg: Registration, at: LngLat): number {
  const q = baseToOverlay(reg, at);
  return (scaleFactor(reg) * cosLat(q.lat)) / cosLat(at.lat);
}
