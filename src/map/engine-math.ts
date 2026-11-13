import type { View } from '../app/types';
import { clamp, fromMercator, toMercator, wrapDeltaX, wrapLng } from '../geo/mercator';
import type { Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { FitOptions, ScreenPoint } from './contracts';

/** MapLibre's zoom levels are defined against 512px tiles. */
const TILE_PX = 512;

export interface StageSize {
  readonly width: number;
  readonly height: number;
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * What a change of registration does to Home: turns it when only the rotation differs, slides it when
 * the pin moved, and nothing (null) when the two are the same.
 */
export function gestureKind(from: Registration, to: Registration): 'slide' | 'turn' | null {
  const samePlace = (a: LngLat, b: LngLat): boolean => a.lng === b.lng && a.lat === b.lat;
  if (!samePlace(from.baseAnchor, to.baseAnchor) || !samePlace(from.overlayAnchor, to.overlayAnchor)) return 'slide';
  return from.rotation === to.rotation ? null : 'turn';
}

/**
 * The longitude equivalent to `lng` that lies within half a world of `referenceLng`. MapLibre keeps
 * its centre longitude unwrapped after a pan across the antimeridian, and projects a position onto
 * the world copy its longitude names; this picks the copy that is actually on screen.
 */
export function nearestWorldCopy(lng: number, referenceLng: number): number {
  return referenceLng + wrapLng(lng - referenceLng);
}

export function toInsets(padding: FitOptions['padding'], fallback: number): Insets {
  if (padding === undefined) return { top: fallback, right: fallback, bottom: fallback, left: fallback };
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding };
  return padding;
}

export interface FitLimits {
  readonly padding: Insets;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Zoom to use when the positions have no extent (a single spot). Clamped like any other. */
  readonly zoomWhenPoint: number;
}

/**
 * The north-up view that frames `points` inside the stage, clear of the padding. Returns null when
 * there is nothing to frame.
 */
export function fitView(points: readonly LngLat[], size: StageSize, limits: FitLimits): View | null {
  const first = points[0];
  if (!first) return null;
  // Unwrap every x against the first position so a set that straddles the antimeridian stays compact.
  const origin = toMercator(first);
  let minX = origin.x;
  let maxX = origin.x;
  let minY = origin.y;
  let maxY = origin.y;
  for (const point of points) {
    const m = toMercator(point);
    const x = origin.x + wrapDeltaX(m.x - origin.x);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, m.y);
    maxY = Math.max(maxY, m.y);
  }

  const { padding } = limits;
  const clearWidth = Math.max(1, size.width - padding.left - padding.right);
  const clearHeight = Math.max(1, size.height - padding.top - padding.bottom);
  const fitted = Math.min(
    Math.log2(clearWidth / (TILE_PX * (maxX - minX))),
    Math.log2(clearHeight / (TILE_PX * (maxY - minY))),
  );
  const zoom = clamp(Number.isFinite(fitted) ? fitted : limits.zoomWhenPoint, limits.minZoom, limits.maxZoom);

  // Uneven padding moves the middle of the clear area away from the middle of the stage.
  const worldPx = TILE_PX * 2 ** zoom;
  const shiftX = (padding.left - padding.right) / 2 / worldPx;
  const shiftY = (padding.top - padding.bottom) / 2 / worldPx;
  return {
    center: fromMercator({ x: (minX + maxX) / 2 - shiftX, y: (minY + maxY) / 2 - shiftY }),
    zoom,
  };
}

/** How a camera move the app asked for is carried out. */
export type MovePlan = { readonly kind: 'jump' } | { readonly kind: 'ease'; readonly duration: number };

export const MOVE_MS = { min: 600, max: 900 } as const;
/** Travel, in stage diagonals, beyond which the camera cuts to the new view instead of travelling there. */
const JUMP_BEYOND_DIAGONALS = 2;

/**
 * Chooses how to move the Away camera from one view to another. Short hops ease straight across in
 * 600 to 900ms, longer for more travel. Anything more than two stage diagonals away is a jump: any
 * way of travelling there (straight across, or lifting off and landing) asks the tile server for ten
 * times the tiles of the destination and draws none of them in time.
 */
export function planMove(from: View, to: View, size: StageSize): MovePlan {
  const a = toMercator(from.center);
  const b = toMercator(to.center);
  const worldPx = TILE_PX * 2 ** Math.min(from.zoom, to.zoom);
  const travelPx = Math.hypot(wrapDeltaX(b.x - a.x), b.y - a.y) * worldPx;
  const zoomChange = Math.abs(to.zoom - from.zoom);
  if (travelPx < 0.5 && zoomChange < 0.001) return { kind: 'jump' };

  const diagonals = travelPx / Math.max(1, Math.hypot(size.width, size.height));
  if (diagonals > JUMP_BEYOND_DIAGONALS) return { kind: 'jump' };
  // Two zoom levels read as about as much motion as one stage diagonal of travel.
  const effort = diagonals + zoomChange / 2;
  const duration = MOVE_MS.min + (MOVE_MS.max - MOVE_MS.min) * Math.min(1, effort / JUMP_BEYOND_DIAGONALS);
  return { kind: 'ease', duration: Math.round(duration) };
}

/**
 * Fast away, long settle: the curve of the `--ease` design token, near enough. Its tail has the
 * shape of the whole, so a move restarted partway with the time it had left carries on unchanged.
 */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** The view moved by this many pixels (the picture shifts the other way). */
export function panView(view: View, dx: number, dy: number): View {
  const worldPx = TILE_PX * 2 ** view.zoom;
  const center = toMercator(view.center);
  return { center: fromMercator({ x: center.x + dx / worldPx, y: center.y + dy / worldPx }), zoom: view.zoom };
}

/** Whether the Home style, built for one zoom offset, is noticeably wrong for another. */
export function offsetHasDrifted(builtFor: number, current: number, tolerance = 0.08): boolean {
  return Math.abs(current - builtFor) > tolerance;
}

/** MapLibre's own rates, in zoom per pixel of wheel travel, so a wheel feels the same with motion on or off. */
const WHEEL_RATE = 1 / 450;
const TRACKPAD_RATE = 1 / 100;
/** Pixels that stand for one line, for wheels that report lines. */
const WHEEL_LINE_PX = 40;
const DELTA_LINE = 1;

export interface WheelTurn {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly shiftKey: boolean;
}

/**
 * How many zoom levels one wheel event asks for; positive zooms in. A wheel turns in notches of many
 * pixels now and then, a trackpad sends a stream of small steps and gets the finer rate (MapLibre
 * tells them apart the same way). One event never asks for more than a level.
 */
export function wheelZoomChange(turn: WheelTurn, msSinceLastTurn: number): number {
  let travel = turn.deltaMode === DELTA_LINE ? turn.deltaY * WHEEL_LINE_PX : turn.deltaY;
  if (turn.shiftKey) travel /= 4;
  if (travel === 0) return 0;
  const size = Math.abs(travel);
  const fromTrackpad = size < 4 || size * msSinceLastTurn < 200;
  const levels = Math.log2(2 / (1 + Math.exp(-size * (fromTrackpad ? TRACKPAD_RATE : WHEEL_RATE))));
  return travel < 0 ? levels : -levels;
}
