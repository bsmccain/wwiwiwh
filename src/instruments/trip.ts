import type { Place, Trip } from '../app/types';
import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { formatDistance, type Units } from '../geo/units';
import type { ScreenPoint } from '../map/contracts';
import { centerOn, html, hugFocus, setClass, setHidden } from './dom';
import { bindDrag } from './drag';
import { arrowNudge, boxAround, distanceBetween } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';
import { restHandle, samePosition, type Rest } from './resting';
import { createTripLine } from './trip-line';

type TripEnd = 'from' | 'to';

/** How wide an end's ring is with the focus ring that hugs it. Place names keep clear of a square that size. */
const END_CLEARANCE_PX = 18;

interface Grab {
  /** From the pointer to the end's own centre: kept, so the end does not jump under the pointer. */
  readonly offset: ScreenPoint;
  /** The trip as it was when the end was grabbed, and the place it was drawn on. */
  readonly trip: Trip;
  readonly home: Place;
}

/** One end's handle, and what it needs to know to rest when it should. */
interface EndHandle {
  readonly end: TripEnd;
  readonly button: HTMLButtonElement;
  readonly rest: Rest;
  /** The Home position it held when it was last laid out; null while there is no trip. */
  spot: LngLat | null;
}

/** Whether a trip end lies under a pin that is leaving its presses to the map, where it would take them in the pin's place. */
function liesUnderPin(end: ScreenPoint, pin: ScreenPoint, pinAsideRadius: number | null): boolean {
  return pinAsideRadius !== null && distanceBetween(end, pin) <= pinAsideRadius;
}

/** The trip with one end moved. That end's name is dropped: it named the old spot. */
export function moveTripEnd(trip: Trip, end: TripEnd, position: LngLat): Trip {
  if (end === 'from') return { from: position, to: trip.to, ...(trip.toName === undefined ? {} : { toName: trip.toName }) };
  return { from: trip.from, to: position, ...(trip.fromName === undefined ? {} : { fromName: trip.fromName }) };
}

/**
 * The trip: one straight line the person knows, with its great-circle length on a plaque. It is
 * stored in Home coordinates, so it rides along when Home is slid or turned. Both ends are handles,
 * and like the pin each of them rests when it was put under the pointer (see `Rest`): by the click
 * that finished measuring, by an address picked for it, or by Home moving under it.
 */
export function createTrip({ dual, store, ink, layer, measurer, sizes, pointers, relayout }: InstrumentContext): Part {
  const line = createTripLine(ink, layer, measurer, 'trip');
  const cleanups: (() => void)[] = [];
  let length: { readonly trip: Trip; readonly units: Units; readonly text: string } | null = null;
  /** Where the two ends were last drawn; null while there is no trip. */
  let ends: readonly [ScreenPoint, ScreenPoint] | null = null;

  function lengthText(trip: Trip, units: Units): string {
    if (length?.trip !== trip || length.units !== units) {
      length = { trip, units, text: formatDistance(distanceMeters(trip.from, trip.to), units) };
    }
    return length.text;
  }

  function moveEndTo(end: TripEnd, point: ScreenPoint): void {
    const trip = store.get().trip;
    if (trip) store.set({ trip: moveTripEnd(trip, end, dual.unprojectHome(point)) });
  }

  function endOnStage(end: TripEnd): ScreenPoint | null {
    const trip = store.get().trip;
    return trip ? dual.projectHome(trip[end]) : null;
  }

  function endHandle(end: TripEnd, label: string): EndHandle {
    const button = html('button', 'wwiwiwh-trip-end wwiwiwh-handle', { type: 'button', 'aria-label': label, hidden: '' });
    hugFocus(button, END_CLEARANCE_PX);
    layer.append(button);
    const { rest, unbind: unbindRest } = restHandle(button, sizes, pointers, relayout);

    cleanups.push(
      bindDrag<Grab>(button, layer, {
        start: (point) => {
          const { trip, home } = store.get();
          if (!trip) return null;
          rest.takeHold();
          const at = dual.projectHome(trip[end]);
          return { offset: { x: at.x - point.x, y: at.y - point.y }, trip, home };
        },
        move: (point, { offset }) => moveEndTo(end, { x: point.x + offset.x, y: point.y + offset.y }),
        end: ({ trip, home }, { moved, cancelled }) => {
          try {
            // Escape puts the trip back as it was grabbed, unless Home was changed under the drag:
            // that trip was drawn on another place.
            if (moved && cancelled && store.get().home === home) store.set({ trip });
          } finally {
            rest.letGo();
          }
        },
      }),
      unbindRest,
    );

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const nudge = arrowNudge(event);
      const at = nudge && endOnStage(end);
      if (!nudge || !at) return;
      event.preventDefault();
      event.stopPropagation();
      rest.byItself(() => moveEndTo(end, { x: at.x + nudge.x, y: at.y + nudge.y }));
    };
    button.addEventListener('keydown', onKeyDown);
    cleanups.push(() => {
      button.removeEventListener('keydown', onKeyDown);
      button.remove();
    });
    return { end, button, rest, spot: null };
  }

  const handles = [endHandle('from', 'Trip start'), endHandle('to', 'Trip end')] as const;

  /** Tells an end's handle what it holds and where that is drawn now, which is where it finds out that it should rest. */
  function settle(handle: EndHandle, spot: LngLat | null, at: ScreenPoint | null): void {
    const putElsewhere = !samePosition(spot, handle.spot);
    handle.spot = spot;
    if (putElsewhere) handle.rest.put();
    handle.rest.drawnAt(at);
  }

  return {
    layout({ size, state, pin, pinAsideRadius }: Frame) {
      const { trip } = state;
      for (const { button } of handles) setHidden(button, !trip);
      if (!trip) {
        for (const handle of handles) settle(handle, null, null);
        line.hide();
        ends = null;
        return;
      }
      const from = dual.projectHome(trip.from);
      const to = dual.projectHome(trip.to);
      // While a new trip is being measured this one is on its way out: it keeps its line, not its figure.
      line.draw(from, to, state.mode === 'measure' ? '' : lengthText(trip, state.units), size);
      ends = [from, to];
      for (const handle of handles) {
        const at = handle.end === 'from' ? from : to;
        settle(handle, trip[handle.end], at);
        centerOn(handle.button, at.x, at.y);
        setClass(handle.button, 'is-aside', handle.rest.isResting() || liesUnderPin(at, pin, pinAsideRadius));
      }
    },
    reserved() {
      if (!ends) return [];
      const marks = ends.map((end) => boxAround(end, END_CLEARANCE_PX, END_CLEARANCE_PX));
      const plaque = line.plaqueBox();
      return plaque ? [plaque, ...marks] : marks;
    },
    destroy() {
      for (const cleanup of cleanups) cleanup();
      line.destroy();
    },
  };
}
