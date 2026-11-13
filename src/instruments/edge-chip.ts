import { distanceMeters } from '../geo/distance';
import { formatDistance } from '../geo/units';
import type { ScreenBox } from '../map/contracts';
import { centerOn, drawing, html, px, setAttribute, setHidden, setText, svg } from './dom';
import { boxAround, edgeChipSpot, type EdgeChipSpot, type Inset } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';

/** Room from the stage edge to the chip's centre: half the chip plus a margin. */
const CHIP_INSET: Inset = { x: 64, y: 34 };
/** The chip appears once the pin's mark has left the stage altogether. */
const PIN_MARK_REACH_PX = 14;
/** How far the chip's focus ring reaches past its edge (2 px off it, 2 px wide). Place names keep clear of the ring too. */
const FOCUS_REACH_PX = 4;

/**
 * The chip shown at the edge of the stage while the pin is off it: it points towards the pin, says
 * how far from the middle of the view the pin is, and brings the pin back into view when activated.
 * `takeFocus` is called when the chip goes away while it holds keyboard focus, which must go somewhere.
 */
export function createEdgeChip({ dual, layer, sizes }: InstrumentContext, takeFocus: () => void): Part {
  const arrow = svg('path', { d: 'M0 5.5V-5.5M-4 -1.5L0 -5.5L4 -1.5' });
  const word = html('span', 'mapz-pin-chip__word');
  word.textContent = 'Pin';
  const figure = html('span', 'mapz-pin-chip__figure');
  const chip = html('button', 'mapz-pin-chip', { type: 'button', hidden: '' });
  chip.append(drawing('mapz-pin-chip__arrow', { viewBox: '-8 -8 16 16', width: 16, height: 16 }, [arrow]), word, figure);
  layer.append(chip);
  sizes.watch(chip);

  // Going to the pin is the person's own move, like a drag would be, so the view it leads to is kept.
  const onClick = (): void => dual.setView({ center: dual.getRegistration().baseAnchor, zoom: dual.getView().zoom }, { asUser: true });
  chip.addEventListener('click', onClick);

  /** Where the chip was last put; null while the pin is on stage. */
  let spot: EdgeChipSpot | null = null;

  return {
    layout({ pin, size, registration, state }: Frame) {
      spot = edgeChipSpot(pin, size, CHIP_INSET, PIN_MARK_REACH_PX);
      // Keyboard focus must not be left on a control that is going away. (A pointer press leaves no
      // visible focus behind, and moving it would only make the turn knob pop up.)
      if (!spot && document.activeElement === chip && chip.matches(':focus-visible')) takeFocus();
      setHidden(chip, !spot);
      if (!spot) return;
      const distance = formatDistance(distanceMeters(dual.getView().center, registration.baseAnchor), state.units);
      setText(figure, distance);
      setAttribute(chip, 'aria-label', `Pin ${distance} away. Bring it into view.`);
      setAttribute(arrow, 'transform', `rotate(${px(spot.bearing)})`);
      centerOn(chip, spot.x, spot.y);
    },
    reserved(): readonly ScreenBox[] {
      const size = sizes.of(chip);
      return spot && size ? [boxAround(spot, size.width + 2 * FOCUS_REACH_PX, size.height + 2 * FOCUS_REACH_PX)] : [];
    },
    destroy() {
      chip.removeEventListener('click', onClick);
      chip.remove();
    },
  };
}
