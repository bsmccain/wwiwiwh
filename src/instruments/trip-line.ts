import { PLATE_FAMILY, type TextMeasurer } from '../dom/text-width';
import type { ScreenBox, ScreenPoint } from '../map/contracts';
import { html, px, setAttribute, setHidden, setText, setTransform, svg } from './dom';
import { distanceBetween, plaqueCenter, plaqueFits, rotatedBoxBounds, uprightAngle, type PlaquePlacement, type StageSize } from './geometry';
import { PIN_CLEARANCE_PX } from './pin';

/** The plaque's lettering and box. Keep in step with .mapz-trip-plaque in instruments.css. */
const PLAQUE_FONT = `600 13px ${PLATE_FAMILY}`;
const PLAQUE_HEIGHT_PX = 20;
const PLAQUE_PADDING_X_PX = 7;
const PLAQUE_PLACEMENT: PlaquePlacement = {
  inset: 36,
  // The plaque rides just clear of the line.
  lift: PLAQUE_HEIGHT_PX / 2 + 5,
  shortestVisible: 96,
};
const END_RADIUS = 4.5;
/** Kept free of the plaque at each end of the line: as often as not the pin is there, with the square kept clear about it. */
const END_ROOM_PX = PIN_CLEARANCE_PX / 2;

export interface TripLine {
  /**
   * Draws the line between two stage positions with `text` on its plaque. The plaque is left off when
   * the text is empty, and when the line is too short on screen to carry it.
   */
  draw(from: ScreenPoint, to: ScreenPoint, text: string, size: StageSize): void;
  hide(): void;
  /** The upright box around the plaque as last drawn, or null when no plaque is showing. */
  plaqueBox(): ScreenBox | null;
  destroy(): void;
}

/**
 * A straight line in key ink with a sheet-coloured casing, a small ring at each end and its length on
 * a plaque set along it. Drawn for the trip itself and, dashed, for the rubber band while measuring.
 */
export function createTripLine(ink: SVGSVGElement, layer: HTMLElement, measurer: TextMeasurer, kind: 'trip' | 'draft'): TripLine {
  const lines = [svg('line', { class: 'mapz-trip__casing' }), svg('line', { class: 'mapz-trip__line' })];
  const ends = [svg('circle', { class: 'mapz-trip__end', r: END_RADIUS }), svg('circle', { class: 'mapz-trip__end', r: END_RADIUS })] as const;
  const group = svg('g', { class: `mapz-trip mapz-trip--${kind}`, hidden: '' }, [...lines, ...ends]);
  const plaque = html('div', `mapz-trip-plaque mapz-trip-plaque--${kind}`, { 'aria-hidden': 'true', hidden: '' });
  ink.append(group);
  layer.append(plaque);

  let box: ScreenBox | null = null;

  return {
    draw(from, to, text, size) {
      setHidden(group, false);
      for (const line of lines) {
        setAttribute(line, 'x1', px(from.x));
        setAttribute(line, 'y1', px(from.y));
        setAttribute(line, 'x2', px(to.x));
        setAttribute(line, 'y2', px(to.y));
      }
      [from, to].forEach((point, index) => {
        const end = ends[index as 0 | 1];
        setAttribute(end, 'cx', px(point.x));
        setAttribute(end, 'cy', px(point.y));
      });

      const width = text === '' ? 0 : measurer.width(PLAQUE_FONT, text) + 2 * PLAQUE_PADDING_X_PX;
      // A plaque about as long as its line would lie across whatever the line ends on: the pin, often.
      const shown = text !== '' && plaqueFits(distanceBetween(from, to), width, END_ROOM_PX);
      setHidden(plaque, !shown);
      if (!shown) {
        box = null;
        return;
      }
      const angle = uprightAngle(from, to);
      const center = plaqueCenter(from, to, size, PLAQUE_PLACEMENT);
      setText(plaque, text);
      setTransform(plaque, `translate(${px(center.x)}px, ${px(center.y)}px) rotate(${px(angle)}deg) translate(-50%, -50%)`);
      box = rotatedBoxBounds(center, width, PLAQUE_HEIGHT_PX, angle);
    },
    hide() {
      setHidden(group, true);
      setHidden(plaque, true);
      box = null;
    },
    plaqueBox: () => box,
    destroy() {
      group.remove();
      plaque.remove();
    },
  };
}
