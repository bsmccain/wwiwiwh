import { SCALE_DRIFT_LIMIT, type Controller } from '../app/controller';
import { spansToText } from '../app/readout';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { DualMap } from '../map/contracts';
import type { Announcer } from './announcer';
import { createCaptionStrip } from './caption';
import { captionFor, type CaptionAction, type ScaleDrift } from './caption-model';
import type { InputWatch } from './input-mode';
import type { Layout } from './layout';
import type { PinAddress } from './pin-address';
import type { Readouts } from './readouts';
import { NUDGE_STEP_PX } from './shortcuts';

const NUDGES: Readonly<Partial<Record<CaptionAction, readonly [dx: number, dy: number]>>> = {
  'slide-left': [-NUDGE_STEP_PX, 0],
  'slide-up': [0, -NUDGE_STEP_PX],
  'slide-down': [0, NUDGE_STEP_PX],
  'slide-right': [NUDGE_STEP_PX, 0],
};

/** What the announcer is told about; listed in the order it is spoken. */
export type SpokenChannel = 'turn' | 'pin' | 'caption' | 'rings';
export const SPOKEN_CHANNELS: readonly SpokenChannel[] = ['turn', 'pin', 'caption', 'rings'];

/** Where focus goes when a mode starts or ends. */
export interface ModeFocus {
  mapHasFocus(): boolean;
  focusMap(): void;
  focusTool(tool: 'slide' | 'measure'): void;
  /** On narrow screens, where slide mode's buttons take the place of the collar's tools: focus the first of them. */
  focusSlideRow(): void;
}

export interface Captioner {
  readonly element: HTMLElement;
  /**
   * Leaves slide or measure mode (the caption's Done and Cancel, and Escape). Focus that sat on the
   * mode's own controls, which go away with it, moves to the tool that started it.
   */
  leaveMode(): void;
}

/**
 * Keeps the caption band saying the one thing that matters now, carries out its buttons, moves
 * focus as modes come and go, and hands the settled wording to the announcer.
 */
export function createCaptioner(deps: {
  store: Store<AppState>;
  dual: DualMap;
  controller: Pick<Controller, 'slideBy' | 'squareUp' | 'cancel' | 'clearTrip' | 'pinAtCenter' | 'scaleDrift' | 'pinIsOnStage'>;
  readouts: Readouts;
  layout: Layout;
  input: InputWatch;
  announcer: Announcer<SpokenChannel>;
  focus: ModeFocus;
  /** Where the pin sentence's two spots and "To an address" lead. */
  pinAddress: Pick<PinAddress, 'toggleSpotPicker' | 'toggleTripTargetPicker'>;
}): Captioner {
  const { store, dual, controller, readouts, layout, input, announcer, focus, pinAddress } = deps;

  const leaveMode = (): void => {
    const { mode } = store.get();
    // Measuring by keyboard is done with focus on the map.
    const focusWasOnTheMode = strip.hasFocus() || (mode === 'measure' && focus.mapHasFocus());
    if (controller.cancel() && focusWasOnTheMode) focus.focusTool(mode === 'slide' ? 'slide' : 'measure');
  };

  const act = (action: CaptionAction, control: HTMLElement): void => {
    const nudge = NUDGES[action];
    if (nudge) {
      controller.slideBy(...nudge);
      return;
    }
    const focusWasHere = strip.hasFocus();
    switch (action) {
      case 'square-up':
        controller.squareUp();
        // The button has just been disabled or taken away under the focus that pressed it.
        if (focusWasHere) {
          if (layout.collarIsFull()) strip.focus('done');
          else focus.focusSlideRow();
        }
        break;
      case 'done':
      case 'cancel':
        leaveMode();
        break;
      case 'to-address':
        pinAddress.toggleTripTargetPicker(control);
        break;
      case 'clear-trip':
        controller.clearTrip();
        if (focusWasHere) focus.focusTool('measure');
        break;
      case 'pin-here':
        controller.pinAtCenter();
        if (focusWasHere) focus.focusMap();
        break;
    }
  };
  const strip = createCaptionStrip({ onAction: act, onSpot: (sheet, part) => pinAddress.toggleSpotPicker(sheet, part) });

  const measureDrift = (): ScaleDrift | null => {
    const drift = controller.scaleDrift();
    return drift > SCALE_DRIFT_LIMIT ? { percent: Math.round(drift * 100), pinOnStage: controller.pinIsOnStage() } : null;
  };
  let drift = measureDrift();
  let slidSinceModeOn = false;

  const draw = (): void => {
    const state = store.get();
    const turn = readouts.turn();
    const pin = readouts.pin();
    const caption = captionFor({
      mode: state.mode,
      tripStarted: state.tripDraft !== null,
      slidSinceModeOn,
      drift,
      trip: layout.shortSentences() ? readouts.tripInShort() : readouts.trip(),
      pin,
      turned: turn.turned,
      collarIsFull: layout.collarIsFull(),
      pinInCollar: layout.pinSentenceInCollar(),
      input: input.mode() === 'keyboard' ? 'keyboard' : layout.touch() ? 'touch' : 'mouse',
      singleKeys: state.shortcutsOn,
    });
    const spotHadFocus = strip.spotHasFocus();
    strip.draw(caption);
    // The band has gone on to say something else, and the spot that held focus went with the sentence.
    if (spotHadFocus && !strip.spotHasFocus()) focus.focusMap();
    announcer.say('turn', turn.spoken);
    // Where the pin sits is the alignment in words, so it is spoken whether or not it is on screen.
    announcer.say('pin', pin ? spansToText(pin) : '');
    // The trip is spoken in full even where it is shown in short.
    announcer.say('caption', spansToText(caption.kind === 'trip' ? (readouts.trip() ?? caption.spans) : caption.spans));
  };

  // The scale is judged on a view that has come to rest, and only after whatever changed it has
  // finished: choosing a place moves the pin first and the view a moment later.
  let driftCheckQueued = false;
  const checkDrift = (): void => {
    driftCheckQueued = false;
    if (dual.isMoving()) return; // its arrival will be checked
    const next = measureDrift();
    if (next?.percent === drift?.percent && next?.pinOnStage === drift?.pinOnStage) return;
    drift = next;
    draw();
  };
  const queueDriftCheck = (): void => {
    if (driftCheckQueued) return;
    driftCheckQueued = true;
    queueMicrotask(checkDrift);
  };

  store.subscribe((state, previous) => {
    if (state.mode !== previous.mode) {
      slidSinceModeOn = false;
      // Enter drops trip ends at the centre mark only while the map has focus.
      if (state.mode === 'measure') focus.focusMap();
      // A trip finished from the keyboard: back to the tool, ready to measure again.
      else if (previous.mode === 'measure' && state.trip !== previous.trip && input.mode() === 'keyboard' && focus.mapHasFocus()) {
        focus.focusTool('measure');
      }
    }
    if (state.mode !== previous.mode || state.tripDraft !== previous.tripDraft || state.shortcutsOn !== previous.shortcutsOn) draw();
  });
  readouts.onChange(draw);
  layout.onChange(draw);
  input.onChange(() => {
    if (store.get().mode !== 'browse') draw();
  });
  dual.on('viewchange', queueDriftCheck);
  dual.on('registrationchange', ({ final }) => {
    if (store.get().mode === 'slide' && !slidSinceModeOn) {
      slidSinceModeOn = true;
      draw();
    }
    if (final) queueDriftCheck();
  });
  // And once the maps have drawn: a view that came with the link was set before the stage had its final size.
  dual.on('idle', queueDriftCheck);
  draw();

  return { element: strip.element, leaveMode };
}
