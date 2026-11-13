import type { Controller } from '../app/controller';
import { el } from './dom';
import type { IconName } from './icons';
import { bindPressRepeat } from './press-repeat';
import { NUDGE_STEP_PX, TURN_STEP_DEG } from './shortcuts';
import { createToolButton } from './tools';

export interface SlideTools {
  readonly element: HTMLElement;
  hasFocus(): boolean;
  /** Whether the row is the one on screen (narrow screens, while slide mode is on). */
  isShown(): boolean;
  /** Moves focus to Done, the way out of the mode. */
  focusDone(): void;
}

/**
 * Slide mode's own row of the collar on narrow screens, where it takes the place of the map tools
 * for as long as the mode is on: four buttons that nudge Home (the way to slide it without
 * dragging), two that turn it, and Done. The nudge and turn buttons repeat while held.
 */
export function createSlideTools(deps: { actions: Pick<Controller, 'slideBy' | 'turnBy'>; onDone: () => void; disabled: boolean }): SlideTools {
  const { actions } = deps;
  // The spoken name is given where the word on the button would not say enough on its own.
  const repeating: readonly (readonly [icon: IconName, word: string, name: string | null, act: () => void])[] = [
    ['nudgeLeft', 'Left', 'Slide Home left', () => actions.slideBy(-NUDGE_STEP_PX, 0)],
    ['nudgeUp', 'Up', 'Slide Home up', () => actions.slideBy(0, -NUDGE_STEP_PX)],
    ['nudgeDown', 'Down', 'Slide Home down', () => actions.slideBy(0, NUDGE_STEP_PX)],
    ['nudgeRight', 'Right', 'Slide Home right', () => actions.slideBy(NUDGE_STEP_PX, 0)],
    ['turnLeft', 'Turn left', null, () => actions.turnBy(-TURN_STEP_DEG)],
    ['turnRight', 'Turn right', null, () => actions.turnBy(TURN_STEP_DEG)],
  ];
  const buttons = repeating.map(([iconName, word, name, act]) => {
    const control = createToolButton(iconName, word, '', false);
    if (name) control.setAttribute('aria-label', name);
    bindPressRepeat(control, act);
    return control;
  });
  const done = el('button', 'tool tool--done', { type: 'button' }, [el('span', 'tool__word', {}, ['Done'])]);
  done.addEventListener('click', deps.onDone);

  const element = el('div', 'collar__section slide-tools', { role: 'group', 'aria-label': 'Slide Home' }, [...buttons, done]);
  for (const control of [...buttons, done]) control.disabled = deps.disabled;

  return {
    element,
    hasFocus: () => element.contains(document.activeElement),
    isShown: () => element.getClientRects().length > 0,
    focusDone: () => done.focus({ preventScroll: true }),
  };
}
