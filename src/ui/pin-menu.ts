import type { Spot } from '../app/readout';
import type { Sheet } from '../map/contracts';
import { button, el, setText } from './dom';
import { icon, inkSwatch, type IconName } from './icons';
import { openMenuPanel, type MenuPanel, type MenuPanelOptions } from './menu-panel';
import { spotLabel } from './sentences';

/** What a row of the menu leads on to: the picker for one end of the pin, or the one for where a trip from the pin goes. */
export type PinMenuChoice = Sheet | 'trip';

export type PinMenu = MenuPanel;

export interface PinMenuOptions {
  /** What the menu opens from: the pin itself, or the collar's More button. */
  readonly anchor: HTMLElement;
  readonly placement: MenuPanelOptions['placement'];
  readonly byKeyboard: boolean;
  readonly returnFocusTo: HTMLElement | null;
  /** How the spot under the pin on a sheet is referred to now, or null while nothing is known about it. */
  spot(sheet: Sheet): Spot | null;
  /** Subscribes to those words changing. Returns a function that stops the calls. */
  onSpotsChange(listener: () => void): () => void;
  /** While measuring, the line's start has been placed: a line to an address starts there, not at the pin. */
  readonly tripStarted: boolean;
  /** A row that leads on to a picker was chosen. The menu stays open: the caller has it step aside for the picker. */
  onChoose(choice: PinMenuChoice, row: HTMLElement): void;
  /** "Put the pin at the centre of the view" was chosen; the menu has closed. */
  onPinAtCenter(): void;
  /** Called exactly once, however the menu closes. */
  onClose(): void;
}

const SHEETS = ['home', 'away'] as const;
const SHEET_WORD: Readonly<Record<Sheet, string>> = { home: 'Home', away: 'Away' };
const NO_WORDS = 'A spot with no name yet';

interface SpotRow {
  readonly element: HTMLButtonElement;
  readonly words: HTMLElement;
}

/** One end of the pin: which sheet, and the spot of it that the pin holds, in that sheet's ink. */
function spotRow(sheet: Sheet): SpotRow {
  // One name on its own: it may set its own writing direction (see `.ink` in app.css), while its line of the row stays left to right.
  const words = el('bdi', `ink ink--${sheet}`);
  // The space keeps the label and the words apart in the row's accessible name; it takes no room in the layout.
  const element = button('menu__item menu__item--led', { 'aria-haspopup': 'dialog' }, [
    inkSwatch(sheet, 'menu__swatch'),
    el('span', 'menu__item-text', {}, [
      el('span', 'menu__item-note', {}, [`${SHEET_WORD[sheet]} spot`]),
      ' ',
      el('span', 'menu__item-spot', {}, [words]),
    ]),
  ]);
  return { element, words };
}

function actionRow(iconName: IconName, word: string, opensPicker: boolean): HTMLButtonElement {
  return button('menu__item menu__item--led', opensPicker ? { 'aria-haspopup': 'dialog' } : {}, [
    icon(iconName),
    el('span', 'menu__item-word', {}, [word]),
  ]);
}

/**
 * The pin menu: the two spots the pin holds together, each leading to the picker that chooses it by
 * address, and what else can be done from the pin. A popover on wide screens, beside the pin when it
 * was opened from the pin; a bottom sheet on phones.
 */
export function openPinMenu(options: PinMenuOptions): PinMenu {
  const rows: Readonly<Record<Sheet, SpotRow>> = { home: spotRow('home'), away: spotRow('away') };
  const measure = actionRow('measure', `Measure from the ${options.tripStarted ? 'start' : 'pin'} to an address`, true);
  const pinAtCenter = actionRow('viewCentre', 'Put the pin at the centre of the view', false);

  const draw = (): void => {
    for (const sheet of SHEETS) {
      const spot = options.spot(sheet);
      setText(rows[sheet].words, spot ? spotLabel(spot) : NO_WORDS);
    }
  };
  const stopDrawing = options.onSpotsChange(draw);
  draw();

  const menu = openMenuPanel({
    title: 'The pin',
    anchor: options.anchor,
    placement: options.placement,
    content: [rows.home.element, rows.away.element, el('hr', 'menu__rule'), measure, pinAtCenter],
    firstStop: rows.home.element,
    byKeyboard: options.byKeyboard,
    returnFocusTo: options.returnFocusTo,
    onClose() {
      stopDrawing();
      options.onClose();
    },
  });

  for (const sheet of SHEETS) rows[sheet].element.addEventListener('click', () => options.onChoose(sheet, rows[sheet].element));
  measure.addEventListener('click', () => options.onChoose('trip', measure));
  pinAtCenter.addEventListener('click', () => {
    menu.close();
    options.onPinAtCenter();
  });

  return menu;
}
