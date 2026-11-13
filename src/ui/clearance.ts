import type { ScreenBox, ScreenPoint } from '../map/contracts';

/** Whether a point lies in a box, or within `margin` pixels of it. */
export function boxIsNearPoint(box: ScreenBox, point: ScreenPoint, margin: number): boolean {
  return (
    point.x >= box.x - margin &&
    point.x <= box.x + box.width + margin &&
    point.y >= box.y - margin &&
    point.y <= box.y + box.height + margin
  );
}

/**
 * Whether the straight line from `from` to `to` passes through a box, or within `margin` pixels of
 * it. The margin is applied by growing the box, so corners are cut square, which errs on the side
 * of "too near".
 */
export function boxIsNearSegment(box: ScreenBox, from: ScreenPoint, to: ScreenPoint, margin: number): boolean {
  const left = box.x - margin;
  const right = box.x + box.width + margin;
  const top = box.y - margin;
  const bottom = box.y + box.height + margin;
  // Clip the segment against the grown box, one pair of sides at a time (Liang-Barsky).
  let enter = 0;
  let leave = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const [delta, toLow, toHigh] of [
    [dx, left - from.x, right - from.x],
    [dy, top - from.y, bottom - from.y],
  ] as const) {
    if (delta === 0) {
      // Parallel to this pair of sides: either between them for its whole length, or never.
      if (toLow > 0 || toHigh < 0) return false;
      continue;
    }
    const a = toLow / delta;
    const b = toHigh / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}
