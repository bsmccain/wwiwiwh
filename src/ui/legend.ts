import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import type { AppState, Place } from '../app/types';
import { openPlacePicker, type PlacePicker } from '../search/picker';
import { samePlace } from '../search/place';
import { button, el, setText } from './dom';
import { icon, inkSwatch } from './icons';
import type { Overlays } from './overlays';

type Role = 'home' | 'away';

const ROLE_WORD: Readonly<Record<Role, string>> = { home: 'Home', away: 'Away' };

export interface Legend {
  readonly element: HTMLElement;
  /** Opens the picker for a role, or closes it when it is already open. */
  togglePicker(role: Role): void;
}

interface Row {
  readonly anchor: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly context: HTMLElement;
}

function createRow(role: Role): Row {
  const name = el('span', 'legend__name');
  const context = el('span', 'legend__context');
  // The spaces keep the words apart in the row's accessible name; they take no room in the layout.
  const anchor = button(`legend__row legend__row--${role}`, { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [
    inkSwatch(role, 'legend__swatch'),
    el('span', 'legend__role', {}, [ROLE_WORD[role]]),
    ' ',
    el('span', 'legend__place', {}, [name, ' ', context]),
    icon('chevron', 'legend__chevron'),
  ]);
  return { anchor, name, context };
}

/**
 * The legend: which ink is which place. Each row is also the control that changes that place, and
 * Swap exchanges the two. In the page Swap stands between the rows, which is where it is on narrow
 * screens and how Tab should reach it on every screen.
 */
export function createLegend(deps: {
  store: Store<AppState>;
  actions: Pick<Controller, 'pickPlace' | 'swap'>;
  overlays: Overlays;
  disabled: boolean;
}): Legend {
  const { store, actions, overlays } = deps;
  const rows: Readonly<Record<Role, Row>> = { home: createRow('home'), away: createRow('away') };
  const swap = button('legend__swap', { title: 'Swap Home and Away' }, [icon('swap'), 'Swap']);
  const element = el('section', 'collar__section legend', { 'aria-label': 'Places' }, [rows.home.anchor, swap, rows.away.anchor]);

  let open: { readonly role: Role; readonly picker: PlacePicker } | null = null;

  const draw = (): void => {
    const state = store.get();
    for (const role of ['home', 'away'] as const) {
      const place = state[role];
      setText(rows[role].name, place.name);
      setText(rows[role].context, place.context);
      // The whole name, for when the row has to cut it short.
      rows[role].anchor.title = [place.name, place.context].filter(Boolean).join(', ');
    }
  };

  const togglePicker = (role: Role): void => {
    if (deps.disabled) return;
    if (open?.role === role) {
      open.picker.close();
      return;
    }
    const state = store.get();
    const closed = overlays.opened(() => open?.picker.close());
    const picker = openPlacePicker({
      role,
      anchor: rows[role].anchor,
      current: state[role],
      other: state[role === 'home' ? 'away' : 'home'],
      onPick(place: Place) {
        // Picking the place already held must not line Home up again. Judged against what is held
        // now, which is not always what was held when the picker opened.
        if (!samePlace(place, store.get()[role])) actions.pickPlace(role, place);
      },
      onClose() {
        if (open?.picker === picker) open = null;
        closed();
      },
    });
    open = { role, picker };
  };

  for (const role of ['home', 'away'] as const) {
    rows[role].anchor.disabled = deps.disabled;
    rows[role].anchor.addEventListener('click', () => togglePicker(role));
  }
  swap.disabled = deps.disabled;
  swap.addEventListener('click', () => actions.swap());

  const drawGround = (ground: Role): void => {
    element.classList.toggle('legend--ground-home', ground === 'home');
    element.classList.toggle('legend--ground-away', ground === 'away');
  };

  store.subscribe((state, previous) => {
    if (state.home !== previous.home || state.away !== previous.away) draw();
    if (state.ground !== previous.ground) drawGround(state.ground);
  });
  draw();
  drawGround(store.get().ground);

  return { element, togglePicker };
}
