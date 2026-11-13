import './scale-bar.css';
import { createTextMeasurer, onFontsLoaded, PLATE_FAMILY, type TextMeasurer } from '../dom/text-width';
import { formatFigure, formatRoundDistance, longestRoundDistance, type RoundDistance, type Units } from '../geo/units';
import { px, setAttribute, setHidden, svg } from './dom';

export interface ScaleBarTick {
  /** Where along the bar the numeral sits, from 0 (its start) to 1 (its end). */
  readonly at: number;
  readonly label: string;
}

export interface ScaleBarPlan {
  /** The ground distance the whole bar stands for. Its unit is lettered after the last numeral. */
  readonly distance: RoundDistance;
  /** How long the bar is drawn, in CSS pixels. */
  readonly lengthPx: number;
  /** Equal divisions of the bar, filled and hollow in turn. */
  readonly segments: number;
  readonly ticks: readonly ScaleBarTick[];
}

type Division = Pick<ScaleBarPlan, 'segments' | 'ticks'>;

/**
 * How bars of each round distance are divided and numbered. A bar stands for the same distance
 * through most of a zoom or a slide, so its numerals are lettered once, not on every frame.
 */
const divisions = new WeakMap<RoundDistance, Division>();

function divisionOf(distance: RoundDistance): Division {
  let division = divisions.get(distance);
  if (!division) {
    const inFifths = distance.value.toExponential(0).startsWith('5');
    const start: ScaleBarTick = { at: 0, label: '0' };
    const end: ScaleBarTick = { at: 1, label: formatFigure(distance.value) };
    division = {
      segments: inFifths ? 5 : 2,
      ticks: inFifths ? [start, end] : [start, { at: 0.5, label: formatFigure(distance.value / 2) }, end],
    };
    divisions.set(distance, division);
  }
  return division;
}

/**
 * Plans one bar of the scale: the longest round distance (1, 2 or 5 times a power of ten) in the
 * given units that is no longer than `maxLengthPx` on the ground scale given. A 1 or a 2 is halved
 * and numbered at the middle (0, 5, 10); a 5 is split into five and numbered at its ends only, so
 * every numeral stays a round one. Null when not even the shortest round distance fits.
 */
export function planScaleBar(metersPerPixel: number, maxLengthPx: number, units: Units): ScaleBarPlan | null {
  if (!(metersPerPixel > 0) || !(maxLengthPx > 0)) return null;
  const distance = longestRoundDistance(metersPerPixel * maxLengthPx, units);
  if (!distance) return null;
  return { distance, lengthPx: distance.meters / metersPerPixel, ...divisionOf(distance) };
}

/** Lettering of the numerals. Keep in step with .wwiwiwh-scale-bar text in scale-bar.css. */
const NUMERAL_FONT = `500 11.5px ${PLATE_FAMILY}`;
const BAR_HEIGHT = 5;
const TICK_LENGTH = 3;
/** Clear sheet between the two bars, so they read as two rules and not as one checkered block. */
const BAR_GAP = 2;
const UPPER_BAR_TOP = 14.5;
const LOWER_BAR_TOP = UPPER_BAR_TOP + BAR_HEIGHT + 1 + BAR_GAP;
const UPPER_NUMERAL_BASELINE = 9;
const LOWER_NUMERAL_BASELINE = LOWER_BAR_TOP + BAR_HEIGHT + 0.5 + TICK_LENGTH + 10;
const HEIGHT = LOWER_NUMERAL_BASELINE + 3;
/** Kept free past the end of the longest bar for half of its last numeral and the unit after it. */
const END_ROOM_PX = 30;
const UNIT_GAP_PX = 3;

type Row = 'upper' | 'lower';

interface DrawnBar {
  /** Places the bar's parts for a drawn length, and returns how far to the right its lettering reaches. */
  place(lengthPx: number): number;
}

/** Builds one bar's elements inside `group`. Everything hangs off whole pixels so the rules stay crisp. */
function drawBar(group: SVGGElement, plan: ScaleBarPlan, row: Row, measurer: TextMeasurer): DrawnBar {
  const top = row === 'upper' ? UPPER_BAR_TOP : LOWER_BAR_TOP;
  // Ticks start where the half-pixel-wide edge of the outline ends.
  const tickFrom = row === 'upper' ? top - 0.5 - TICK_LENGTH : top + BAR_HEIGHT + 0.5;
  const baseline = row === 'upper' ? UPPER_NUMERAL_BASELINE : LOWER_NUMERAL_BASELINE;

  const outline = svg('rect', { class: 'wwiwiwh-scale-bar__outline', x: 0.5, y: top, height: BAR_HEIGHT });
  const fills = Array.from({ length: Math.ceil(plan.segments / 2) }, () =>
    svg('rect', { class: 'wwiwiwh-scale-bar__fill', y: top, height: BAR_HEIGHT }),
  );
  const ticks = plan.ticks.map(() => svg('path', { class: 'wwiwiwh-scale-bar__tick' }));
  const numerals = plan.ticks.map((tick, index) => {
    const text = svg('text', { class: 'wwiwiwh-scale-bar__numeral', y: baseline, 'text-anchor': index === 0 ? 'start' : 'middle' });
    text.textContent = tick.label;
    return text;
  });
  const unit = svg('text', { class: 'wwiwiwh-scale-bar__unit', y: baseline });
  unit.textContent = plan.distance.unit;
  group.replaceChildren(outline, ...fills, ...ticks, ...numerals, unit);

  const lastLabel = plan.ticks.at(-1)?.label ?? '';
  const lastNumeralHalf = measurer.width(NUMERAL_FONT, lastLabel) / 2;
  const unitWidth = measurer.width(NUMERAL_FONT, plan.distance.unit);

  return {
    place(lengthPx) {
      const edge = (fraction: number): number => Math.round(lengthPx * fraction) + 0.5;
      setAttribute(outline, 'width', px(edge(1) - 0.5));
      fills.forEach((fill, index) => {
        const from = edge((2 * index) / plan.segments);
        setAttribute(fill, 'x', px(from));
        setAttribute(fill, 'width', px(edge((2 * index + 1) / plan.segments) - from));
      });
      plan.ticks.forEach((tick, index) => {
        const x = edge(tick.at);
        setAttribute(ticks[index] as SVGPathElement, 'd', `M${px(x)} ${tickFrom}v${TICK_LENGTH}`);
        setAttribute(numerals[index] as SVGTextElement, 'x', px(index === 0 ? 0 : x));
      });
      const unitAt = edge(1) + lastNumeralHalf + UNIT_GAP_PX;
      setAttribute(unit, 'x', px(unitAt));
      return unitAt + unitWidth;
    },
  };
}

function structureOf(plan: ScaleBarPlan | null): string {
  return plan ? formatRoundDistance(plan.distance) : '';
}

/**
 * The two-unit bar scale: miles above, kilometres below, each the longest round distance that fits.
 * Drawn as inline SVG in the current text colour. `update` takes the ground scale at the pin and the
 * room available for the whole drawing, lettering included; it only touches the DOM when the bars change.
 */
export function createScaleBar(container: HTMLElement): { update(metersPerPixel: number, maxWidthPx: number): void; destroy(): void } {
  const rows: readonly { readonly row: Row; readonly units: Units; readonly group: SVGGElement }[] = [
    { row: 'upper', units: 'mi', group: svg('g') },
    { row: 'lower', units: 'km', group: svg('g') },
  ];
  const root = svg('svg', { class: 'wwiwiwh-scale-bar', role: 'img', height: HEIGHT, focusable: 'false' }, rows.map((row) => row.group));
  container.append(root);
  const measurer = createTextMeasurer();

  let drawn: readonly (DrawnBar | null)[] = [null, null];
  let structure = '';
  let last: { readonly metersPerPixel: number; readonly maxWidthPx: number } | null = null;

  function render(metersPerPixel: number, maxWidthPx: number, redraw: boolean): void {
    const plans = rows.map(({ units }) => planScaleBar(metersPerPixel, maxWidthPx - END_ROOM_PX, units));
    const [miles, kilometres] = plans.map(structureOf);
    const nextStructure = `${miles}|${kilometres}`;
    if (redraw || nextStructure !== structure) {
      structure = nextStructure;
      drawn = rows.map(({ row, group }, index) => {
        const plan = plans[index];
        setHidden(group, !plan);
        return plan ? drawBar(group, plan, row, measurer) : null;
      });
      setAttribute(root, 'aria-label', miles && kilometres ? `Scale: the upper bar is ${miles} long, the lower bar ${kilometres}.` : 'Scale');
    }
    const reach = plans.reduce((widest, plan, index) => Math.max(widest, plan ? (drawn[index]?.place(plan.lengthPx) ?? 0) : 0), 0);
    const width = Math.ceil(reach) + 1;
    setAttribute(root, 'width', String(width));
    setAttribute(root, 'viewBox', `0 0 ${width} ${HEIGHT}`);
  }

  // Numerals measured before the web font arrived were measured in a fallback face.
  const stopListening = onFontsLoaded(() => {
    measurer.reset();
    if (last) render(last.metersPerPixel, last.maxWidthPx, true);
  });

  return {
    update(metersPerPixel, maxWidthPx) {
      if (last?.metersPerPixel === metersPerPixel && last.maxWidthPx === maxWidthPx) return;
      last = { metersPerPixel, maxWidthPx };
      render(metersPerPixel, maxWidthPx, false);
    },
    destroy() {
      stopListening();
      root.remove();
    },
  };
}
