import { formatRoundDistance, planRings, type RoundDistance, type Units } from '../geo/units';
import type { ScreenBox, ScreenPoint } from '../map/contracts';
import { centerOn, html, px, setAttribute, setHidden, setText, svg } from './dom';
import { boxAround, ringLabelSpot, type Inset } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';

const RING_COUNT = 3;
/** Kept clear between the largest ring and the nearer stage edge, so its label fits on stage with it. */
const EDGE_MARGIN_PX = 14;
/** A ring tighter than this would crowd the pin's own mark. */
const SMALLEST_RING_PX = 28;
/**
 * A ring within this of the pin is drawn without its label, which would take the spot just above the
 * pin where the name of the place under it is lettered: the square kept clear about the pin, a name,
 * and half a label.
 */
const NAME_ROOM_PX = 54;
/** Labels of rings within this of the pin lie in the turn knob's path, and step aside while it is up. */
const KNOB_REACH_PX = 68;
/** Room from the stage edge to a label's centre: half a label plus a little air. */
const LABEL_INSET: Inset = { x: 28, y: 14 };

/** The rings chosen for a ground scale, a reach and a unit, lettered once and kept until one of those changes. */
interface RingPlan {
  readonly metersPerPixel: number;
  readonly reach: number;
  readonly units: Units;
  readonly rings: readonly RoundDistance[];
  readonly labels: readonly string[];
}

/**
 * The distance rings: dotted circles about the pin at round distances, each labelled on the ring.
 * A radius is its distance over the ground scale at the pin, where both maps are exact, so one set
 * of rings measures both places.
 */
export function createRings({ ink, layer, sizes }: InstrumentContext): Part {
  // Each ring is drawn twice: a pale casing that knocks it out of the roads it crosses, then the dots.
  const casings = Array.from({ length: RING_COUNT }, () => svg('circle', { class: 'mapz-ring__casing' }));
  const circles = Array.from({ length: RING_COUNT }, () => svg('circle', { class: 'mapz-ring' }));
  const group = svg('g', { class: 'mapz-rings' }, [...casings, ...circles]);
  const labels = Array.from({ length: RING_COUNT }, () => html('div', 'mapz-ring-label', { 'aria-hidden': 'true' }));
  ink.append(group);
  layer.append(...labels);
  for (const label of labels) sizes.watch(label);

  let plan: RingPlan | null = null;
  /** Where each label was last put; null while it is not showing. */
  const spots: (ScreenPoint | null)[] = labels.map(() => null);

  function planFor(metersPerPixel: number, reach: number, units: Units): RingPlan {
    if (plan?.metersPerPixel !== metersPerPixel || plan.reach !== reach || plan.units !== units) {
      const rings = planRings(metersPerPixel, reach, units, { count: RING_COUNT, minPixels: SMALLEST_RING_PX });
      plan = { metersPerPixel, reach, units, rings, labels: rings.map(formatRoundDistance) };
    }
    return plan;
  }

  return {
    layout({ pin, size, metersPerPixel, turnUp, state }: Frame) {
      setHidden(group, !state.rings);
      setAttribute(group, 'transform', `translate(${px(pin.x)} ${px(pin.y)})`);
      const reach = Math.min(size.width, size.height) / 2 - EDGE_MARGIN_PX;
      const drawn = state.rings ? planFor(metersPerPixel, reach, state.units) : null;

      labels.forEach((label, index) => {
        const circle = circles[index] as SVGCircleElement;
        const casing = casings[index] as SVGCircleElement;
        const ring = drawn?.rings[index];
        setHidden(circle, !ring);
        setHidden(casing, !ring);
        let spot: ScreenPoint | null = null;
        if (ring) {
          const radius = ring.meters / metersPerPixel;
          setAttribute(circle, 'r', px(radius));
          setAttribute(casing, 'r', px(radius));
          setText(label, drawn?.labels[index] ?? '');
          if (radius >= (turnUp ? KNOB_REACH_PX : NAME_ROOM_PX)) spot = ringLabelSpot(pin, radius, size, LABEL_INSET);
        }
        spots[index] = spot;
        setHidden(label, !spot);
        if (spot) centerOn(label, spot.x, spot.y);
      });
    },
    reserved() {
      const boxes: ScreenBox[] = [];
      labels.forEach((label, index) => {
        const spot = spots[index];
        const size = sizes.of(label);
        if (spot && size) boxes.push(boxAround(spot, size.width, size.height));
      });
      return boxes;
    },
    destroy() {
      group.remove();
      for (const label of labels) label.remove();
    },
  };
}
