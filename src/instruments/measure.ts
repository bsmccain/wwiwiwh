import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import { formatDistance } from '../geo/units';
import type { ScreenBox, ScreenPoint } from '../map/contracts';
import { drawing, html, setHidden, svg } from './dom';
import { boxAround, distanceBetween } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';
import { createTripLine } from './trip-line';

/** A second end this close to the first is the same spot pressed twice (a double-click), not a trip. */
const SAME_SPOT_PX = 6;
/** The centre mark's drawing is this wide; place names keep clear of a square that size. */
const CENTER_MARK_PX = 24;
/** Place names keep clear of a square this size about the end already placed. */
const END_CLEARANCE_PX = 12;
/** Keys held down along with something else: pressing one is not yet using the keyboard. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

export interface Measure extends Part {
  /** While measuring: drops the next trip end at the middle of the stage. */
  placeEndAtCenter(): void;
}

/**
 * Measuring: the next two clicks on the map draw a trip. After the first, a dashed rubber band runs
 * from it to the pointer, with the length so far.
 *
 * Without a pointer, ends are dropped at the middle of the stage (`placeEndAtCenter`), and a small
 * mark shows where that is. The mark is for people on that path only: it shows while the keyboard is
 * what was last used, and from the moment an end has been dropped at the middle.
 */
export function createMeasure({ dual, store, ink, layer, measurer, relayout }: InstrumentContext): Measure {
  const band = createTripLine(ink, layer, measurer, 'draft');
  const centerMark = html('div', 'wwiwiwh-measure-center', { 'aria-hidden': 'true', hidden: '' });
  centerMark.append(
    drawing('wwiwiwh-measure-center__mark', { viewBox: '-12 -12 24 24', width: CENTER_MARK_PX, height: CENTER_MARK_PX }, [
      svg('path', { class: 'wwiwiwh-measure-center__halo', d: 'M-8 0H8M0 -8V8' }),
      svg('path', { class: 'wwiwiwh-measure-center__ink', d: 'M-8 0H8M0 -8V8' }),
    ]),
  );
  layer.append(centerMark);

  /** The keyboard is what the person used last. Followed at all times: Measure may be switched on with a key. */
  let keyboardInUse = false;
  /** An end was dropped at the middle of the stage, so that is where the next one is expected too. */
  let droppedAtCenter = false;
  /** Where the mouse or pen is over the stage, once it has moved. Fingers do not hover. */
  let pointer: ScreenPoint | null = null;
  /** Where on the page the mouse or pen was last heard from, to tell a real move from a repeat. */
  let lastHeardAt: ScreenPoint | null = null;
  /** Pointer movement is followed only while measuring. */
  let following: AbortController | null = null;
  /** The picture as last laid out. */
  let centerAt: ScreenPoint | null = null;
  let firstEndAt: ScreenPoint | null = null;

  const measuring = (): boolean => store.get().mode === 'measure';
  const aimsAtCenter = (): boolean => droppedAtCenter || keyboardInUse;

  function setKeyboardInUse(on: boolean): void {
    if (keyboardInUse === on) return;
    keyboardInUse = on;
    if (measuring()) relayout();
  }

  const listeners = new AbortController();
  // In the capture phase: whatever else handles the key or the press, it still tells which is in use.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!MODIFIER_KEYS.has(event.key)) setKeyboardInUse(true);
    },
    { capture: true, signal: listeners.signal },
  );
  window.addEventListener(
    'pointerdown',
    (event) => {
      // A finger leaves nothing behind to aim with, and a mouse position from before it is stale.
      if (event.pointerType === 'touch') pointer = null;
      setKeyboardInUse(false);
    },
    { capture: true, signal: listeners.signal },
  );

  function followPointer(on: boolean): void {
    if (on === (following !== null)) return;
    if (!on) {
      following?.abort();
      following = null;
      pointer = null;
      lastHeardAt = null;
      droppedAtCenter = false;
      return;
    }
    following = new AbortController();
    const follow = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      // A pointer is also reported as moving when the page shifts under it, which is not the person
      // moving it. So the first report only says where it is, and a repeat of the same place is ignored.
      const before = lastHeardAt;
      lastHeardAt = { x: event.clientX, y: event.clientY };
      if (!before || (before.x === lastHeardAt.x && before.y === lastHeardAt.y)) return;

      const rect = layer.getBoundingClientRect();
      pointer = { x: lastHeardAt.x - rect.left, y: lastHeardAt.y - rect.top };
      const wasAtCenter = aimsAtCenter();
      keyboardInUse = false;
      const bandFollows = store.get().tripDraft !== null && !aimsAtCenter();
      if (bandFollows || wasAtCenter !== aimsAtCenter()) relayout();
    };
    // The layer itself takes no pointer input, so the pointer is followed from the window.
    window.addEventListener('pointermove', follow, { signal: following.signal });
  }

  function placeEnd(home: LngLat, at: ScreenPoint): void {
    const draft = store.get().tripDraft;
    if (!draft) {
      store.set({ tripDraft: home });
      return;
    }
    if (distanceBetween(dual.projectHome(draft), at) < SAME_SPOT_PX) return;
    store.set({ trip: { from: draft, to: home }, tripDraft: null, mode: 'browse' });
  }

  const offClick = dual.on('click', ({ point, home }) => {
    if (measuring()) placeEnd(home, point);
  });

  return {
    placeEndAtCenter() {
      if (!measuring()) return;
      const { width, height } = dual.getSize();
      const center = { x: width / 2, y: height / 2 };
      droppedAtCenter = true;
      placeEnd(dual.unprojectHome(center), center);
      // The first end changes the store, which lays everything out; a refused second one changes nothing.
      relayout();
    },
    layout({ size, state }: Frame) {
      const on = state.mode === 'measure';
      followPointer(on);
      const atCenter = on && aimsAtCenter();
      centerAt = atCenter ? { x: size.width / 2, y: size.height / 2 } : null;
      setHidden(centerMark, !atCenter);

      const draft = on ? state.tripDraft : null;
      if (!draft) {
        band.hide();
        firstEndAt = null;
        return;
      }
      firstEndAt = dual.projectHome(draft);
      const looseEnd = centerAt ?? pointer ?? firstEndAt;
      band.draw(firstEndAt, looseEnd, formatDistance(distanceMeters(draft, dual.unprojectHome(looseEnd)), state.units), size);
    },
    reserved() {
      const boxes: ScreenBox[] = [];
      if (firstEndAt) boxes.push(boxAround(firstEndAt, END_CLEARANCE_PX, END_CLEARANCE_PX));
      if (centerAt) {
        boxes.push(boxAround(centerAt, CENTER_MARK_PX, CENTER_MARK_PX));
        // Only a band that holds still is kept clear of. One that follows the pointer would shove names about under it.
        const plaque = band.plaqueBox();
        if (plaque) boxes.push(plaque);
      }
      return boxes;
    },
    destroy() {
      followPointer(false);
      listeners.abort();
      offClick();
      band.destroy();
      centerMark.remove();
    },
  };
}
