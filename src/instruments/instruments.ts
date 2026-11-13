import './instruments.css';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import { createTextMeasurer, onFontsLoaded } from '../dom/text-width';
import type { DualMap, ScreenBox } from '../map/contracts';
import { drawing, html, setClass } from './dom';
import { createEdgeChip } from './edge-chip';
import { createKnob } from './knob';
import { createMeasure } from './measure';
import type { Frame, InstrumentContext, Part } from './part';
import { createPin } from './pin';
import { watchPointers } from './resting';
import { createRings } from './rings';
import { watchSizes } from './sizes';
import { createTrip } from './trip';

export interface InstrumentsOptions {
  /** Element laid exactly over the map pair. The instruments fill it; it is never read for its size. */
  container: HTMLElement;
  dual: DualMap;
  store: Store<AppState>;
}

export interface Instruments {
  /**
   * Stage boxes that place names must keep clear of, so that names lettered above this layer never
   * cover a handle, a focus ring or a figure: the pin, the turn knob while it is up, the trip's ends
   * and its plaque, the ring labels, the chip that points at an off-stage pin, and what measuring
   * puts up. Lines (the rings, the trip, the turn ring) are not in it: names may lie over those.
   */
  reservedBoxes(): readonly ScreenBox[];
  /**
   * Calls back when those boxes changed with nothing else to say so: no map frame and no change of
   * the app's state (the turn knob coming up under the pointer, a label's size becoming known).
   * Returns a function that stops the calls.
   */
  onReservedChange(listener: () => void): () => void;
  /** While measuring: drops the next trip end at the centre of the stage (for people not using a pointer on the map). */
  placeTripEndAtCenter(): void;
  /** Calls back when the pin is clicked, tapped, or activated with Enter or Space, without having been dragged. Returns a function that unsubscribes. */
  onPinActivate(listener: () => void): () => void;
  /** The pin's handle: an anchor for a menu, and where focus returns to. */
  pinElement(): HTMLElement;
  destroy(): void;
}

/**
 * The parts of the state the instruments draw from. `homeHidden` is deliberately not among them: the
 * pin, the rings and the trip are measurements, not Home's ink, and stay up while Home is hidden.
 */
const DRAWN_FROM: readonly (keyof AppState)[] = ['trip', 'tripDraft', 'rings', 'units', 'mode'];

function sameBoxes(a: readonly ScreenBox[], b: readonly ScreenBox[]): boolean {
  return (
    a.length === b.length &&
    a.every((box, index) => {
      const other = b[index] as ScreenBox;
      return box.x === other.x && box.y === other.y && box.width === other.width && box.height === other.height;
    })
  );
}

/**
 * The instruments drawn over the map pair in key ink: the pin with its turn knob, the distance
 * rings, the trip line and the tools for measuring a new one. The layer takes no pointer input
 * itself; only the handles do, so the maps underneath stay fully usable. A handle takes the presses
 * of someone who went to it: the pin and the trip's ends rest, letting presses through to the map,
 * whenever they were put or carried to where the pointer may be (see resting.ts).
 */
export function createInstruments({ container, dual, store }: InstrumentsOptions): Instruments {
  const layer = html('div', 'mapz-instruments', { role: 'group', 'aria-label': 'Pin, turn knob and trip' });
  const ink = drawing('mapz-instruments__ink', {}, []);
  layer.append(ink);
  container.append(layer);

  const reservedListeners = new Set<() => void>();
  const tellReservedChanged = (): void => {
    for (const listener of [...reservedListeners]) listener();
  };

  const measurer = createTextMeasurer();
  const sizes = watchSizes(tellReservedChanged);
  const pointers = watchPointers(layer, dual.base.getCanvasContainer());
  const context: InstrumentContext = { dual, store, layer, ink, measurer, sizes, pointers, relayout: () => relayout() };
  // Built in the order Tab should visit the handles: the pin, its knob, the trip's ends, the chip.
  // What lies on top of what is set by z-index in the stylesheet.
  const pin = createPin(context);
  const knob = createKnob(context, pin.group);
  const rings = createRings(context);
  const trip = createTrip(context);
  const measure = createMeasure(context);
  const chip = createEdgeChip(context, () => pin.focus());
  const parts: readonly Part[] = [pin, knob, rings, trip, measure, chip];

  const reservedBoxes = (): readonly ScreenBox[] => parts.flatMap((part) => part.reserved());

  function layout(): void {
    const registration = dual.getRegistration();
    const state = store.get();
    const pinAt = dual.projectAway(registration.baseAnchor);
    // First of all: whether the pin takes its presses is part of the picture every part is laid out from.
    pin.placed(registration, pinAt);
    const frame: Frame = {
      size: dual.getSize(),
      registration,
      pin: pinAt,
      metersPerPixel: dual.metersPerPixel(registration.baseAnchor),
      turnUp: knob.isUp(),
      pinAsideRadius: pin.asideRadius(),
      state,
    };
    setClass(layer, 'mapz-instruments--turn-up', frame.turnUp);
    setClass(layer, 'mapz-instruments--measure', state.mode === 'measure');
    for (const part of parts) part.layout(frame);
  }

  /** A layout that nothing else announces, so whoever keeps clear of the boxes is told if they moved. */
  function relayout(): void {
    const before = reservedBoxes();
    layout();
    if (!sameBoxes(before, reservedBoxes())) tellReservedChanged();
  }

  // A handle covers a patch of Away's canvas. Turning the wheel there is still a zoom of the maps
  // about the pointer, and never a scroll or zoom of the page.
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    dual.passWheel(event);
  };
  layer.addEventListener('wheel', onWheel, { passive: false });

  const cleanups = [
    // Synchronously inside the maps' own frame, so nothing here trails the canvases.
    dual.on('frame', layout),
    store.subscribe((state, previous) => {
      if (DRAWN_FROM.some((key) => state[key] !== previous[key])) layout();
    }),
    // Widths measured before a web font arrived were those of its stand-in.
    onFontsLoaded(() => {
      measurer.reset();
      relayout();
    }),
    // Focus that a press left on a handle has done its job once the person goes back to moving the
    // maps: letting go of it puts the turn knob away. (A wheel turn or a finger panning the map
    // would never move it.) Focus that came from the keyboard is never taken away.
    dual.on('viewchange', ({ byUser }) => {
      const focused = document.activeElement;
      if (byUser && focused instanceof HTMLElement && layer.contains(focused) && !focused.matches(':focus-visible')) focused.blur();
    }),
  ];
  // The pair fires no frame until something moves.
  layout();

  return {
    reservedBoxes,
    onReservedChange(listener) {
      reservedListeners.add(listener);
      return () => reservedListeners.delete(listener);
    },
    placeTripEndAtCenter: () => measure.placeEndAtCenter(),
    onPinActivate: (listener) => pin.onActivate(listener),
    pinElement: () => pin.handle,
    destroy() {
      for (const cleanup of cleanups) cleanup();
      for (const part of parts) part.destroy();
      pointers.destroy();
      sizes.destroy();
      reservedListeners.clear();
      layer.remove();
    },
  };
}
