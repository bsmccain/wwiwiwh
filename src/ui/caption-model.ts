import type { Span } from '../app/readout';
import type { Mode } from '../app/types';
import type { Sheet } from '../map/contracts';

/**
 * What the caption band says. It carries one message at a time: what the current mode expects, then
 * a warning about the view, then what is drawn on the map.
 *
 * Modes and warnings are loud (a reversed band), so that switching a mode on is unmistakable.
 * Everything else is quiet: sheet-coloured, the upper edge of the collar.
 */

export type CaptionAction =
  | 'slide-left'
  | 'slide-up'
  | 'slide-down'
  | 'slide-right'
  | 'square-up'
  | 'done'
  | 'to-address'
  | 'cancel'
  | 'clear-trip'
  | 'pin-here'
  | 'drive-on-away'
  | 'drive-trip'
  | 'same-distance'
  | 'retry-drive'
  | 'clear-drive';

export interface CaptionButton {
  readonly action: CaptionAction;
  readonly disabled: boolean;
  /** For a button that is a switch: whether it is on. Left out for a button that simply acts. */
  readonly pressed?: boolean;
}

export interface Caption {
  readonly kind: 'slide' | 'measure' | 'driving' | 'scale' | 'drive' | 'trip' | 'pin' | 'invitation';
  readonly tone: 'loud' | 'quiet';
  readonly spans: readonly Span[];
  /** The words are the pin sentence: its two spots can be pressed to choose them by address. */
  readonly pinSentence: boolean;
  readonly buttons: readonly CaptionButton[];
}

/** How far the two maps disagree in ground scale somewhere on screen, when that is more than is fair to compare. */
export interface ScaleDrift {
  /** The disagreement as a whole percentage. */
  readonly percent: number;
  /** With the pin on the stage the cause is the zoom; with the pin off it, the distance from the pin. */
  readonly pinOnStage: boolean;
}

export interface CaptionInput {
  readonly mode: Mode;
  /** While measuring: the first end of the trip has been placed. */
  readonly tripStarted: boolean;
  /** Since slide mode came on, Home has been slid or turned. */
  readonly slidSinceModeOn: boolean;
  readonly drift: ScaleDrift | null;
  readonly trip: readonly Span[] | null;
  /** While a drive is being set: the place it is on, and whether its start has been placed. */
  readonly driveOn: { readonly sheet: Sheet; readonly place: string };
  readonly driveStarted: boolean;
  /** What there is to say about the drive on the map, and what can be done about it; null without one. */
  readonly drive: DriveCaption | null;
  readonly pin: readonly Span[] | null;
  /** Home is turned at all. */
  readonly turned: boolean;
  /** The collar is the full one, with its own turn buttons; otherwise slide mode takes over the collar's row of tools. */
  readonly collarIsFull: boolean;
  /** The collar shows the pin sentence itself. */
  readonly pinInCollar: boolean;
  /** What the person is working with: a finger, a mouse, or the keyboard. */
  readonly input: 'touch' | 'mouse' | 'keyboard';
  /** Single-letter shortcuts are on, so the bracket keys turn Home without Shift. */
  readonly singleKeys: boolean;
}

export interface DriveCaption {
  readonly spans: readonly Span[];
  /** The route is there, so there is a reach to match to its time or to its distance. */
  readonly routed: boolean;
  /** The reach is matched to the drive's distance instead of its time. */
  readonly byDistance: boolean;
  /** The road service failed to answer, and can be asked again. */
  readonly retry: boolean;
}

export const CAPTION_COPY = {
  slideTouch: 'Sliding Home. Drag to slide it, twist with two fingers to turn it.',
  slideMouse: 'Sliding Home. Drag to slide it; hold Alt and drag to turn it.',
  slideKeys: 'Sliding Home. Shift and the arrow keys slide it; [ and ] turn it.',
  slideKeysShifted: 'Sliding Home. Shift and the arrow keys slide it; Shift with [ or ] turns it.',
  measureKeysStart: 'Press Enter to set the start at the centre mark.',
  measureKeysEnd: 'Move the map, then press Enter to set the end.',
  driveKeysEnd: 'Move the map, then press Enter to set where the drive ends.',
  scaleZoom: 'Zoom in to compare. This far out the two maps stretch differently.',
  invitation: 'Draw a line you know with Measure, or a road you know with Drive, to see how far it reaches here.',
} as const;

function slidePrompt(input: CaptionInput): string {
  if (input.input === 'keyboard') return input.singleKeys ? CAPTION_COPY.slideKeys : CAPTION_COPY.slideKeysShifted;
  return input.input === 'touch' ? CAPTION_COPY.slideTouch : CAPTION_COPY.slideMouse;
}

function measurePrompt(input: CaptionInput): string {
  if (input.input === 'keyboard') return input.tripStarted ? CAPTION_COPY.measureKeysEnd : CAPTION_COPY.measureKeysStart;
  const press = input.input === 'touch' ? 'tap' : 'click';
  return input.tripStarted ? `Now ${press} where it ends.` : `${press.charAt(0).toUpperCase()}${press.slice(1)} where the trip starts.`;
}

/**
 * "Click where the drive starts in San Jose.", with the place in its ink: which of the two maps the
 * click is read on is the one thing about a drive that cannot be seen on the map.
 */
function drivePrompt(input: CaptionInput): Span[] {
  const { sheet, place } = input.driveOn;
  if (input.input === 'keyboard') {
    if (input.driveStarted) return [{ text: CAPTION_COPY.driveKeysEnd }];
    return [{ text: 'Press Enter to set where the drive starts in ' }, { text: place, ink: sheet }, { text: ', at the centre mark.' }];
  }
  const press = input.input === 'touch' ? 'tap' : 'click';
  if (input.driveStarted) return [{ text: `Now ${press} where it ends in ` }, { text: place, ink: sheet }, { text: '.' }];
  return [{ text: `${press.charAt(0).toUpperCase()}${press.slice(1)} where the drive starts in ` }, { text: place, ink: sheet }, { text: '.' }];
}

function driveButtons(drive: DriveCaption): CaptionButton[] {
  return [
    ...(drive.routed ? [{ action: 'same-distance', disabled: false, pressed: drive.byDistance } as const] : []),
    ...(drive.retry ? [enabled('retry-drive')] : []),
    enabled('clear-drive'),
  ];
}

function scaleFarFromPin(percent: number): string {
  return `The two maps match at the pin. This far from it they differ by about ${percent}%.`;
}

const enabled = (action: CaptionAction): CaptionButton => ({ action, disabled: false });

function slideButtons(input: CaptionInput): CaptionButton[] {
  // Where the collar's row of tools has become the mode's own row, only Square up is left to offer,
  // and only when there is something to square up.
  if (!input.collarIsFull) return input.turned ? [enabled('square-up')] : [];
  return [
    enabled('slide-left'),
    enabled('slide-up'),
    enabled('slide-down'),
    enabled('slide-right'),
    // Kept in place while it has nothing to do, so the buttons beside it never move.
    { action: 'square-up', disabled: !input.turned },
    enabled('done'),
  ];
}

export function captionFor(input: CaptionInput): Caption {
  const plain = (text: string): Pick<Caption, 'spans' | 'pinSentence'> => ({ spans: [{ text }], pinSentence: false });
  if (input.mode === 'slide') {
    // Once Home has moved, where it now sits says more than how to move it.
    const words = input.slidSinceModeOn && input.pin ? { spans: input.pin, pinSentence: true } : plain(slidePrompt(input));
    return { kind: 'slide', tone: 'loud', ...words, buttons: slideButtons(input) };
  }
  if (input.mode === 'measure') {
    // The other way to say where the trip goes: by its address, in place of a press on the map.
    return { kind: 'measure', tone: 'loud', ...plain(measurePrompt(input)), buttons: [enabled('to-address'), enabled('cancel')] };
  }
  if (input.mode === 'drive') {
    return {
      kind: 'driving',
      tone: 'loud',
      spans: drivePrompt(input),
      pinSentence: false,
      buttons: [
        // Which place the drive is on is settled by its start: once that is down, the switch only shows it.
        { action: 'drive-on-away', disabled: input.driveStarted, pressed: input.driveOn.sheet === 'away' },
        enabled('to-address'),
        enabled('cancel'),
      ],
    };
  }
  if (input.drift) {
    return input.drift.pinOnStage
      ? { kind: 'scale', tone: 'loud', ...plain(CAPTION_COPY.scaleZoom), buttons: [] }
      : { kind: 'scale', tone: 'loud', ...plain(scaleFarFromPin(input.drift.percent)), buttons: [enabled('pin-here')] };
  }
  if (input.drive) return { kind: 'drive', tone: 'quiet', spans: input.drive.spans, pinSentence: false, buttons: driveButtons(input.drive) };
  // The same two ends by road: the straight line is what people know least about a trip they drive.
  if (input.trip) return { kind: 'trip', tone: 'quiet', spans: input.trip, pinSentence: false, buttons: [enabled('drive-trip'), enabled('clear-trip')] };
  if (!input.pinInCollar && input.pin) return { kind: 'pin', tone: 'quiet', spans: input.pin, pinSentence: true, buttons: [] };
  return { kind: 'invitation', tone: 'quiet', ...plain(CAPTION_COPY.invitation), buttons: [] };
}
