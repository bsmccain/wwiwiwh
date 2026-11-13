import './caption.css';
import type { Sheet } from '../map/contracts';
import type { Caption, CaptionAction } from './caption-model';
import { button, el, iconButton, uniqueId } from './dom';
import { icon, type IconName } from './icons';
import { bindPressRepeat } from './press-repeat';
import { drawSpans } from './spans';
import { createSpotParts } from './spot-parts';

export interface CaptionStrip {
  readonly element: HTMLElement;
  draw(caption: Caption): void;
  /** Whether focus is on one of the strip's buttons. */
  hasFocus(): boolean;
  /** Whether focus is on one of the pin sentence's two spots. */
  spotHasFocus(): boolean;
  /** Moves focus to one of the strip's buttons. */
  focus(action: CaptionAction): void;
}

interface ButtonSpec {
  readonly action: CaptionAction;
  readonly word: string;
  readonly icon?: IconName;
  /** Shows the icon alone; the word becomes the button's name and tooltip. */
  readonly iconOnly?: boolean;
  /** Acts on press and goes on acting while held. */
  readonly repeats?: boolean;
  /** Opens a picker instead of acting at once. */
  readonly opensPicker?: boolean;
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'slide-left', word: 'Slide Home left', icon: 'nudgeLeft', iconOnly: true, repeats: true },
  { action: 'slide-up', word: 'Slide Home up', icon: 'nudgeUp', iconOnly: true, repeats: true },
  { action: 'slide-down', word: 'Slide Home down', icon: 'nudgeDown', iconOnly: true, repeats: true },
  { action: 'slide-right', word: 'Slide Home right', icon: 'nudgeRight', iconOnly: true, repeats: true },
  { action: 'square-up', word: 'Square up', icon: 'squareUp' },
  { action: 'done', word: 'Done' },
  // In the order the model lists them, which is the order they stand and are tabbed through in.
  { action: 'drive-on-away', word: 'On Away' },
  { action: 'to-address', word: 'To an address', opensPicker: true },
  { action: 'cancel', word: 'Cancel' },
  { action: 'drive-trip', word: 'By road' },
  { action: 'clear-trip', word: 'Clear line' },
  { action: 'pin-here', word: 'Pin here' },
  { action: 'same-distance', word: 'Same distance' },
  { action: 'retry-drive', word: 'Try again' },
  { action: 'clear-drive', word: 'Clear drive' },
];

function createButton(spec: ButtonSpec): HTMLButtonElement {
  if (spec.icon && spec.iconOnly) return iconButton('mini-button mini-button--icon caption__button', spec.word, icon(spec.icon));
  const popup: Record<string, string> = spec.opensPicker ? { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } : {};
  return button('mini-button caption__button', popup, [spec.icon ? icon(spec.icon) : null, spec.word]);
}

/**
 * The caption band on the bottom edge of the stage: one message and the buttons that go with it.
 * Its buttons are made once and shown as needed, so a button being held or holding focus is never
 * swapped out from under the person. Where the message is the pin sentence, its two spots are
 * controls as well.
 */
export function createCaptionStrip(options: {
  /** One of the buttons was pressed; `control` is the button itself. */
  onAction: (action: CaptionAction, control: HTMLElement) => void;
  /** One of the two spots in the pin sentence was pressed. */
  onSpot: (sheet: Sheet, part: HTMLElement) => void;
}): CaptionStrip {
  const text = el('p', 'caption__text', { id: uniqueId('caption-text') });
  const spots = createSpotParts(options.onSpot);
  const actions = el('div', 'caption__actions', { id: uniqueId('caption-actions') });
  // The buttons come first in the page so that, on a narrow phone, the sentence can wrap around them
  // (caption.css). Assistive technology is told the order they are read in: the sentence, then its buttons.
  const body = el('div', 'caption__body', { 'aria-owns': `${text.id} ${actions.id}` }, [actions, text]);
  const element = el('div', 'caption', {}, [body]);

  const buttons = new Map<CaptionAction, HTMLButtonElement>();
  for (const spec of BUTTONS) {
    const control = createButton(spec);
    control.hidden = true;
    if (spec.repeats) bindPressRepeat(control, () => options.onAction(spec.action, control));
    else control.addEventListener('click', () => options.onAction(spec.action, control));
    buttons.set(spec.action, control);
    actions.append(control);
  }

  return {
    element,
    draw(caption) {
      element.dataset['kind'] = caption.kind;
      element.dataset['tone'] = caption.tone;
      drawSpans(text, caption.spans, caption.pinSentence ? spots : null);
      for (const [action, control] of buttons) {
        const wanted = caption.buttons.find((candidate) => candidate.action === action);
        control.hidden = !wanted;
        control.disabled = wanted?.disabled ?? false;
        // A switch says whether it is on; a button that simply acts says nothing of the kind.
        if (wanted?.pressed === undefined) control.removeAttribute('aria-pressed');
        else control.setAttribute('aria-pressed', String(wanted.pressed));
      }
      actions.hidden = caption.buttons.length === 0;
    },
    hasFocus: () => actions.contains(document.activeElement),
    spotHasFocus: () => text.contains(document.activeElement),
    focus: (action) => buttons.get(action)?.focus({ preventScroll: true }),
  };
}
