import type { Drive, RouteFinding } from '../app/types';
import { PLATE_FAMILY } from '../dom/text-width';
import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { formatDistance, formatDuration, type Units } from '../geo/units';
import type { ScreenBox, ScreenPoint, Sheet } from '../map/contracts';
import { centerOn, html, px, setAttribute, setHidden, setText, setTransform, svg } from './dom';
import { boxAround, boxesOverlap, distanceBetween, nearestOnArcs, pointAtAngle, ringArcsInside, type RingArc } from './geometry';
import type { StageSize } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';
import type { Sizes } from './sizes';

/** The plaque's lettering and box. Keep in step with .wwiwiwh-drive-plaque in instruments.css. */
const PLAQUE_FONT = `600 13px ${PLATE_FAMILY}`;
const PLAQUE_HEIGHT_PX = 20;
const PLAQUE_PADDING_X_PX = 7;
/** From the end's centre up to the plaque's: clear of the mark, and of the route arriving from any side. */
const PLAQUE_LIFT_PX = 24;
const START_RADIUS = 5.5;
const END_RADIUS = 5;
/** Place names keep clear of a square this size about each end. */
const END_CLEARANCE_PX = 16;

/**
 * The rings' dashes, by which they are told apart from each other and from the dots of the pin's
 * rings: plain dashes for the straight line, a dash and a dot for the road. Set from here and not
 * from the stylesheet: each stretch of a ring starts on a whole run of its pattern (see `ringPath`).
 */
const STRAIGHT_DASHES: readonly number[] = [7, 6];
const ROAD_DASHES: readonly number[] = [11, 5, 1, 5];
/** A ring is drawn this far past the stage's edges, so that no dash ends in sight. */
const RING_OVERDRAW_PX = 8;
/** A ring tighter than this would crowd the start's own mark. */
const SMALLEST_RING_PX = 14;
/** And one tighter than this is drawn without its label, which would sit on the drive. */
const RING_LABEL_FROM_PX = 40;
/** Air between a ring's label and the stage's edge. */
const RING_LABEL_AIR_PX = 6;
/** A label's box before the browser has laid it out. */
const RING_LABEL_GUESS = { width: 92, height: 16 };
/** Where round a ring its label is tried, in turn: the top, as on the pin's rings, then the foot and the sides. */
const RING_LABEL_BEARINGS: readonly number[] = [0, 180, 90, 270];

const DEG = Math.PI / 180;

/** "17.4 mi · 22 min": the two figures a drive is known by. */
export function driveFigures(route: RouteFinding | null, units: Units): string {
  return route?.status === 'found' ? `${formatDistance(route.route.meters, units)} · ${formatDuration(route.route.seconds)}` : '';
}

/**
 * The path of the stretches of a ring that show. Every stretch starts on a whole dash counted from
 * the top of the ring, so the dashes stay put on the ring while the maps are panned under the stage,
 * instead of crawling along it as its visible part changes.
 */
export function ringPath(center: ScreenPoint, radius: number, arcs: readonly RingArc[], dashPeriodPx: number): string {
  const period = dashPeriodPx / radius / DEG;
  const r = px(radius);
  return arcs
    .map((arc) => {
      const from = Math.floor(arc.from / period) * period;
      // In two halves: one arc command cannot go all the way round.
      const [a, middle, b] = [from, (from + arc.to) / 2, arc.to].map((degrees) => pointAtAngle(center, radius, degrees)) as [ScreenPoint, ScreenPoint, ScreenPoint];
      return `M${px(a.x)} ${px(a.y)}A${r} ${r} 0 0 1 ${px(middle.x)} ${px(middle.y)}A${r} ${r} 0 0 1 ${px(b.x)} ${px(b.y)}`;
    })
    .join('');
}

/**
 * The two ends of the drive: a ring where it starts, a dot where it ends, and at the end a plaque
 * with how far and how long it is by road. The road itself, and the area the same driving reaches
 * on the other place, are printed by the maps (see map/style/drawing.ts); these marks stay up when
 * Home is hidden, as every measurement does. The spot the reach starts from needs no mark of its
 * own: it is the spot under the start ring, on the other map.
 *
 * About the start go two rings, each lettered with its distance. The dashed one runs through the
 * end: everywhere as far from the start as the end is, as the crow flies. It needs no road service,
 * so it is up as soon as the drive has both its ends. The one of dashes and dots is as far out as
 * the drive is long by road, and waits for the road to be found; it is never the smaller of the
 * two, and the room between them is what the roads' winding costs. Each is one ring for both maps,
 * as the pin's rings are: on the other map they lie about the spot the reach starts from. They
 * belong to the drive, so they stay when the pin's rings are switched off.
 *
 * While a drive is being set, the start's mark also marks a start that has been put down and waits for its end.
 */
/** One of the drive's rings with its label. */
interface DriveRing {
  readonly group: SVGGElement;
  readonly label: HTMLElement;
  /**
   * Draws the ring of `radius` px about `center`, lettered with `text`, or takes it down when there
   * is no centre. Its label keeps off the boxes in `keptClear` where the ring gives it the room.
   */
  draw(center: ScreenPoint | null, radius: number, size: StageSize, text: string, keptClear: readonly ScreenBox[]): void;
  /** The label's box as last drawn, for whatever has to keep clear of it; none while it is not showing or not yet measured. */
  labelBox(): ScreenBox[];
  destroy(): void;
}

/**
 * Only what shows of a ring is drawn: zoomed in, the whole of it is many stages round, and dashing
 * all of that on every frame would cost far more than the sliver in sight.
 */
function createDriveRing(kind: 'straight' | 'road', dashes: readonly number[], sizes: Sizes): DriveRing {
  const casing = svg('path', { class: 'wwiwiwh-drive-ring__casing' });
  const line = svg('path', { class: `wwiwiwh-drive-ring wwiwiwh-drive-ring--${kind}`, 'stroke-dasharray': dashes.join(' ') });
  const group = svg('g', { class: 'wwiwiwh-drive-rings', hidden: '' }, [casing, line]);
  const label = html('div', `wwiwiwh-drive-ring-label wwiwiwh-drive-ring-label--${kind}`, { 'aria-hidden': 'true', hidden: '' });
  const period = dashes.reduce((sum, length) => sum + length, 0);
  sizes.watch(label);
  /** Where the label was last put; null while it is not showing. */
  let labelAt: ScreenPoint | null = null;

  return {
    group,
    label,
    draw(center, radius, size, text, keptClear) {
      const arcs =
        center && radius >= SMALLEST_RING_PX
          ? ringArcsInside(center, radius, { x: -RING_OVERDRAW_PX, y: -RING_OVERDRAW_PX, width: size.width + 2 * RING_OVERDRAW_PX, height: size.height + 2 * RING_OVERDRAW_PX })
          : [];
      setHidden(group, arcs.length === 0);
      labelAt = null;
      if (center && arcs.length > 0) {
        const path = ringPath(center, radius, arcs, period);
        setAttribute(casing, 'd', path);
        setAttribute(line, 'd', path);
        if (radius >= RING_LABEL_FROM_PX) {
          const { width, height } = sizes.of(label) ?? RING_LABEL_GUESS;
          const inset = { x: width / 2 + RING_LABEL_AIR_PX, y: height / 2 + RING_LABEL_AIR_PX };
          const lettered = ringArcsInside(center, radius, { x: inset.x, y: inset.y, width: size.width - 2 * inset.x, height: size.height - 2 * inset.y });
          // As near to each bearing as the stage shows of the ring; the first spot that covers nothing, or else the first.
          const spots = RING_LABEL_BEARINGS.map((bearing) => nearestOnArcs(lettered, bearing))
            .filter((degrees) => degrees !== null)
            .map((degrees) => pointAtAngle(center, radius, degrees));
          labelAt = spots.find((spot) => !keptClear.some((box) => boxesOverlap(boxAround(spot, width, height), box))) ?? spots[0] ?? null;
        }
      }
      setHidden(label, !labelAt);
      if (labelAt) {
        setText(label, text);
        centerOn(label, labelAt.x, labelAt.y);
      }
    },
    labelBox() {
      const size = sizes.of(label);
      // Before it is measured, the guess: the other ring's label keeps off it from the first frame.
      const { width, height } = size ?? RING_LABEL_GUESS;
      return labelAt ? [boxAround(labelAt, width, height)] : [];
    },
    destroy() {
      group.remove();
      label.remove();
    },
  };
}

export function createDrive({ dual, ink, layer, measurer, sizes }: InstrumentContext): Part {
  const straightRing = createDriveRing('straight', STRAIGHT_DASHES, sizes);
  const roadRing = createDriveRing('road', ROAD_DASHES, sizes);
  const start = [svg('circle', { class: 'wwiwiwh-drive__casing', r: START_RADIUS }), svg('circle', { class: 'wwiwiwh-drive__start', r: START_RADIUS })];
  const end = [svg('circle', { class: 'wwiwiwh-drive__casing', r: END_RADIUS }), svg('circle', { class: 'wwiwiwh-drive__end', r: END_RADIUS })];
  const startGroup = svg('g', { class: 'wwiwiwh-drive', hidden: '' }, start);
  const endGroup = svg('g', { class: 'wwiwiwh-drive', hidden: '' }, end);
  const plaque = html('div', 'wwiwiwh-drive-plaque', { 'aria-hidden': 'true', hidden: '' });
  // The rings first: the ends are drawn over them.
  ink.append(roadRing.group, straightRing.group, startGroup, endGroup);
  layer.append(roadRing.label, straightRing.label, plaque);

  let figures: { readonly route: RouteFinding | null; readonly units: Units; readonly text: string } | null = null;
  let straight: { readonly drive: Drive; readonly units: Units; readonly meters: number; readonly text: string } | null = null;
  let byRoad: { readonly route: RouteFinding | null; readonly units: Units; readonly text: string } | null = null;
  let boxes: readonly ScreenBox[] = [];

  function figuresText(route: RouteFinding | null, units: Units): string {
    if (figures?.route !== route || figures.units !== units) figures = { route, units, text: driveFigures(route, units) };
    return figures.text;
  }

  /** How far apart the drive's ends are in a straight line, and the words on the ring that far out. */
  function straightOf(drive: Drive, units: Units): { readonly meters: number; readonly text: string } {
    if (straight?.drive !== drive || straight.units !== units) {
      const meters = distanceMeters(drive.from, drive.to);
      straight = { drive, units, meters, text: `${formatDistance(meters, units)} straight` };
    }
    return straight;
  }

  /** The words on the ring as far out as the drive is long. */
  function byRoadText(route: RouteFinding | null, units: Units): string {
    if (byRoad?.route !== route || byRoad.units !== units) byRoad = { route, units, text: route?.status === 'found' ? `${formatDistance(route.route.meters, units)} by road` : '' };
    return byRoad.text;
  }

  const onStage = (sheet: Sheet, at: LngLat): ScreenPoint => (sheet === 'home' ? dual.projectHome(at) : dual.projectAway(at));

  function mark(group: SVGGElement, circles: readonly SVGCircleElement[], at: ScreenPoint | null): void {
    setHidden(group, !at);
    if (!at) return;
    for (const circle of circles) {
      setAttribute(circle, 'cx', px(at.x));
      setAttribute(circle, 'cy', px(at.y));
    }
  }

  return {
    layout({ state, size }: Frame) {
      const setting = state.mode === 'drive';
      const drive: Drive | null = state.drive;
      // A start that waits for its end is where the next drive begins: the ring goes there. The
      // drive already on the map keeps its road and its end until the new one takes its place.
      const startAt = setting && state.driveDraft ? onStage(state.driveSide, state.driveDraft.at) : drive ? onStage(drive.on, drive.from) : null;
      const endAt = drive ? onStage(drive.on, drive.to) : null;
      mark(startGroup, start, startAt);
      mark(endGroup, end, endAt);

      // While another drive is being set this one is on its way out: it keeps its road and its marks, not its figures.
      const text = endAt && !setting ? figuresText(state.route, state.units) : '';
      setHidden(plaque, text === '');
      const marks = [startAt, endAt].filter((at) => at !== null).map((at) => boxAround(at, END_CLEARANCE_PX, END_CLEARANCE_PX));
      let plaqueBox: ScreenBox | null = null;
      if (text !== '' && endAt) {
        const center = { x: endAt.x, y: endAt.y - PLAQUE_LIFT_PX };
        setText(plaque, text);
        setTransform(plaque, `translate(${px(center.x)}px, ${px(center.y)}px) translate(-50%, -50%)`);
        const width = measurer.width(PLAQUE_FONT, text) + 2 * PLAQUE_PADDING_X_PX;
        plaqueBox = boxAround(center, width, PLAQUE_HEIGHT_PX);
      }

      // The rings about the start. Like the plaque, they are put away while another drive is being set.
      const ringed = drive && startAt && endAt && !setting ? { drive, startAt, endAt } : null;
      const across = ringed ? straightOf(ringed.drive, state.units) : null;
      const throughEnd = ringed ? distanceBetween(ringed.startAt, ringed.endAt) : 0;
      // The straight ring's label keeps off the end the ring runs through, and off the plaque over that end.
      const keptClear = ringed ? [boxAround(ringed.endAt, END_CLEARANCE_PX, END_CLEARANCE_PX), ...(plaqueBox ? [plaqueBox] : [])] : [];
      straightRing.draw(ringed?.startAt ?? null, throughEnd, size, across?.text ?? '', keptClear);
      // The road's ring is the straight one grown by as much as the road is longer, so the two agree
      // about the scale at the end the first runs through. Its label keeps off the other's as well:
      // a road that hardly winds has the two rings all but together.
      const driven = ringed && across && across.meters > 0 && state.route?.status === 'found' ? state.route.route.meters : null;
      roadRing.draw(
        driven !== null && ringed ? ringed.startAt : null,
        driven !== null && across ? (throughEnd * driven) / across.meters : 0,
        size,
        byRoadText(state.route, state.units),
        [...keptClear, ...straightRing.labelBox()],
      );

      boxes = [...(plaqueBox ? [plaqueBox] : []), ...marks];
    },
    reserved: () => [...boxes, ...straightRing.labelBox(), ...roadRing.labelBox()],
    destroy() {
      straightRing.destroy();
      roadRing.destroy();
      startGroup.remove();
      endGroup.remove();
      plaque.remove();
    },
  };
}
