import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import { INK_SETS, inkSet } from '../app/theme';
import type { AppState, InkSetId, Theme, ThemeChoice } from '../app/types';
import type { Units } from '../geo/units';
import type { Sheet } from '../map/contracts';
import { clearRecent, keepsRecent, setKeepsRecent } from '../search/recent';
import { button, el, setText, uniqueId } from './dom';
import { icon, inkSetSwatch, type IconName } from './icons';
import { openMenuPanel } from './menu-panel';
import { KEYS_THAT_STAY } from './shortcuts';

export interface MoreMenu {
  close(): void;
}

export interface MoreMenuOptions {
  /** The More button. Focus returns to it when the menu closes. */
  anchor: HTMLElement;
  store: Store<AppState>;
  actions: Pick<Controller, 'lineUpAgain' | 'setUnits' | 'setThemeChoice' | 'setInkSet' | 'setGround' | 'setShortcutsOn'>;
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
  /** Says in one line what was done to the places and spots kept on this device; `alert` when it did not go as asked. */
  onRecentNotice(message: string, options?: { alert?: boolean }): void;
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
const GROUND_CHOICES: readonly { readonly value: Sheet; readonly word: string }[] = [
  { value: 'away', word: 'Away' },
  { value: 'home', word: 'Home' },
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
 * The ink sets as a grid of radio buttons, each a swatch of the sheet in that set with its name under
 * it. The swatches are in the theme in effect, and the line below says what the chosen set is for.
 */
function inkGroup(onChoose: (set: InkSetId) => void): { readonly element: HTMLElement; draw(chosen: InkSetId, theme: Theme): void } {
  const name = uniqueId('inks');
  const note = el('p', 'menu__note', { id: uniqueId('inks-note') });
  const options = INK_SETS.map((set) => {
    // The chosen radio is the one a screen reader lands on, so the note is its description.
    const input = el('input', 'choice__input', { type: 'radio', name, value: set.id, 'aria-describedby': note.id });
    input.addEventListener('change', () => {
      if (input.checked) onChoose(set.id);
    });
    const swatch = el('span', 'inks__swatch');
    const element = el('label', 'inks__option', {}, [input, el('span', 'inks__tile', {}, [swatch, el('span', 'inks__name', {}, [set.name])])]);
    return { set, input, swatch, element };
  });
  let drawnIn: Theme | null = null;
  return {
    element: el('fieldset', 'menu__group', {}, [
      el('legend', 'menu__legend', {}, ['Colours']),
      el('div', 'inks', {}, options.map((option) => option.element)),
      note,
    ]),
    draw(chosen, theme) {
      for (const { set, input, swatch } of options) {
        if (theme !== drawnIn) swatch.replaceChildren(inkSetSwatch(set[theme], 'inks__drawing'));
        input.checked = set.id === chosen;
      }
      drawnIn = theme;
      setText(note, inkSet(chosen).note);
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
  const ground = choiceGroup(
    'Land and water from',
    GROUND_CHOICES,
    (value) => actions.setGround(value),
    'Parks, woods, built-up areas and water are shaded for this place. The other is drawn as streets only.',
  );
  const inks = inkGroup((set) => actions.setInkSet(set));
  const singleKeys = choiceGroup(
    'Single-key shortcuts',
    ON_OFF_CHOICES,
    (value) => actions.setShortcutsOn(value === 'on'),
    `Off, a letter or digit pressed on its own does nothing. ${KEYS_THAT_STAY}`,
  );
  const keepRecent = choiceGroup(
    'Recent places and spots',
    ON_OFF_CHOICES,
    (value) => {
      const keep = value === 'on';
      if (setKeepsRecent(keep)) {
        clearRecentItem.disabled = !keep;
        return;
      }
      // Not saved. The menu closes so that the alert is seen and heard: on a phone the open sheet makes
      // the rest of the page inert. It reads the setting afresh when it opens again.
      menu.close();
      options.onRecentNotice(
        keep
          ? "This browser wouldn't save On, so places and spots you pick won't be kept."
          : "Recent places and spots cleared, but this browser wouldn't save Off, so new picks may be kept.",
        { alert: true },
      );
    },
    'Places and spots you pick are kept in this browser, to offer again. Off clears them and keeps no more.',
  );
  const clearRecentItem = actionItem('close', 'Clear recent places and spots', 'Links already shared and browser history stay');
  const shortcuts = button('menu__item', {}, [el('span', 'menu__item-word', {}, ['Keyboard shortcuts'])]);
  const about = button('menu__item', {}, [el('span', 'menu__item-word', {}, ['About wwiwiwh'])]);

  const drawChoices = (): void => {
    const state = store.get();
    units.select(state.units);
    theme.select(state.themeChoice);
    inks.draw(state.inkSet, state.theme);
    ground.select(state.ground);
    singleKeys.select(state.shortcutsOn ? 'on' : 'off');
  };
  const unsubscribe = store.subscribe((state, previous) => {
    const settings = ['units', 'themeChoice', 'theme', 'inkSet', 'ground', 'shortcutsOn'] as const;
    if (settings.some((setting) => state[setting] !== previous[setting])) drawChoices();
  });
  drawChoices();
  // Kept in this browser, not in the app's state: read once, as the menu opens.
  const keeping = keepsRecent();
  keepRecent.select(keeping ? 'on' : 'off');
  clearRecentItem.disabled = !keeping;

  const menu = openMenuPanel({
    title: 'More',
    anchor: options.anchor,
    placement: 'rising',
    content: [
      lineUp,
      pinByAddress,
      units.element,
      ground.element,
      theme.element,
      inks.element,
      keepRecent.element,
      clearRecentItem,
      options.offerShortcuts && singleKeys.element,
      options.offerShortcuts && shortcuts,
      about,
    ],
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
  clearRecentItem.addEventListener(
    'click',
    closeThen(() => {
      clearRecent();
      options.onRecentNotice('Recent places and spots cleared from this browser.');
    }),
  );

  return menu;
}
