import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import type { AppState, ThemeChoice } from '../app/types';
import type { Units } from '../geo/units';
import { button, el, uniqueId } from './dom';
import { icon, type IconName } from './icons';
import { openMenuPanel } from './menu-panel';
import { KEYS_THAT_STAY } from './shortcuts';

export interface MoreMenu {
  close(): void;
}

export interface MoreMenuOptions {
  /** The More button. Focus returns to it when the menu closes. */
  anchor: HTMLElement;
  store: Store<AppState>;
  actions: Pick<Controller, 'lineUpAgain' | 'setUnits' | 'setThemeChoice' | 'setShortcutsOn'>;
  /** False where the maps could not start: there is nothing to line up and no pin to set. */
  mapReady: boolean;
  /** False on devices with no keyboard to speak of. */
  offerShortcuts: boolean;
  /** The menu is being opened from the keyboard, so focus goes to its first control and not just to the sheet. */
  byKeyboard: boolean;
  /** "Set the pin by address" was chosen; the menu has closed. */
  onPinByAddress(): void;
  onShortcuts(): void;
  onAbout(): void;
  /** Called exactly once, however the menu closes. */
  onClose(): void;
}

type OnOff = 'on' | 'off';

const UNIT_CHOICES: readonly { readonly value: Units; readonly word: string }[] = [
  { value: 'mi', word: 'Miles' },
  { value: 'km', word: 'Kilometres' },
];
const THEME_CHOICES: readonly { readonly value: ThemeChoice; readonly word: string }[] = [
  { value: 'auto', word: 'Match system' },
  { value: 'light', word: 'Light' },
  { value: 'dark', word: 'Dark' },
];
const ON_OFF_CHOICES: readonly { readonly value: OnOff; readonly word: string }[] = [
  { value: 'on', word: 'On' },
  { value: 'off', word: 'Off' },
];

/** A row that does one thing: an icon, a word for it and, under the word, what comes of it. */
function actionItem(iconName: IconName, word: string, note: string): HTMLButtonElement {
  return button('menu__item', {}, [
    icon(iconName),
    el('span', 'menu__item-text', {}, [el('span', 'menu__item-word', {}, [word]), el('span', 'menu__item-note', {}, [note])]),
  ]);
}

interface ChoiceGroup<V extends string> {
  readonly element: HTMLElement;
  select(value: V): void;
}

/** A row of radio buttons drawn as one control; the chosen one is reversed like any "on" state. */
function choiceGroup<V extends string>(
  legend: string,
  choices: readonly { readonly value: V; readonly word: string }[],
  onChoose: (value: V) => void,
  note?: string,
): ChoiceGroup<V> {
  const name = uniqueId('choice');
  const inputs = choices.map(({ value }) => {
    const input = el('input', 'choice__input', { type: 'radio', name, value });
    input.addEventListener('change', () => {
      if (input.checked) onChoose(value);
    });
    return input;
  });
  const options = choices.map(({ word }, index) => el('label', 'choice__option', {}, [inputs[index], el('span', 'choice__word', {}, [word])]));
  const element = el('fieldset', 'menu__group', {}, [
    el('legend', 'menu__legend', {}, [legend]),
    el('div', 'choice', {}, options),
    note !== undefined && el('p', 'menu__note', {}, [note]),
  ]);
  return {
    element,
    select(value) {
      choices.forEach((choice, index) => {
        const input = inputs[index];
        if (input) input.checked = choice.value === value;
      });
    },
  };
}

/**
 * The More menu: the things that are set once and then left alone, and the long way round to the
 * pin's addresses. A popover rising from the collar on wide screens, a bottom sheet on phones, in
 * step with the place picker.
 */
export function openMoreMenu(options: MoreMenuOptions): MoreMenu {
  const { store, actions } = options;

  const lineUp = actionItem('lineUp', 'Line up again', 'Centre on centre, not turned');
  const pinByAddress = actionItem('search', 'Set the pin by address', 'Or measure from it to an address');
  for (const item of [lineUp, pinByAddress]) item.disabled = !options.mapReady;
  const units = choiceGroup('Units', UNIT_CHOICES, (value) => actions.setUnits(value));
  const theme = choiceGroup('Appearance', THEME_CHOICES, (value) => actions.setThemeChoice(value));
  const singleKeys = choiceGroup(
    'Single-key shortcuts',
    ON_OFF_CHOICES,
    (value) => actions.setShortcutsOn(value === 'on'),
    `Off, a letter or digit pressed on its own does nothing. ${KEYS_THAT_STAY}`,
  );
  const shortcuts = button('menu__item', {}, [el('span', 'menu__item-word', {}, ['Keyboard shortcuts'])]);
  const about = button('menu__item', {}, [el('span', 'menu__item-word', {}, ['About wwiwiwh'])]);

  const drawChoices = (): void => {
    const state = store.get();
    units.select(state.units);
    theme.select(state.themeChoice);
    singleKeys.select(state.shortcutsOn ? 'on' : 'off');
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.units !== previous.units || state.themeChoice !== previous.themeChoice || state.shortcutsOn !== previous.shortcutsOn) {
      drawChoices();
    }
  });
  drawChoices();

  const menu = openMenuPanel({
    title: 'More',
    anchor: options.anchor,
    placement: 'rising',
    content: [lineUp, pinByAddress, units.element, theme.element, options.offerShortcuts && singleKeys.element, options.offerShortcuts && shortcuts, about],
    firstStop: options.mapReady ? lineUp : null,
    byKeyboard: options.byKeyboard,
    onClose() {
      unsubscribe();
      options.onClose();
    },
  });

  // The menu closes first so that focus is back on More, which is where whatever opens next returns it later.
  const closeThen = (act: () => void) => (): void => {
    menu.close();
    act();
  };
  lineUp.addEventListener('click', closeThen(() => actions.lineUpAgain()));
  pinByAddress.addEventListener('click', closeThen(() => options.onPinByAddress()));
  shortcuts.addEventListener('click', closeThen(() => options.onShortcuts()));
  about.addEventListener('click', closeThen(() => options.onAbout()));

  return menu;
}
