import { normalizeDegrees } from './registration';

/** The turns that count as "square": Home upright, on either side, or upside down. */
const SQUARE_TURNS = [0, 90, 180, -90] as const;

/** How close to square a turn must be, in degrees, to snap onto it. */
export const SNAP_TOLERANCE_DEG = 2;

/** Snaps a rotation onto the nearest square turn when it is within the tolerance; normalises it otherwise. */
export function snapRotation(degrees: number, tolerance = SNAP_TOLERANCE_DEG): number {
  const rotation = normalizeDegrees(degrees);
  for (const square of SQUARE_TURNS) {
    if (Math.abs(normalizeDegrees(rotation - square)) <= tolerance) return square;
  }
  return rotation;
}

/** The screen angle of `point` as seen from `pivot`, in degrees: 0 points right, 90 points down. */
export function screenAngle(pivot: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;
}
