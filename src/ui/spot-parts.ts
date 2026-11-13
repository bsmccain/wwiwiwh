import type { Sheet } from '../map/contracts';
import { el, setText } from './dom';

const SHEET_WORD: Readonly<Record<Sheet, string>> = { home: 'Home', away: 'Away' };

/** One of the two spots the pin sentence names, as a control that opens the picker for that spot. */
export interface SpotPart {
  readonly element: HTMLElement;
  /** The run of the sentence that names the spot: its words alone, wherever the lines break them. */
  readonly words: HTMLElement;
  /** The words the sentence uses for the spot. */
  setWords(words: string): void;
}

export type SpotParts = Readonly<Record<Sheet, SpotPart>>;

function createSpotPart(sheet: Sheet, onPress: (sheet: Sheet, part: HTMLElement) => void): SpotPart {
  // One name on its own: it may set its own writing direction (see `.ink` in app.css).
  const words = el('bdi', `spot-part__words ink ink--${sheet}`);
  // A span in the role of a button: a real button is laid out as one box, and could not break across
  // lines in the middle of its words the way the sentence around it does.
  const element = el('span', `spot-part spot-part--${sheet}`, { role: 'button', tabindex: '0', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [
    words,
  ]);
  const press = (): void => onPress(sheet, element);

  element.addEventListener('click', press);
  element.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      press();
    }
    // Space acts when it comes up, as it does on a button; going down it must not scroll the page.
    else if (event.key === ' ') event.preventDefault();
  });
  element.addEventListener('keyup', (event) => {
    if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    press();
  });

  return {
    element,
    words,
    setWords(text) {
      setText(words, text);
      element.setAttribute('aria-label', `${SHEET_WORD[sheet]} spot: ${text}. Choose by address.`);
    },
  };
}

/**
 * The pin sentence's two spots as controls, one set for each place the sentence is shown. They are
 * made once and reworded in place, so that focus on one, and a picker that opened from it, outlive
 * every change of the words.
 */
export function createSpotParts(onPress: (sheet: Sheet, part: HTMLElement) => void): SpotParts {
  return { home: createSpotPart('home', onPress), away: createSpotPart('away', onPress) };
}
