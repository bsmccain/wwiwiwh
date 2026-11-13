import type { Span } from '../app/readout';
import type { Mode } from '../app/types';

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
  | 'pin-here';

export interface CaptionButton {
  readonly action: CaptionAction;
  readonly disabled: boolean;
}

export interface Caption {
  readonly kind: 'slide' | 'measure' | 'scale' | 'trip' | 'pin' | 'invitation';
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

export const CAPTION_COPY = {
  slideTouch: 'Sliding Home. Drag to slide it, twist with two fingers to turn it.',
  slideMouse: 'Sliding Home. Drag to slide it; hold Alt and drag to turn it.',
  slideKeys: 'Sliding Home. Shift and the arrow keys slide it; [ and ] turn it.',
  slideKeysShifted: 'Sliding Home. Shift and the arrow keys slide it; Shift with [ or ] turns it.',
  measureKeysStart: 'Press Enter to set the start at the centre mark.',
  measureKeysEnd: 'Move the map, then press Enter to set the end.',
  scaleZoom: 'Zoom in to compare. This far out the two maps stretch differently.',
  invitation: 'Draw a line you know with Measure to see how far it reaches here.',
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
  if (input.drift) {
    return input.drift.pinOnStage
      ? { kind: 'scale', tone: 'loud', ...plain(CAPTION_COPY.scaleZoom), buttons: [] }
      : { kind: 'scale', tone: 'loud', ...plain(scaleFarFromPin(input.drift.percent)), buttons: [enabled('pin-here')] };
  }
  if (input.trip) return { kind: 'trip', tone: 'quiet', spans: input.trip, pinSentence: false, buttons: [enabled('clear-trip')] };
  if (!input.pinInCollar && input.pin) return { kind: 'pin', tone: 'quiet', spans: input.pin, pinSentence: true, buttons: [] };
  return { kind: 'invitation', tone: 'quiet', ...plain(CAPTION_COPY.invitation), buttons: [] };
}
