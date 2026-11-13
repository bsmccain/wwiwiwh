import './menu.css';
import { SHEET_QUERY } from '../app/breakpoints';
import { dismissByDragging } from '../search/sheet-drag';
import { button, el, uniqueId } from './dom';
import { icon } from './icons';
import { placeBeside } from './popover-place';

export interface MenuPanel {
  /** Safe to call at any time and any number of times; only the first call does anything. */
  close(): void;
  /** Takes the menu off the screen without closing it, while something it opened stands in its place. */
  stepAside(): void;
  /** Puts a menu that stepped aside back on the screen, with focus on one of its controls. */
  comeBack(focus: HTMLElement): void;
}

export interface MenuPanelOptions {
  /** The menu's name: the heading of the sheet, and what the popover is called to assistive technology. */
  readonly title: string;
  /**
   * The control the menu belongs to. It is marked as expanded while the menu is up, and a press on it
   * is left to it, so that it can toggle.
   */
  readonly anchor: HTMLElement;
  /**
   * Where the popover goes on wide screens. `rising`: above the anchor's `data-picker-edge` ancestor
   * (the collar), lined up with the anchor's right edge. `beside`: next to the anchor itself.
   */
  readonly placement: 'rising' | 'beside';
  /** What the menu holds, top to bottom. */
  readonly content: readonly (Node | false)[];
  /** Where focus lands when the menu opens; null leaves it on the menu itself. */
  readonly firstStop: HTMLElement | null;
  /** The menu is being opened from the keyboard, so focus goes to its first control and not just to the sheet. */
  readonly byKeyboard: boolean;
  /** Where focus goes when the menu closes, when that is not the anchor. */
  readonly returnFocusTo?: HTMLElement | null;
  /** Called exactly once, however the menu closes. */
  onClose(): void;
}

const POPOVER_GAP = 8;
const SCREEN_MARGIN = 12;

/**
 * A menu in the dress of the pickers: a popover on wide screens, a bottom sheet on phones. It closes
 * on Escape, on a press outside it, when Tab leaves the popover, and when the sheet is pulled down.
 * What its controls do is the caller's.
 */
export function openMenuPanel(options: MenuPanelOptions): MenuPanel {
  const { anchor } = options;
  const sheetScreen = window.matchMedia(SHEET_QUERY);
  const listeners = new AbortController();
  const listening = { signal: listeners.signal };
  let closed = false;
  let aside = false;
  /** While the sheet is up: what else in the page has been put out of reach. */
  let heldBack: HTMLElement[] | null = null;

  const titleId = uniqueId('menu-title');
  const closeButton = button('menu__close', {}, [icon('close'), 'Close']);
  const head = el('div', 'menu__head', {}, [el('h2', 'menu__title', { id: titleId }, [options.title]), closeButton]);
  const panel = el('div', 'menu__panel', { role: 'dialog', 'aria-labelledby': titleId, tabindex: '-1' }, [head, ...options.content]);
  const scrim = el('div', 'menu__scrim');
  const root = el('div', 'menu', { 'data-place': options.placement }, [scrim, panel]);

  const isSheet = (): boolean => sheetScreen.matches;

  /**
   * The sheet is modal: while it is up, the page behind is out of reach of the keyboard and of
   * assistive technology, as it already is of a finger.
   */
  const holdBackPage = (hold: boolean): void => {
    if (hold === (heldBack !== null)) return;
    if (hold) {
      heldBack = [...document.body.children].filter(
        (sibling): sibling is HTMLElement => sibling instanceof HTMLElement && sibling !== root && !sibling.inert,
      );
    }
    for (const sibling of heldBack ?? []) sibling.inert = hold;
    if (!hold) heldBack = null;
  };

  const set = (name: string, value: number): void => panel.style.setProperty(`--menu-${name}`, `${value}px`);

  const layOut = (): void => {
    if (aside) return;
    const sheet = isSheet();
    root.dataset['layout'] = sheet ? 'sheet' : 'popover';
    panel.setAttribute('aria-modal', String(sheet));
    holdBackPage(sheet);
    if (sheet) return;
    const screen = { width: document.documentElement.clientWidth, height: window.innerHeight };
    if (options.placement === 'beside') {
      // Measured with the whole screen to grow into, then put where that size fits.
      set('max-height', screen.height - 2 * SCREEN_MARGIN);
      const place = placeBeside(anchor.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight }, screen);
      set('left', place.left);
      set('top', place.top);
      return;
    }
    // Like the picker, the popover rises above the collar and the caption, lined up with its button's right edge.
    const edge = (anchor.closest('[data-picker-edge]') ?? anchor).getBoundingClientRect();
    const button = anchor.getBoundingClientRect();
    // A button that is not shown just now has no edge to line up with; the screen's own will do.
    set('right', Math.max(SCREEN_MARGIN, button.width > 0 ? screen.width - button.right : 0));
    set('bottom', screen.height - edge.top + POPOVER_GAP);
    set('max-height', Math.max(0, edge.top - POPOVER_GAP - SCREEN_MARGIN));
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    listeners.abort();
    const focused = document.activeElement;
    // Something the menu opened hands focus to the anchor when it closes: that focus is the menu's to pass on as well.
    const focusIsOurs = !focused || focused === document.body || root.contains(focused) || focused === anchor;
    // The page is let go before focus is handed back into it.
    holdBackPage(false);
    root.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (focusIsOurs) {
      const back = options.returnFocusTo?.isConnected ? options.returnFocusTo : anchor;
      back.focus({ preventScroll: true });
      // It may have gone out of use meanwhile (hidden, switched off).
      if (document.activeElement !== back) anchor.focus({ preventScroll: true });
    }
    options.onClose();
  };

  const stops = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>('button, input:checked')].filter((stop) => stop.getClientRects().length > 0 && !stop.matches(':disabled'));

  /** A press on the anchor, also where the anchor lets presses through to what lies under it (a pin at rest does). */
  const pressIsOnAnchor = (event: PointerEvent): boolean => {
    if (event.target instanceof Node && anchor.contains(event.target)) return true;
    const box = anchor.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  };

  panel.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = stops();
      const at = all.indexOf(document.activeElement as HTMLElement);
      const leaving = event.shiftKey ? at <= 0 : at === all.length - 1;
      if (!leaving) return;
      if (isSheet()) {
        // The sheet is modal: focus goes round inside it.
        event.preventDefault();
        all.at(event.shiftKey ? -1 : 0)?.focus();
      } else {
        // Focus returns to where it came from, and the browser's own Tab carries on from there.
        close();
      }
    },
    listening,
  );

  // Focus can be outside an open popover: a second press on the anchor leaves it there. Escape still closes it.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || aside || event.defaultPrevented) return;
      event.preventDefault();
      close();
    },
    listening,
  );

  closeButton.addEventListener('click', close, listening);
  scrim.addEventListener('click', close, listening);
  dismissByDragging({ panel, scroller: panel, enabled: isSheet, onDismiss: close, signal: listeners.signal });
  // On the root element, so that a picker this menu opened, which listens on the document, hears the
  // press first: by the time it gets here the menu is back on the screen and can judge the press itself.
  document.documentElement.addEventListener(
    'pointerdown',
    (event) => {
      if (aside || isSheet() || !(event.target instanceof Node)) return;
      // A press on the anchor is left to the anchor, which closes the menu itself.
      if (panel.contains(event.target) || pressIsOnAnchor(event)) return;
      close();
    },
    { capture: true, signal: listeners.signal },
  );
  window.addEventListener('resize', layOut, listening);
  sheetScreen.addEventListener('change', layOut, listening);

  document.body.append(root);
  anchor.setAttribute('aria-expanded', 'true');
  layOut();
  // Under a finger the sheet itself takes focus; landing on its first control would read as a selection.
  ((isSheet() && !options.byKeyboard) || !options.firstStop ? panel : options.firstStop).focus({ preventScroll: true });

  return {
    close,
    stepAside() {
      if (closed || aside) return;
      aside = true;
      root.hidden = true;
      holdBackPage(false);
    },
    comeBack(focus) {
      if (closed || !aside) return;
      aside = false;
      root.hidden = false;
      // Whatever stood in for the menu has just marked the anchor as closed.
      anchor.setAttribute('aria-expanded', 'true');
      layOut();
      focus.focus({ preventScroll: true });
    },
  };
}
