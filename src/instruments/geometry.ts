import { screenAngle, snapRotation } from '../geo/angles';
import { normalizeDegrees } from '../geo/registration';
import type { ScreenBox, ScreenPoint } from '../map/contracts';

/** Screen maths for the instruments. Everything is in stage pixels; angles are degrees. */

const DEG = Math.PI / 180;

export interface StageSize {
  readonly width: number;
  readonly height: number;
}

/** Room to keep between a label's centre and the stage edge, per axis. */
export interface Inset {
  readonly x: number;
  readonly y: number;
}

export function distanceBetween(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point `radius` px from `center`, `degrees` clockwise from straight up. */
export function pointAtAngle(center: ScreenPoint, radius: number, degrees: number): ScreenPoint {
  return { x: center.x + radius * Math.sin(degrees * DEG), y: center.y - radius * Math.cos(degrees * DEG) };
}

function isInside(point: ScreenPoint, size: StageSize, inset: Inset): boolean {
  return point.x >= inset.x && point.x <= size.width - inset.x && point.y >= inset.y && point.y <= size.height - inset.y;
}

// --- the turn knob ---

/**
 * Home's rotation while the knob is dragged around the pin, squared up when it comes within 2 degrees
 * of 0, 90, 180 or -90. The knob keeps the angle it was grabbed at (`grabbedAt`, when the rotation was
 * `startRotation`), so it never jumps under the pointer. Both angles are screen angles about the pin:
 * only their difference counts.
 */
export function turnWhileDragging(startRotation: number, grabbedAt: number, pointerAt: number): number {
  return snapRotation(startRotation + pointerAt - grabbedAt);
}

/**
 * One keyboard step of the knob. Steps land on whole degrees, so a turn left at 27.6 by a drag goes
 * to 28 and then 29, not 28.6.
 */
export function stepTurn(rotation: number, step: number): number {
  const whole = step > 0 ? Math.floor(rotation + 1e-9) : Math.ceil(rotation - 1e-9);
  return normalizeDegrees(whole + step);
}

// --- arrow-key nudges ---

export interface NudgeKey {
  readonly key: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const ARROWS: Readonly<Record<string, ScreenPoint>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** How far an arrow key moves a handle: 16 px, 2 px with Alt for fine work, 64 px with Shift. Null for any other key. */
export function arrowNudge(event: NudgeKey): ScreenPoint | null {
  const direction = ARROWS[event.key];
  if (!direction) return null;
  const step = event.altKey ? 2 : event.shiftKey ? 64 : 16;
  return { x: direction.x * step, y: direction.y * step };
}

// --- the trip's plaque ---

/**
 * The rotation that sets lettering along the line from `from` to `to` without ever turning it upside
 * down: in [-90, 90), where a vertical line reads upwards.
 */
export function uprightAngle(from: ScreenPoint, to: ScreenPoint): number {
  const angle = screenAngle(from, to);
  if (angle >= 90) return angle - 180;
  if (angle < -90) return angle + 180;
  return angle;
}

/** The stretch of the segment that lies inside the stage (shrunk by `inset`), or null when none does. */
export function clipToStage(
  from: ScreenPoint,
  to: ScreenPoint,
  size: StageSize,
  inset: number,
): readonly [ScreenPoint, ScreenPoint] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let leave = 1;
  // Liang-Barsky: each edge narrows the stretch of the segment that is inside.
  const edges: readonly (readonly [number, number])[] = [
    [-dx, from.x - inset],
    [dx, size.width - inset - from.x],
    [-dy, from.y - inset],
    [dy, size.height - inset - from.y],
  ];
  for (const [direction, room] of edges) {
    if (direction === 0) {
      if (room < 0) return null;
    } else if (direction < 0) {
      enter = Math.max(enter, room / direction);
    } else {
      leave = Math.min(leave, room / direction);
    }
  }
  if (enter > leave) return null;
  return [
    { x: from.x + dx * enter, y: from.y + dy * enter },
    { x: from.x + dx * leave, y: from.y + dy * leave },
  ];
}

export interface PlaquePlacement {
  /** How far inside the stage edge the visible part of the line is taken to end, so the plaque is not cut off. */
  readonly inset: number;
  /** From the line to the plaque's centre. */
  readonly lift: number;
  /** A visible part shorter than this cannot carry the plaque. */
  readonly shortestVisible: number;
}

/**
 * Where the plaque is centred: beside the middle of the line, `lift` px off it on the lettering's own
 * upper side, so the line itself stays readable. When part of the line is off stage, the middle of
 * the part that shows is used, so the length can still be read after zooming in on one end; unless
 * too little shows, and then the plaque keeps to the true middle, off stage with most of the line.
 */
export function plaqueCenter(from: ScreenPoint, to: ScreenPoint, size: StageSize, placement: PlaquePlacement): ScreenPoint {
  const visible = clipToStage(from, to, size, placement.inset);
  const [a, b] = visible && distanceBetween(visible[0], visible[1]) >= placement.shortestVisible ? visible : [from, to];
  const angle = uprightAngle(from, to) * DEG;
  return {
    x: (a.x + b.x) / 2 + placement.lift * Math.sin(angle),
    y: (a.y + b.y) / 2 - placement.lift * Math.cos(angle),
  };
}

/**
 * Whether a plaque `plaqueWidth` long can ride on a line `lineLength` long and still leave `endRoom`
 * free at each end, for whatever the line ends on (the pin, as often as not).
 */
export function plaqueFits(lineLength: number, plaqueWidth: number, endRoom: number): boolean {
  return lineLength >= plaqueWidth + 2 * endRoom;
}

/** The upright box around a `width` by `height` rectangle centred on `center` and turned by `degrees`. */
export function rotatedBoxBounds(center: ScreenPoint, width: number, height: number, degrees: number): ScreenBox {
  const cos = Math.abs(Math.cos(degrees * DEG));
  const sin = Math.abs(Math.sin(degrees * DEG));
  const boundsWidth = width * cos + height * sin;
  const boundsHeight = width * sin + height * cos;
  return { x: center.x - boundsWidth / 2, y: center.y - boundsHeight / 2, width: boundsWidth, height: boundsHeight };
}

export function boxAround(center: ScreenPoint, width: number, height: number): ScreenBox {
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

// --- ring labels ---

/** How finely the ring is searched for a spot on stage, and how far the find is then tightened up. */
const RING_SEARCH_STEP_DEG = 1;
const RING_SEARCH_REFINEMENTS = 10;

/**
 * Where a ring's label sits: on the ring at its top, or, when that point is off stage, at the nearest
 * point round the ring that is on stage. Null when no part of the ring can carry a label.
 */
export function ringLabelSpot(pin: ScreenPoint, radius: number, size: StageSize, inset: Inset): ScreenPoint | null {
  const at = (degrees: number) => pointAtAngle(pin, radius, degrees);
  const top = at(0);
  if (isInside(top, size, inset)) return top;
  for (let offset = RING_SEARCH_STEP_DEG; offset <= 180; offset += RING_SEARCH_STEP_DEG) {
    for (const side of [1, -1] as const) {
      if (!isInside(at(side * offset), size, inset)) continue;
      // Tighten towards the top so the label glides along the stage edge instead of hopping a degree at a time.
      let outside = side * (offset - RING_SEARCH_STEP_DEG);
      let inside = side * offset;
      for (let i = 0; i < RING_SEARCH_REFINEMENTS; i++) {
        const middle = (outside + inside) / 2;
        if (isInside(at(middle), size, inset)) inside = middle;
        else outside = middle;
      }
      return at(inside);
    }
  }
  return null;
}

// --- a ring that may be far larger than the stage ---

/** A stretch of a ring, in degrees clockwise from straight up: 0 <= from < to <= 360. */
export interface RingArc {
  readonly from: number;
  readonly to: number;
}

function isInBox(point: ScreenPoint, box: ScreenBox): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

/**
 * The stretches of a ring that lie inside a box, in order round the ring from straight up. A ring
 * about a spot far off stage shows as a sliver of arc, and one many stages across as a few of them;
 * these are worked out exactly, from where the ring crosses the box's sides, so that a ring of any
 * size can be drawn and lettered from the part of it that shows. A stretch never runs across
 * straight up: the one through there comes as two, which is where a drawn ring has its seam.
 */
export function ringArcsInside(center: ScreenPoint, radius: number, box: ScreenBox): RingArc[] {
  if (!(radius > 0)) return [];
  const cuts = [0];
  const cut = (degrees: number): void => {
    cuts.push(((degrees % 360) + 360) % 360);
  };
  for (const x of [box.x, box.x + box.width]) {
    const sine = (x - center.x) / radius;
    if (Math.abs(sine) > 1) continue;
    const degrees = Math.asin(sine) / DEG;
    cut(degrees);
    cut(180 - degrees);
  }
  for (const y of [box.y, box.y + box.height]) {
    const cosine = (center.y - y) / radius;
    if (Math.abs(cosine) > 1) continue;
    const degrees = Math.acos(cosine) / DEG;
    cut(degrees);
    cut(-degrees);
  }
  cuts.sort((a, b) => a - b);

  const arcs: RingArc[] = [];
  cuts.forEach((from, index) => {
    const to = cuts[index + 1] ?? 360;
    // Between two crossings the ring is wholly inside or wholly outside: its middle says which.
    if (to <= from || !isInBox(pointAtAngle(center, radius, (from + to) / 2), box)) return;
    const last = arcs[arcs.length - 1];
    // A cut that the ring only touches the box at, or one on a side it crosses outside the box, parts nothing.
    if (last && last.to === from) arcs[arcs.length - 1] = { from: last.from, to };
    else arcs.push({ from, to });
  });
  return arcs;
}

/** The angle on any of the stretches that is nearest to `degrees` round the ring. Null when there are none. */
export function nearestOnArcs(arcs: readonly RingArc[], degrees: number): number | null {
  const wanted = ((degrees % 360) + 360) % 360;
  let nearest: number | null = null;
  let least = Infinity;
  for (const arc of arcs) {
    if (wanted >= arc.from && wanted <= arc.to) return wanted;
    for (const end of [arc.from, arc.to]) {
      const apart = Math.abs(normalizeDegrees(end - wanted));
      if (apart < least) {
        least = apart;
        nearest = end;
      }
    }
  }
  return nearest;
}

export function boxesOverlap(a: ScreenBox, b: ScreenBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// --- the chip that points at an off-stage pin ---

export interface EdgeChipSpot {
  readonly x: number;
  readonly y: number;
  /** Direction from the chip to the pin, in degrees clockwise from straight up. */
  readonly bearing: number;
}

/**
 * Where the chip pointing at the pin goes: on the line from the middle of the stage to the pin, held
 * `inset` inside the edge. Null while the pin is on stage, or within `slack` px of it (its mark is
 * still partly showing).
 */
export function edgeChipSpot(pin: ScreenPoint, size: StageSize, inset: Inset, slack: number): EdgeChipSpot | null {
  const onStage = pin.x >= -slack && pin.x <= size.width + slack && pin.y >= -slack && pin.y <= size.height + slack;
  if (onStage) return null;
  const center = { x: size.width / 2, y: size.height / 2 };
  const dx = pin.x - center.x;
  const dy = pin.y - center.y;
  const reachX = Math.max(0, center.x - inset.x);
  const reachY = Math.max(0, center.y - inset.y);
  const scale = Math.min(dx === 0 ? Infinity : reachX / Math.abs(dx), dy === 0 ? Infinity : reachY / Math.abs(dy));
  // A quarter turn on from the screen angle, which is measured from the right.
  return { x: center.x + dx * scale, y: center.y + dy * scale, bearing: normalizeDegrees(screenAngle(center, pin) + 90) };
}
