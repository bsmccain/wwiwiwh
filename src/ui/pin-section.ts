import type { Controller } from '../app/controller';
import type { Sheet } from '../map/contracts';
import { button, el, iconButton, setText } from './dom';
import { icon } from './icons';
import { bindPressRepeat } from './press-repeat';
import type { Readouts } from './readouts';
import { TURN_STEP_DEG } from './shortcuts';
import { drawSpans } from './spans';
import { createSpotParts } from './spot-parts';
import { keepSpotReach } from './spot-reach';

/**
 * The collar's pin section: which spot of Home sits on which spot of Away, and how far Home is
 * turned, with buttons that turn it for people who cannot drag the knob on the map. The two spots
 * in the sentence are controls: each opens the picker that chooses that spot by address.
 *
 * Square up is always there and merely switched off while Home is not turned, so the buttons beside
 * it never move under a pointer that is pressing one of them.
 */
export function createPinSection(deps: {
  readouts: Readouts;
  actions: Pick<Controller, 'turnBy' | 'squareUp'>;
  /** One of the sentence's two spots was pressed. */
  onSpot: (sheet: Sheet, part: HTMLElement) => void;
}): HTMLElement {
  const { readouts, actions } = deps;

  const sentence = el('p', 'pin__sentence');
  const spots = createSpotParts(deps.onSpot);
  const shown = el('span', '', { 'aria-hidden': 'true' });
  const spoken = el('span', 'visually-hidden');
  const readout = el('p', 'pin__readout', {}, [shown, spoken]);

  const turnLeft = iconButton('mini-button mini-button--icon', 'Turn left', icon('turnLeft'));
  const turnRight = iconButton('mini-button mini-button--icon', 'Turn right', icon('turnRight'));
  const squareUp = button('mini-button', {}, [icon('squareUp'), 'Square up']);
  const controls = el('div', 'pin__controls', { role: 'group', 'aria-label': 'Turn Home' }, [turnLeft, turnRight, squareUp]);
  const element = el('section', 'collar__section pin', { 'aria-label': 'The pin' }, [sentence, readout, controls]);
  const reach = keepSpotReach({ section: element, sentence, spots, controls });

  const draw = (): void => {
    const pin = readouts.pin();
    sentence.hidden = pin === null;
    if (pin) {
      drawSpans(sentence, pin, spots);
      sentence.title = sentence.textContent ?? '';
    }
    reach.update();
    const turn = readouts.turn();
    setText(shown, turn.shown);
    setText(spoken, turn.spoken);
    // Focus must not be left on a button that has just stopped working.
    if (!turn.turned && document.activeElement === squareUp) turnLeft.focus({ preventScroll: true });
    squareUp.disabled = !turn.turned;
  };

  bindPressRepeat(turnLeft, () => actions.turnBy(-TURN_STEP_DEG));
  bindPressRepeat(turnRight, () => actions.turnBy(TURN_STEP_DEG));
  squareUp.addEventListener('click', () => actions.squareUp());
  readouts.onChange(draw);
  draw();

  return element;
}
