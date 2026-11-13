import { SHEET_QUERY } from '../app/breakpoints';
import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import { overlayToBase } from '../geo/registration';
import type { DualMap, ScreenPoint, Sheet } from '../map/contracts';
import type { PlacePicker } from '../search/picker';
import { openSpotPicker, openTripTargetPicker } from '../search/spot-picker';
import type { InputWatch } from './input-mode';
import type { Overlays } from './overlays';
import { openPinMenu, type PinMenu, type PinMenuChoice } from './pin-menu';
import type { Readouts } from './readouts';
import { spotLabel, spotWords } from './sentences';

/** The second click of a double click comes within this long of the first. */
const DOUBLE_PRESS_MS = 500;
/** A pin drawn further than this from where its menu opened has moved away from the menu. */
const PIN_MOVED_PX = 1;

export interface PinAddress {
  /**
   * Opens the pin menu: beside the pin when the pin asked for it and is in sight, otherwise rising
   * from the collar's More button (or beside the pin after all, where that button is not shown).
   */
  openMenu(from: 'pin' | 'collar'): void;
  /** The pin was clicked, tapped or activated from the keyboard: its menu opens, or closes when it is open. */
  pinActivated(): void;
  /** Closes the pin menu and the picker it opened. Returns whether there was a menu to close. */
  closeMenu(): boolean;
  /** Opens the picker for one end of the pin from the control that names it, or closes it when that control's picker is open. */
  toggleSpotPicker(sheet: Sheet, anchor: HTMLElement): void;
  /** Opens the picker for where a trip from the pin goes, or closes it when that control's picker is open. */
  toggleTripTargetPicker(anchor: HTMLElement): void;
}

interface OpenMenu {
  readonly panel: PinMenu;
  readonly openedAt: number;
  /** Where the pin was drawn when the menu came up beside it; null for a menu at the collar. */
  pinAt: ScreenPoint | null;
  /** The picker that stands in the menu's place, while one does. */
  picker: PlacePicker | null;
}

interface OpenPicker {
  readonly choice: PinMenuChoice;
  readonly anchor: HTMLElement;
  readonly handle: PlacePicker;
}

/**
 * Setting the pin by address and measuring from it to one: the pin menu, the pickers for the pin's
 * two spots and for a trip's far end, and what a pick does. Each of them counts as an overlay while
 * it is open.
 */
export function createPinAddress(deps: {
  store: Store<AppState>;
  dual: Pick<DualMap, 'on' | 'getRegistration' | 'projectAway'>;
  controller: Pick<Controller, 'pinSpot' | 'measureTo' | 'pinAtCenter' | 'pinIsOnStage'>;
  readouts: Pick<Readouts, 'pinSpot' | 'onChange'>;
  overlays: Overlays;
  input: InputWatch;
  /** The pin's handle on the map. */
  pinElement: () => HTMLElement;
  /** The collar's More button, which the menu rises from when it was not the pin that asked. */
  collarAnchor: HTMLElement;
  /** Where focus goes when a picker closes and the control it opened from is no longer there to take it. */
  focusAfter: { readonly spot: () => void; readonly trip: () => void };
}): PinAddress {
  const { store, dual, controller, readouts, overlays } = deps;
  const sheetScreen = window.matchMedia(SHEET_QUERY);
  let menu: OpenMenu | null = null;
  let picker: OpenPicker | null = null;

  const pinOnStage = (): ScreenPoint => dual.projectAway(dual.getRegistration().baseAnchor);

  /** The Tab key last pressed. A picker that closes while that key is still being handled was left by it. */
  let lastTab: KeyboardEvent | null = null;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab') lastTab = event;
    },
    true,
  );
  const leavingByTab = (): boolean => lastTab !== null && lastTab.eventPhase !== Event.NONE;

  /** Opens the picker for a choice. `onClosed` hears whether it closed with a pick that took effect. */
  const openPicker = (choice: PinMenuChoice, anchor: HTMLElement, onClosed: (picked: boolean) => void): PlacePicker => {
    const { home, away, tripDraft } = store.get();
    const registration = dual.getRegistration();
    // A line to an address starts where measuring has already put its start, otherwise at the pin.
    const lineStart = tripDraft ?? registration.overlayAnchor;
    let picked = false;
    // Counted before it opens: opening a picker closes the one already open, and the page must not
    // hear in between that nothing is open any more.
    const closed = overlays.opened(() => handle.close());
    const onClose = (): void => {
      if (picker?.handle === handle) picker = null;
      closed();
      onClosed(picked);
    };
    const other = (sheet: Sheet): string | null => {
      const spot = readouts.pinSpot(sheet === 'home' ? 'away' : 'home');
      // The picker says "on …" of the Away spot and begins a sentence with the Home spot.
      return spot && (sheet === 'home' ? spotWords(spot) : spotLabel(spot));
    };
    const handle: PlacePicker =
      choice === 'trip'
        ? openTripTargetPicker({
            home,
            away,
            skip: { home: [lineStart], away: [overlayToBase(registration, lineStart)] },
            fromPin: tripDraft === null,
            anchor,
            onPick(sheet, spot) {
              // Nothing is drawn to a spot the line would start from; the picker then closes as if nothing had been picked.
              picked = controller.measureTo(sheet, spot);
            },
            onClose,
          })
        : openSpotPicker({
            sheet: choice,
            place: choice === 'home' ? home : away,
            otherSpot: other(choice),
            anchor,
            onPick(spot) {
              picked = true;
              controller.pinSpot(choice, spot);
            },
            onClose,
          });
    picker = { choice, anchor, handle };
    return handle;
  };

  /** Opens a picker from a control on the page, or closes the one that control has open. */
  const togglePicker = (choice: PinMenuChoice, anchor: HTMLElement): void => {
    if (picker?.choice === choice && picker.anchor === anchor) {
      picker.handle.close();
      return;
    }
    openPicker(choice, anchor, () => {
      const focused = document.activeElement;
      // The pick can take the control away: a caption that goes on to say something else, a mode that ends.
      if (!focused || focused === document.body) deps.focusAfter[choice === 'trip' ? 'trip' : 'spot']();
    });
  };

  const closeMenu = (): boolean => {
    if (!menu) return false;
    menu.panel.close();
    return true;
  };

  const openMenu = (from: 'pin' | 'collar'): void => {
    if (menu) return;
    // The More button is not always there to rise from: on narrow screens slide mode puts its own row in its place.
    const collarAnchorShown = deps.collarAnchor.getClientRects().length > 0;
    const besidePin = controller.pinIsOnStage() && (from === 'pin' || !collarAnchorShown);
    const anchor = besidePin ? deps.pinElement() : deps.collarAnchor;
    const focused = document.activeElement;
    const closed = overlays.opened(() => panel.close());
    const panel = openPinMenu({
      anchor,
      placement: besidePin ? 'beside' : 'rising',
      byKeyboard: deps.input.mode() === 'keyboard',
      // Back to wherever it was when the menu was asked for, which a key or the More menu leaves elsewhere than on the anchor.
      returnFocusTo: focused instanceof HTMLElement && focused !== document.body ? focused : null,
      spot: (sheet) => readouts.pinSpot(sheet),
      onSpotsChange: (listener) => readouts.onChange(listener),
      tripStarted: store.get().tripDraft !== null,
      onChoose(choice, row) {
        const open = menu;
        if (!open) return;
        panel.stepAside();
        open.picker = openPicker(choice, anchor, (picked) => {
          open.picker = null;
          // Tab out of the picker leaves the menu as well: brought back, it would stand open while the focus moves on down the page.
          if (picked || leavingByTab()) {
            panel.close();
            return;
          }
          panel.comeBack(row);
          if (open.pinAt) open.pinAt = pinOnStage();
        });
      },
      onPinAtCenter: () => controller.pinAtCenter(),
      onClose() {
        const open = menu;
        menu = null;
        for (const stop of watching) stop();
        closed();
        open?.picker?.close();
      },
    });
    menu = { panel, openedAt: performance.now(), pinAt: besidePin ? pinOnStage() : null, picker: null };

    // A menu beside the pin belongs where the pin is. Once the pin is dragged or the maps move under
    // it, the person has gone back to the map, and the menu goes. (As a sheet it is nowhere near the
    // pin, and nothing behind it can be reached.)
    const watching = besidePin
      ? [
          dual.on('gesture', ({ phase }) => {
            if (phase === 'start') panel.close();
          }),
          dual.on('frame', () => {
            if (!menu?.pinAt || menu.picker || sheetScreen.matches) return;
            const now = pinOnStage();
            // Closing moves focus and takes the menu out of the page: not inside the maps' own frame.
            if (Math.hypot(now.x - menu.pinAt.x, now.y - menu.pinAt.y) > PIN_MOVED_PX) queueMicrotask(() => panel.close());
          }),
        ]
      : [];
  };

  return {
    openMenu,
    closeMenu,
    pinActivated() {
      if (!menu) {
        openMenu('pin');
        return;
      }
      // The second click of a double click activates the pin again, and must not undo the first.
      if (menu.pinAt && performance.now() - menu.openedAt < DOUBLE_PRESS_MS) return;
      menu.panel.close();
    },
    toggleSpotPicker: togglePicker,
    toggleTripTargetPicker: (anchor) => togglePicker('trip', anchor),
  };
}
