import type { ScreenBox } from '../map/contracts';

/** A label that wants a spot on the stage. */
export interface LabelBox {
  /** Where the label's centre belongs: the place itself. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The vertical shift the label is drawn with now, when it is on show. */
  readonly shownAt?: number;
}

export interface CollisionOptions {
  /** Clear space kept between any two boxes, in pixels. */
  readonly gap: number;
  /** The furthest a label may sit above or below its place to make room for another label. */
  readonly maxShift: number;
  /**
   * The furthest it may sit from its place when a reserved box lies on that place: enough to clear the
   * box and one more label, so the two names that meet under the pin both stay. Defaults to `maxShift`.
   */
  readonly maxShiftOffReserved?: number;
  /**
   * While the maps are moving, the most a label that is already shifted may shift further in one
   * pass. Leave it out when everything is at rest: then any label may be shifted, as far as it takes.
   */
  readonly creep?: number;
}

/** A rectangle on the stage, by its edges. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The index of the first of `taken` that a rectangle comes closer to than the gap, or -1. */
function firstOverlap(taken: readonly Rect[], rect: Rect, gap: number): number {
  return taken.findIndex(
    (other) =>
      rect.left < other.right + gap &&
      rect.right > other.left - gap &&
      rect.top < other.bottom + gap &&
      rect.bottom > other.top - gap,
  );
}

/** Whether a rectangle lies on any of the boxes, however slightly. Touching edges do not count. */
export function liesOnAny(rect: Rect, boxes: readonly ScreenBox[]): boolean {
  for (const box of boxes) {
    if (
      rect.left < box.x + box.width &&
      rect.right > box.x &&
      rect.top < box.y + box.height &&
      rect.bottom > box.y
    ) {
      return true;
    }
  }
  return false;
}

function rectAt(label: LabelBox, shift: number): Rect {
  const left = label.x - label.width / 2;
  const top = label.y + shift - label.height / 2;
  return { left, top, right: left + label.width, bottom: top + label.height };
}

/**
 * The smallest shift in one direction (1 is down, -1 is up) that takes a label clear of everything
 * taken: just past what is in its way and, while `hops` allows, past whatever is in the way there.
 * Null when that takes more hops, or would be further than the limit.
 */
function shiftClearOf(
  label: LabelBox,
  taken: readonly Rect[],
  firstInTheWay: number,
  direction: 1 | -1,
  gap: number,
  limit: number,
  hops: number,
): number | null {
  let inTheWay = firstInTheWay;
  for (let hop = 0; hop < hops; hop++) {
    const blocker = taken[inTheWay] as Rect;
    const edge = direction > 0 ? blocker.bottom + gap : blocker.top - gap;
    const shift = edge + (direction * label.height) / 2 - label.y;
    if (Math.abs(shift) > limit) return null;
    inTheWay = firstOverlap(taken, rectAt(label, shift), gap);
    if (inTheWay < 0) return shift;
  }
  return null;
}

/**
 * One collision pass. Labels are taken in the order given; each takes its spot if nothing placed
 * before it (and no reserved box) is in the way.
 *
 * A label whose own spot is taken by another label tries once more just below and just above that
 * label, so two names that land on the same point read as a stack ("Palo Alto" over "Watford"). If
 * neither is free it is left off: a crowd is thinned, not piled up.
 *
 * A label with a reserved box on its place is one the picture is about (the names under the pin, at
 * the ends of the trip). It tries harder: past the box and then past whatever else is in the way
 * there, on the nearer side first, and as far as `maxShiftOffReserved`.
 *
 * A label that was already shifted tries the side it is on first, so it does not hop from one side
 * to the other.
 *
 * Shifting is for a picture at rest. With `creep` set (the maps are moving) a label on its own
 * place is never pushed off it, it just does not fit; one that is already shifted may follow what
 * it dodges in small steps. Otherwise names would be shoved about by whatever passes over them.
 *
 * Returns, per label, the vertical shift it is placed with, or null when it does not fit.
 */
export function placeLabels(
  labels: readonly LabelBox[],
  reserved: readonly ScreenBox[],
  options: CollisionOptions,
): (number | null)[] {
  const { gap, maxShift, creep } = options;
  const maxShiftOffReserved = options.maxShiftOffReserved ?? maxShift;
  // The reserved boxes come first, so a label on one of them is known by the index of what blocks it.
  const taken: Rect[] = reserved.map((box) => ({
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
  }));

  return labels.map((label) => {
    const own = rectAt(label, 0);
    const inTheWay = firstOverlap(taken, own, gap);
    if (inTheWay < 0) {
      taken.push(own);
      return 0;
    }
    const shiftedBy = label.shownAt ?? 0;
    if (creep !== undefined && shiftedBy === 0) return null;

    const offReserved = inTheWay < reserved.length;
    const limit = offReserved ? maxShiftOffReserved : maxShift;
    // Each hop passes one more of `taken` for good, so there are never more hops than those.
    const hops = offReserved ? taken.length : 1;
    const below = shiftClearOf(label, taken, inTheWay, 1, gap, limit, hops);
    const above = shiftClearOf(label, taken, inTheWay, -1, gap, limit, hops);
    const aboveIsNearer = offReserved && above !== null && below !== null && -above < below;
    const aboveFirst = shiftedBy !== 0 ? shiftedBy < 0 : aboveIsNearer;
    for (const shift of aboveFirst ? [above, below] : [below, above]) {
      if (shift === null) continue;
      if (creep !== undefined && Math.abs(shift - shiftedBy) > creep) continue;
      taken.push(rectAt(label, shift));
      return shift;
    }
    return null;
  });
}

/** What `collisionOrder` needs to know about a label. */
export interface Contender {
  /** A place important worldwide (the tiles rank it 10 or better): the name a region goes by. */
  readonly major: boolean;
  /** On show since the previous pass. */
  readonly shown: boolean;
}

function alternate<T>(home: readonly T[], away: readonly T[]): T[] {
  const merged: T[] = [];
  const longest = Math.max(home.length, away.length);
  for (let index = 0; index < longest; index++) {
    if (index < home.length) merged.push(home[index] as T);
    if (index < away.length) merged.push(away[index] as T);
  }
  return merged;
}

/**
 * The order in which labels of the two sheets claim their spots. Each list comes in most important
 * first.
 *
 * The big names go first, so a region never loses its own name to a suburb. Then labels already on
 * show, so that a name coming into reach cannot push out one the eye already rests on (that is what
 * keeps the plate from flickering while the maps move). Then the rest. Within each of the three,
 * Home and Away take turns, so neither sheet starves the other.
 */
export function collisionOrder<T extends Contender>(home: readonly T[], away: readonly T[]): T[] {
  const tiers: readonly ((label: T) => boolean)[] = [
    (label) => label.major,
    (label) => !label.major && label.shown,
    (label) => !label.major && !label.shown,
  ];
  return tiers.flatMap((belongs) => alternate(home.filter(belongs), away.filter(belongs)));
}
