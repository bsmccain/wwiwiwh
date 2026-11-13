import { SHORT_PX } from '../app/breakpoints';

/**
 * Which arrangement of the shell is in use. The arrangements themselves are CSS; script only needs
 * to know which facts follow from them. The same numbers are written by hand in collar.css and
 * stage.css: change them together.
 */

/** From this width the collar has room for the bar scale, the turn buttons and the credits. */
const FULL_COLLAR_PX = 900;
/** From this width the full collar is a single row. */
const ONE_ROW_PX = 1100;
/** From this width the single row has room for the pin sentence as well. */
const ROOMY_ROW_PX = 1280;

/** Tall enough for more than a phone on its side gets. */
const TALL = `(min-height: ${SHORT_PX + 1}px)`;
const FULL_COLLAR = `(min-width: ${FULL_COLLAR_PX}px) and ${TALL}`;
const ONE_ROW = `(min-width: ${ONE_ROW_PX}px) and ${TALL}`;
/** The two-row collar has the room in its first row; the single row only once it is wide. */
const PIN_SENTENCE_IN_COLLAR = `(min-width: ${FULL_COLLAR_PX}px) and (max-width: ${ONE_ROW_PX - 0.02}px) and ${TALL}, (min-width: ${ROOMY_ROW_PX}px) and ${TALL}`;
const COARSE_POINTER = '(pointer: coarse)';
const ANY_FINE_POINTER = '(any-pointer: fine)';

export interface Layout {
  /**
   * The collar shows the bar scale, the turn buttons and the credits. Otherwise the scale and a
   * credit move onto the map, and slide mode takes over the collar's row of tools.
   */
  collarIsFull(): boolean;
  /** The collar shows the pin sentence itself. Otherwise the caption does, when there is no trip to describe. */
  pinSentenceInCollar(): boolean;
  /** The caption is too narrow for a long sentence on one line, so the trip is described in its short form. */
  shortSentences(): boolean;
  /** The main pointer is a finger. */
  touch(): boolean;
  /** No mouse, trackpad or pen at all, so very likely no keyboard either. */
  touchOnly(): boolean;
  onChange(listener: () => void): void;
}

export function createLayout(win: Window = window): Layout {
  const fullCollar = win.matchMedia(FULL_COLLAR);
  const oneRow = win.matchMedia(ONE_ROW);
  const pinSentence = win.matchMedia(PIN_SENTENCE_IN_COLLAR);
  const coarse = win.matchMedia(COARSE_POINTER);
  const anyFine = win.matchMedia(ANY_FINE_POINTER);
  return {
    collarIsFull: () => fullCollar.matches,
    pinSentenceInCollar: () => pinSentence.matches,
    shortSentences: () => !oneRow.matches,
    touch: () => coarse.matches,
    touchOnly: () => !anyFine.matches,
    onChange(listener) {
      for (const query of [fullCollar, oneRow, pinSentence, coarse, anyFine]) query.addEventListener('change', listener);
    },
  };
}
