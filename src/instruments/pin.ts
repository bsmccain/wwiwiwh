import type { Place } from '../app/types';
import type { Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { ScreenPoint } from '../map/contracts';
import { drawing, html, hugFocus, px, setAttribute, setClass, setHidden, setTransform, svg } from './dom';
import { bindDrag } from './drag';
import { arrowNudge, boxAround, distanceBetween } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';
import { restHandle, samePosition } from './resting';

/** The register mark: a ring with a cross through it, about 23 px across. */
const RING_RADIUS = 7;
const CROSS_REACH = 11.5;
/**
 * How wide the mark is with the focus ring that hugs it. Place names keep clear of a square that
 * size about the pin, and so does the plaque of a trip that ends on it.
 */
export const PIN_CLEARANCE_PX = 32;
/**
 * How far a mouse may slip between going down on the pin and coming up and still have clicked it. A
 * click opens the pin's menu, and a drag slides Home and gives up the name of the spot it was on, so
 * the pin asks for more than a handle that only drags.
 */
const MOUSE_SLOP_PX = 6;
/** A finger's tap on the pin opens its menu, so a tap that rolls a little must not count as a drag. */
const TOUCH_SLOP_PX = 10;

function ringAndCross(className: string): SVGGElement {
  return svg('g', { class: className }, [
    svg('circle', { r: RING_RADIUS }),
    svg('path', { d: `M${-CROSS_REACH} 0H${CROSS_REACH}M0 ${-CROSS_REACH}V${CROSS_REACH}` }),
  ]);
}

interface Grab {
  /** From the pointer to the pin's own centre: kept, so the pin does not jump under the pointer. */
  readonly offset: ScreenPoint;
  /** Where on Away the pin sat when it was grabbed, and the places that were on the maps then. */
  readonly anchor: LngLat;
  readonly home: Place;
  readonly away: Place;
}

export interface Pin extends Part {
  /** Rides on the pin: whatever is put in it is positioned from the pin's own spot. */
  readonly group: HTMLElement;
  /** The handle itself: a button. */
  readonly handle: HTMLElement;
  focus(): void;
  /**
   * Told before every layout how Home is registered and where that draws the pin: here the pin finds
   * out that it was put somewhere or moved with the maps, and goes to rest. Before the layout, so
   * that every part is laid out knowing whether the pin takes its presses.
   */
  placed(registration: Registration, at: ScreenPoint): void;
  /**
   * While the pin leaves presses to the map (it rests, or slide mode is on): how far from its centre
   * its own target reaches, so that a handle lying under it can step aside with it. Null while the
   * pin takes its presses itself.
   */
  asideRadius(): number | null;
  /** Calls back when the pin is clicked, tapped, or activated from the keyboard, without having been dragged. */
  onActivate(listener: () => void): () => void;
}

/**
 * The pin: the one spot where Home and Away are held together, drawn as a printer's register mark.
 * Dragging it (or its arrow keys) slides Home under it without re-pinning: the same Home spot stays
 * pinned, and only where it sits on Away changes. A click that drags nothing activates it.
 *
 * That holds for a pin the person went to. One that came to the pointer rests (see `Rest`): a slide
 * on the map ends with the pin right under the pointer; a spot picked from a list, P, Swap or a
 * followed link lands it wherever the pointer happens to be; and the maps can carry it there. Its
 * handle then lets presses through to the map, where a drag pans or (with Shift) slides like a drag
 * anywhere else. A click on a resting pin is still the pin's.
 * In slide mode the handle steps aside throughout: there every press on the map slides Home.
 */
export function createPin({ dual, store, layer, sizes, pointers, relayout }: InstrumentContext): Pin {
  const northTick = svg('path', { class: 'wwiwiwh-pin__north', d: 'M0 -19.5L-3.4 -14.2H3.4Z' });
  const handle = html('button', 'wwiwiwh-pin wwiwiwh-handle', {
    type: 'button',
    'aria-label': 'The pin',
    'aria-haspopup': 'dialog',
    // Read out after the name, and shown by the browser when a mouse lingers on the pin.
    title: 'Drag to slide Home, or use the arrow keys. Click or press Enter to set the pin by address.',
  });
  hugFocus(handle, PIN_CLEARANCE_PX);
  handle.append(
    drawing('wwiwiwh-pin__mark', { viewBox: '-20 -20 40 40', width: 40, height: 40 }, [
      ringAndCross('wwiwiwh-pin__halo'),
      ringAndCross('wwiwiwh-pin__ink'),
      svg('circle', { class: 'wwiwiwh-pin__dot', r: 1.75 }),
      northTick,
    ]),
  );
  const group = html('div', 'wwiwiwh-pin-group');
  group.append(handle);
  layer.append(group);
  const { rest, unbind: unbindRest } = restHandle(handle, sizes, pointers, relayout);

  let at: ScreenPoint = { x: 0, y: 0 };
  /** How Home was registered when the pin was last told where it is: the two spots it held together then. */
  let pinned = dual.getRegistration();

  const pinOnStage = (): ScreenPoint => dual.projectAway(dual.getRegistration().baseAnchor);
  const slideTo = (target: ScreenPoint, final: boolean): void => {
    dual.setRegistration({ ...dual.getRegistration(), baseAnchor: dual.unprojectAway(target) }, { final });
  };

  // --- activation ---

  const activateListeners = new Set<() => void>();
  const activate = (): void => {
    for (const listener of [...activateListeners]) listener();
  };
  /** The press that last ended on the handle moved the pin: the click that follows it ends a drag. */
  let dragged = false;

  const unbindDrag = bindDrag<Grab>(
    handle,
    layer,
    {
      start: (point) => {
        dragged = false;
        rest.takeHold();
        const pin = pinOnStage();
        const { home, away } = store.get();
        return { offset: { x: pin.x - point.x, y: pin.y - point.y }, anchor: dual.getRegistration().baseAnchor, home, away };
      },
      move: (point, { offset }) => slideTo({ x: point.x + offset.x, y: point.y + offset.y }, false),
      end: ({ anchor, home, away }, { moved, cancelled }) => {
        dragged = moved;
        try {
          // A drag that moved Home made unfinished changes, and one finished change closes it, wherever
          // it leaves Home. A press that moved nothing has nothing to close.
          if (!moved) return;
          const registration = dual.getRegistration();
          const state = store.get();
          // Escape puts the pin back where it was grabbed, unless the places were changed under the
          // drag: that spot was on another map.
          const putBack = cancelled && state.home === home && state.away === away;
          dual.setRegistration(putBack ? { ...registration, baseAnchor: anchor } : registration, { final: true });
        } finally {
          rest.letGo();
        }
      },
    },
    { mouseSlopPx: MOUSE_SLOP_PX, touchSlopPx: TOUCH_SLOP_PX },
  );

  const listeners = new AbortController();
  const { signal } = listeners;

  handle.addEventListener(
    'click',
    (event) => {
      // A click from the keyboard or from assistive tech has no press behind it (and no detail).
      const endsDrag = dragged && event.detail > 0;
      dragged = false;
      if (!endsDrag) activate();
    },
    { signal },
  );

  handle.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented) return;
      const nudge = arrowNudge(event);
      if (!nudge) return;
      // The arrows belong to the pin while it has focus; they must not also pan the maps.
      event.preventDefault();
      event.stopPropagation();
      const pin = pinOnStage();
      rest.byItself(() => slideTo({ x: pin.x + nudge.x, y: pin.y + nudge.y }, true));
    },
    { signal },
  );

  // A resting pin lets its clicks through to the map as well. One that lands on it is still the pin's
  // (while measuring it places a trip end like a click anywhere else).
  const offClick = dual.on('click', ({ point }) => {
    if (!rest.isResting() || store.get().mode !== 'browse' || distanceBetween(point, pinOnStage()) > rest.reach()) return;
    dual.claimClick();
    // As the press would have done had the handle taken it: the keyboard carries on from the pin, and
    // the turn knob comes up for a finger, which cannot hover to bring it up.
    handle.focus({ preventScroll: true });
    activate();
  });

  const steppedAside = (): boolean => rest.isResting() || store.get().mode === 'slide';

  return {
    group,
    handle,
    focus: () => handle.focus({ preventScroll: true }),
    placed(registration, where) {
      // Either spot changing is the pin being put somewhere, even when it is drawn where it was: a
      // spot picked while the pin sits in the middle of the view leaves it there.
      const putElsewhere =
        !samePosition(registration.baseAnchor, pinned.baseAnchor) || !samePosition(registration.overlayAnchor, pinned.overlayAnchor);
      pinned = registration;
      if (putElsewhere) rest.put();
      rest.drawnAt(where);
    },
    asideRadius: () => (steppedAside() ? rest.reach() : null),
    onActivate(listener) {
      activateListeners.add(listener);
      return () => activateListeners.delete(listener);
    },
    layout({ pin, registration, pinAsideRadius }: Frame) {
      at = pin;
      setTransform(group, `translate(${px(pin.x)}px, ${px(pin.y)}px)`);
      setClass(handle, 'is-aside', pinAsideRadius !== null);
      // A small tick shows which way Home's north points once Home has been turned.
      setHidden(northTick, registration.rotation === 0);
      setAttribute(northTick, 'transform', `rotate(${px(registration.rotation)})`);
    },
    reserved: () => [boxAround(at, PIN_CLEARANCE_PX, PIN_CLEARANCE_PX)],
    destroy() {
      unbindDrag();
      unbindRest();
      listeners.abort();
      offClick();
      activateListeners.clear();
      group.remove();
    },
  };
}
