import { SCALE_DRIFT_LIMIT, type Controller } from '../app/controller';
import { spansToText } from '../app/readout';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { DualMap } from '../map/contracts';
import type { Announcer } from './announcer';
import { createCaptionStrip } from './caption';
import { captionFor, type CaptionAction, type DriveCaption, type ScaleDrift } from './caption-model';
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
  focusTool(tool: 'slide' | 'measure' | 'drive'): void;
  /** On narrow screens, where slide mode's buttons take the place of the collar's tools: focus the first of them. */
  focusSlideRow(): void;
}

export interface Captioner {
  readonly element: HTMLElement;
  /**
   * Leaves slide, measure or drive mode (the caption's Done and Cancel, and Escape). Focus that sat on
   * the mode's own controls, which go away with it, moves to the tool that started it.
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
  controller: Pick<
    Controller,
    | 'slideBy'
    | 'squareUp'
    | 'cancel'
    | 'clearTrip'
    | 'pinAtCenter'
    | 'scaleDrift'
    | 'pinIsOnStage'
    | 'setDriveSide'
    | 'driveTheTrip'
    | 'setDriveMatch'
    | 'retryDrive'
    | 'clearDrive'
  >;
  readouts: Readouts;
  layout: Layout;
  input: InputWatch;
  announcer: Announcer<SpokenChannel>;
  focus: ModeFocus;
  /** Where the pin sentence's two spots and "To an address" lead. */
  pinAddress: Pick<PinAddress, 'toggleSpotPicker' | 'toggleTripTargetPicker' | 'toggleDriveEndPicker'>;
}): Captioner {
  const { store, dual, controller, readouts, layout, input, announcer, focus, pinAddress } = deps;

  const leaveMode = (): void => {
    const { mode } = store.get();
    // Measuring and setting a drive by keyboard are done with focus on the map.
    const focusWasOnTheMode = strip.hasFocus() || ((mode === 'measure' || mode === 'drive') && focus.mapHasFocus());
    if (controller.cancel() && focusWasOnTheMode && mode !== 'browse') focus.focusTool(mode);
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
        // The one button for both: an address for the line while measuring, for the drive while setting one.
        if (store.get().mode === 'drive') pinAddress.toggleDriveEndPicker(control);
        else pinAddress.toggleTripTargetPicker(control);
        break;
      case 'drive-on-away':
        controller.setDriveSide(store.get().driveSide === 'away' ? 'home' : 'away');
        break;
      case 'drive-trip':
        controller.driveTheTrip();
        // The button went with the trip's sentence; the drive's own tool is where to carry on from.
        if (focusWasHere) focus.focusTool('drive');
        break;
      case 'same-distance':
        controller.setDriveMatch(store.get().drive?.match === 'distance' ? 'time' : 'distance');
        break;
      case 'retry-drive':
        controller.retryDrive();
        // Asked again, the button is gone until the answer fails again.
        if (focusWasHere) strip.focus('clear-drive');
        break;
      case 'clear-drive':
        controller.clearDrive();
        if (focusWasHere) focus.focusTool('drive');
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

  /** What the band says of the drive on the map, in the wording that fits the screen. */
  const driveCaption = (state: AppState): DriveCaption | null => {
    const spans = layout.shortSentences() ? readouts.driveInShort() : readouts.drive();
    if (!state.drive || !spans) return null;
    return {
      spans,
      routed: state.route?.status === 'found',
      byDistance: state.drive.match === 'distance',
      retry: state.route?.status === 'unavailable' || state.reach?.status === 'unavailable',
    };
  };

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
      driveOn: { sheet: state.driveSide, place: state[state.driveSide].name },
      driveStarted: state.driveDraft !== null,
      drive: driveCaption(state),
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
    // The trip and the drive are spoken in full even where they are shown in short.
    const inFull = caption.kind === 'trip' ? readouts.trip() : caption.kind === 'drive' ? readouts.drive() : null;
    announcer.say('caption', spansToText(inFull ?? caption.spans));
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
      // Enter drops ends at the centre mark only while the map has focus.
      if (state.mode === 'measure' || state.mode === 'drive') focus.focusMap();
      // A trip finished from the keyboard: back to the tool, ready to measure again.
      else if (previous.mode === 'measure' && state.trip !== previous.trip && input.mode() === 'keyboard' && focus.mapHasFocus()) {
        focus.focusTool('measure');
      } else if (previous.mode === 'drive' && state.drive !== previous.drive && input.mode() === 'keyboard' && focus.mapHasFocus()) {
        focus.focusTool('drive');
      }
    }
    const modeChanged = state.mode !== previous.mode || state.tripDraft !== previous.tripDraft || state.shortcutsOn !== previous.shortcutsOn;
    // What the drive's buttons offer follows the drive and its answers, which the sentence alone does not always show.
    const driveChanged =
      state.driveSide !== previous.driveSide ||
      state.driveDraft !== previous.driveDraft ||
      state.drive !== previous.drive ||
      state.route !== previous.route ||
      state.reach !== previous.reach;
    if (modeChanged || driveChanged) draw();
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
