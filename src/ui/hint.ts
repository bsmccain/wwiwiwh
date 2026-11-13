import './notes.css';
import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { DualMap } from '../map/contracts';
import { boxIsNearPoint, boxIsNearSegment } from './clearance';
import { button, el, setText } from './dom';
import { icon } from './icons';
import type { Layout } from './layout';
import type { Overlays } from './overlays';

/** Clear sheet kept between the note and the pin's mark, and between the note and the trip line. */
const PIN_CLEARANCE_PX = 28;
const TRIP_CLEARANCE_PX = 12;

function wording(home: string, touch: boolean): string {
  return touch ? `Tap Slide Home to move ${home} on its own.` : `Hold Shift and drag to slide ${home} on its own.`;
}

/**
 * The one-time note about sliding Home on its own, at the top of the stage.
 *
 * It comes up once the first view is drawn, and is retired for good the first time Home is slid on
 * its own (a slide gesture, or slide mode switched on) or the note is closed. Until then it steps
 * aside, out of sight, whenever it would lie over the pin or the trip, and while a picker, the More
 * menu or a dialog is open.
 */
export function offerSlideHint(deps: {
  store: Store<AppState>;
  dual: DualMap;
  controller: Pick<Controller, 'finishSlideHint'>;
  layout: Layout;
  overlays: Overlays;
  /** The top of the stage, where the note goes. */
  host: HTMLElement;
  /** The map layers, in whose coordinates the pin and the trip are projected. */
  stage: HTMLElement;
  /** Where focus goes when the note is closed from the keyboard: the tool the note is about. */
  focusAfterClose: () => void;
}): void {
  const { store, dual, controller, layout, overlays } = deps;
  if (store.get().slideHintDone) return;

  const text = el('p', 'hint__text');
  const close = button('hint__close', {}, [icon('close'), 'Close']);
  const note = el('aside', 'hint hint--aside', { 'aria-label': 'Tip' }, [text, close]);
  /** The first view has been drawn, so the note may come up. */
  let shown = false;
  let retired = false;

  const word = (): void => setText(text, wording(store.get().home.name, layout.touch()));

  /** Whether the note, where it stands, lies over the pin or the trip. Reads layout: call it at rest only. */
  const coversThePicture = (): boolean => {
    const origin = deps.stage.getBoundingClientRect();
    const rect = note.getBoundingClientRect();
    const box = { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
    if (boxIsNearPoint(box, dual.projectAway(dual.getRegistration().baseAnchor), PIN_CLEARANCE_PX)) return true;
    const { trip } = store.get();
    return trip !== null && boxIsNearSegment(box, dual.projectHome(trip.from), dual.projectHome(trip.to), TRIP_CLEARANCE_PX);
  };

  const place = (): void => {
    if (!shown || retired) return;
    note.classList.toggle('hint--aside', overlays.isOpen() || coversThePicture());
  };

  const finish = (): void => controller.finishSlideHint();

  close.addEventListener('click', () => {
    // The note is about to go; focus moves to the tool it was about.
    if (document.activeElement === close) deps.focusAfterClose();
    finish();
  });

  const stops = [
    store.subscribe((state, previous) => {
      if (state.slideHintDone) {
        retired = true;
        for (const stop of stops) stop();
        resizes.disconnect();
        note.remove();
        return;
      }
      if (state.mode === 'slide') finish();
      if (state.home !== previous.home) word();
      if (state.trip !== previous.trip) place();
    }),
    dual.on('gesture', ({ kind, phase }) => {
      if (kind === 'slide' && phase === 'start') finish();
    }),
    dual.on('viewchange', place),
    dual.on('registrationchange', ({ final }) => {
      if (final) place();
    }),
    dual.on('idle', () => {
      if (shown) return;
      shown = true;
      place();
    }),
  ];
  overlays.onChange(place);
  layout.onChange(word);
  // A new wording or a new stage size moves the note's box.
  const resizes = new ResizeObserver(place);
  resizes.observe(note);
  resizes.observe(deps.host);

  word();
  deps.host.append(note);
}
