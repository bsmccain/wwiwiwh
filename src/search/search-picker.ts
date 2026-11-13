import './picker.css';
import { SHEET_QUERY, SHORT_PX } from '../app/breakpoints';
import { restsOnPanel, watchLastInput } from './last-input';
import { fitSheet, placePopover, visibleBand } from './picker-layout';
import { createRemoteSearch, type RemoteSearchDeps, type RemoteState } from './remote-search';
import { accessibleRowName } from './row-name';
import { dismissByDragging } from './sheet-drag';
import { cleanQuery } from './text';

/** One of the two maps, by the ink it is printed in. */
export type Ink = 'home' | 'away';

export type Standing = 'free' | 'current' | 'taken';

/** How one row reads. */
export interface RowLook {
  /** Tells the row from every other in the list, so that the highlight stays on it when the list is redrawn. */
  readonly key: string;
  readonly name: string;
  readonly context: string;
  /** Why the row is here or what is special about it, shown at its right end. */
  readonly note?: string;
  /** "current" marks what is held now; "taken" cannot be picked. Free when left out. */
  readonly standing?: Standing;
  /**
   * The map the row belongs to, where one list holds rows of both: its ink leads the row, and its
   * place is said in the row's accessible name.
   */
  readonly sheet?: { readonly ink: Ink; readonly place: string };
}

export interface Section<T> {
  /** A section without a label lists its rows straight under the field. */
  readonly label?: string;
  readonly rows: readonly T[];
  /** The rows are only on offer, not an answer to what was typed: Enter does not land on them unasked. */
  readonly offered?: boolean;
}

/** `T` is what a row stands for and what picking hands back; `A` is what the remote search answers with. */
export interface SearchPickerOptions<T, A> {
  /**
   * The control the picker belongs to. Focus returns to it on close, and a press on it is left to the
   * caller, so that it can toggle. On wide screens the popover lines up with its left edge and rises
   * above it, or above its closest ancestor marked `data-picker-edge`, so that nothing beside the
   * control is covered. A control above every element so marked stands on its own (the pin on the
   * map), and the popover may stand beside it instead; `placePopover` has the rule.
   */
  readonly anchor: HTMLElement;
  /** The heading: its leading words stand out, the rest is set quieter; `ink` puts that map's swatch in front. */
  readonly heading: { readonly ink?: Ink; readonly lead: string; readonly rest?: string };
  /** A sentence under the heading that says what picking will do. */
  readonly line?: string;
  readonly placeholder: string;
  /** What the rows are called: the name of the list, and "1 place" and "3 places" in what is read out. */
  readonly rowsAre: { readonly list: string; readonly one: string; readonly many: string };
  /** Said when the search cannot be reached, above a "Try again" button. */
  readonly unavailable: string;
  /** Said when the search has answered and there is nothing to list for it. */
  noMatch(query: string, answer: A): string;
  /** What to list before anything is typed. */
  browse(): readonly Section<T>[];
  /** How to look up what is typed. */
  readonly remote: RemoteSearchDeps<A>;
  /** What to list for what is typed, given how the search for it stands. */
  answers(query: string, state: RemoteState<A>): readonly Section<T>[];
  look(row: T): RowLook;
  /** Called when a row is chosen, with the page already back in reach; the picker closes straight after. */
  onPick(row: T): void;
  /** Called exactly once, however the picker closes. */
  onClose(): void;
}

export interface SearchPicker {
  /** Safe to call at any time and any number of times; only the first call does anything. */
  close(): void;
}

const SEARCHING = 'Searching…';

/** On a screen this short the sheet puts its heading, field and Close on one row; picker.css has the same number. */
const ONE_ROW_HEAD = `(max-height: ${SHORT_PX}px)`;
const LONGEST_QUERY = 80;
/** Long enough that typing does not make a screen reader recite every intermediate count. */
const ANNOUNCE_DELAY_MS = 600;

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.9-4.9',
  close: 'M6 6l12 12M18 6 6 18',
  current: 'M5 12.5l4.5 4.5L19 7.5',
} as const;
/** A stroke of each map as it is printed: Home warm and heavy, Away cool and light. */
const INK_STROKES: Readonly<Record<Ink, string>> = {
  home: 'M1 11C9 11 11 4 27 4',
  away: 'M1 5c7-2 13 5 26 1',
};

type Move = 'next' | 'previous' | 'first' | 'last';
const MOVES = new Map<string, Move>([
  ['ArrowDown', 'next'],
  ['ArrowUp', 'previous'],
  ['Home', 'first'],
  ['End', 'last'],
]);

interface Option<T> {
  readonly row: T;
  readonly look: RowLook;
  readonly element: HTMLElement;
  /** True when the row answers what was typed, false when it is merely on offer (recent, well-known). */
  readonly answers: boolean;
}

let pickersOpened = 0;
let openPicker: SearchPicker | null = null;
// Watching from the moment this module loads puts it ahead of the handlers that open a picker.
const lastInput = watchLastInput(window);

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(path: string, className: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function inkSwatch(ink: Ink): SVGSVGElement {
  return icon(INK_STROKES[ink], `picker__ink picker__ink--${ink}`, '0 0 28 14');
}

function isShown(node: HTMLElement): boolean {
  return node.isConnected && node.getClientRects().length > 0;
}

/**
 * Opens a picker: a search field over a list, as a popover rising from the anchor where there is
 * room and as a bottom sheet on phones, upright or on their side. What it lists and what picking
 * does is the caller's. Only one picker is open at a time; opening another closes the first.
 */
export function openSearchPicker<T, A>(options: SearchPickerOptions<T, A>): SearchPicker {
  openPicker?.close();

  const { anchor, heading, rowsAre } = options;
  const uid = `picker-${++pickersOpened}`;
  const sheetScreen = window.matchMedia(SHEET_QUERY);
  const oneRowHead = window.matchMedia(ONE_ROW_HEAD);
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const listeners = new AbortController();
  const listening = { signal: listeners.signal };

  let query = '';
  let remoteState: RemoteState<A> = { status: 'idle' };
  let optionList: Option<T>[] = [];
  let active = -1;
  let closed = false;
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  /** What the open sheet has put out of reach; null while nothing is. */
  let heldBack: HTMLElement[] | null = null;

  // ---- structure -------------------------------------------------------------------------

  const root = element('div', 'picker');
  const scrim = element('div', 'picker__scrim');
  const panel = element('div', 'picker__panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', `${uid}-title`);
  panel.tabIndex = -1;

  const head = element('div', options.line === undefined ? 'picker__head' : 'picker__head picker__head--lined');
  const title = element('h2', 'picker__title');
  title.id = `${uid}-title`;
  if (heading.ink) title.append(inkSwatch(heading.ink));
  title.append(element('span', 'picker__role', heading.lead));
  if (heading.rest) title.append(' ', element('span', 'picker__helper', heading.rest));
  const closeButton = element('button', 'picker__close');
  closeButton.type = 'button';
  closeButton.append(icon(ICONS.close, 'picker__icon'), 'Close');
  head.append(title, closeButton);

  const line = options.line === undefined ? null : element('p', 'picker__line', options.line);
  if (line) {
    line.id = `${uid}-line`;
    panel.setAttribute('aria-describedby', line.id);
  }

  const field = element('div', 'picker__field');
  const input = element('input', 'picker__input');
  input.type = 'text';
  input.placeholder = options.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = LONGEST_QUERY;
  input.inputMode = 'search';
  input.enterKeyHint = 'go';
  input.setAttribute('autocapitalize', 'words');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', options.placeholder);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', `${uid}-list`);
  field.append(icon(ICONS.search, 'picker__icon picker__field-icon'), input);

  const scroll = element('div', 'picker__scroll');
  const notice = element('div', 'picker__notice');
  const retryButton = element('button', 'picker__button', 'Try again');
  retryButton.type = 'button';
  notice.append(element('p', 'picker__notice-text', options.unavailable), retryButton);
  const listbox = element('div', 'picker__list');
  listbox.id = `${uid}-list`;
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', rowsAre.list);
  const status = element('p', 'picker__status');
  scroll.append(notice, listbox, status);

  const live = element('div', 'picker__live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  panel.append(head, ...(line ? [line] : []), field, scroll, live);
  root.append(scrim, panel);

  // ---- drawing ---------------------------------------------------------------------------

  const countOf = (rows: number): string => (rows === 1 ? `1 ${rowsAre.one}` : `${rows} ${rowsAre.many}`);

  const setActive = (index: number, by: 'keys' | 'pointer'): void => {
    optionList[active]?.element.setAttribute('aria-selected', 'false');
    active = index;
    listbox.dataset['nav'] = by;
    const target = optionList[index]?.element;
    if (!target) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    target.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', target.id);
    if (by === 'keys') target.scrollIntoView({ block: 'nearest' });
  };

  const drawOption = (look: RowLook, index: number): HTMLElement => {
    const { name, context, note, standing = 'free', sheet } = look;
    const option = element('div', 'picker__option');
    option.id = `${uid}-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset['standing'] = standing;
    if (standing === 'taken') option.setAttribute('aria-disabled', 'true');
    option.setAttribute('aria-label', accessibleRowName(look));

    if (sheet) option.append(inkSwatch(sheet.ink));
    const label = element('span', 'picker__label');
    label.append(element('span', 'picker__name', name));
    if (context) label.append(' ', element('span', 'picker__context', context));
    option.append(label);
    if (note) {
      const noteElement = element('span', 'picker__note', note);
      if (standing === 'current') noteElement.prepend(icon(ICONS.current, 'picker__icon'));
      option.append(noteElement);
    }
    return option;
  };

  const drawList = (sections: readonly Section<T>[], searching: boolean): void => {
    optionList = [];
    const blocks: HTMLElement[] = [];
    for (const [sectionIndex, section] of sections.entries()) {
      if (section.rows.length === 0) continue;
      const drawn = section.rows.map((row) => {
        const look = options.look(row);
        const option = drawOption(look, optionList.length);
        optionList.push({ row, look, element: option, answers: searching && !section.offered });
        return option;
      });
      if (section.label === undefined) {
        blocks.push(...drawn);
        continue;
      }
      const group = element('div', 'picker__group');
      const groupLabel = element('div', 'picker__group-label', section.label);
      groupLabel.id = `${uid}-group-${sectionIndex}`;
      groupLabel.setAttribute('role', 'presentation');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', groupLabel.id);
      group.append(groupLabel, ...drawn);
      blocks.push(group);
    }
    listbox.replaceChildren(...blocks);
    listbox.hidden = blocks.length === 0;
  };

  const announce = (message: string): void => {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      live.textContent = message;
    }, ANNOUNCE_DELAY_MS);
  };

  /** Redraws the list. `keep` holds the highlighted row in place when rows are only being added below it. */
  const render = (keep: boolean, speak = true): void => {
    // The remote search reports at once on every keystroke, and is idle for what is too short to ask about.
    const searching = remoteState.status !== 'idle';
    const keptKey = keep ? optionList[active]?.look.key : undefined;
    drawList(searching ? options.answers(query, remoteState) : options.browse(), searching);

    const rows = optionList.length;
    const waiting = remoteState.status === 'waiting';
    const unavailable = remoteState.status === 'unavailable';
    const nothingToList = remoteState.status === 'done' && rows === 0 ? options.noMatch(query, remoteState.answer) : null;

    input.setAttribute('aria-expanded', String(rows > 0));
    notice.hidden = !unavailable;
    status.hidden = !waiting && nothingToList === null;
    status.textContent = nothingToList ?? SEARCHING;
    status.classList.toggle('picker__status--empty', nothingToList !== null);

    // Enter should land on the best new answer to what was typed: not on what is already held, and
    // not on a row that is only listed as a fallback.
    const kept = keptKey === undefined ? -1 : optionList.findIndex((option) => option.look.key === keptKey);
    const bestAnswer = optionList.findIndex((option) => option.answers && (option.look.standing ?? 'free') === 'free');
    active = -1;
    setActive(kept !== -1 ? kept : bestAnswer, kept !== -1 && listbox.dataset['nav'] === 'pointer' ? 'pointer' : 'keys');
    if (!keep) scroll.scrollTop = 0;

    if (!speak) return;
    if (unavailable) announce(rows > 0 ? `${options.unavailable} ${countOf(rows)} listed.` : options.unavailable);
    else if (nothingToList !== null) announce(nothingToList);
    else if (waiting) announce(rows > 0 ? `${countOf(rows)} so far. ${SEARCHING}` : SEARCHING);
    else if (searching) announce(rows === 1 ? `1 ${rowsAre.one} matches.` : `${rows} ${rowsAre.many} match.`);
    else announce(`${countOf(rows)} listed.`);
  };

  const remote = createRemoteSearch<A>((state) => {
    const sameQuery = 'query' in state && 'query' in remoteState && state.query === remoteState.query;
    remoteState = state;
    render(sameQuery);
  }, options.remote);

  // ---- layout ----------------------------------------------------------------------------

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

  const layOut = (): void => {
    const sheet = isSheet();
    const band = visibleBand(window.innerHeight, window.visualViewport);
    const set = (name: string, value: number): void => panel.style.setProperty(`--picker-${name}`, `${value}px`);
    root.dataset['layout'] = sheet ? 'sheet' : 'popover';
    panel.setAttribute('aria-modal', String(sheet));
    holdBackPage(sheet);
    if (sheet) {
      const fit = fitSheet(window.innerHeight, band);
      set('lift', fit.lift);
      set('sheet-height', fit.height);
      return;
    }
    const anchorBox = anchor.getBoundingClientRect();
    const ownMargin = anchor.closest('[data-picker-edge]');
    const edge = ownMargin?.getBoundingClientRect() ?? anchorBox;
    const pageMargin = document.querySelector('[data-picker-edge]')?.getBoundingClientRect();
    // A control above the page's margin stands on its own (the pin on the map). One that reaches into
    // the margin (a button in the band over the collar) is part of it, though no child of it.
    const alone = !ownMargin && (!pageMargin || anchorBox.bottom <= pageMargin.top);
    const box = placePopover({
      anchorLeft: anchorBox.left,
      ...(alone ? { alone: { anchorRight: anchorBox.right, marginTop: pageMargin?.top ?? null } } : {}),
      edgeTop: edge.top,
      edgeBottom: edge.bottom,
      screenWidth: document.documentElement.clientWidth,
      band,
    });
    set('left', box.left);
    set('top', box.top);
    set('width', box.width);
    set('height', box.height);
  };

  // ---- closing and picking ---------------------------------------------------------------

  const close = (): void => {
    if (closed) return;
    closed = true;
    remote.stop();
    clearTimeout(announceTimer);
    listeners.abort();
    const focused = document.activeElement;
    const focusIsOurs = !focused || focused === document.body || root.contains(focused);
    root.remove();
    holdBackPage(false);
    anchor.setAttribute('aria-expanded', 'false');
    if (openPicker === picker) openPicker = null;
    if (focusIsOurs) anchor.focus({ preventScroll: true });
    options.onClose();
  };

  const pick = (option: Option<T> | undefined): void => {
    if (!option || option.look.standing === 'taken') return;
    // Let go of the page before it hears of the pick: what it says about the change in a live region
    // would go unheard while it is held back.
    holdBackPage(false);
    try {
      options.onPick(option.row);
    } finally {
      close();
    }
  };

  // ---- input -----------------------------------------------------------------------------

  /** Focus rests in the field, ready for typing, except after a touch: then on the panel, so that no keyboard comes up. */
  const focusRestsOnPanel = (): boolean => restsOnPanel(lastInput.kind(), coarsePointer.matches);
  const focusRestingPlace = (): void => (focusRestsOnPanel() ? panel : input).focus({ preventScroll: true });

  const moveActive = (to: Move): void => {
    const last = optionList.length - 1;
    if (last < 0) return;
    const next = active === -1 || active === last ? 0 : active + 1;
    const previous = active <= 0 ? last : active - 1;
    setActive({ next, previous, first: 0, last }[to], 'keys');
  };

  const onTab = (event: KeyboardEvent): void => {
    // In the order they are seen: with a one-row head, Close comes after the field.
    const headStops = oneRowHead.matches ? [input, closeButton] : [closeButton, input];
    const stops = [...headStops, retryButton].filter(isShown);
    const at = stops.findIndex((stop) => stop === document.activeElement);
    const step = event.shiftKey ? -1 : 1;
    if (isSheet()) {
      // The sheet is modal: focus goes round inside it.
      event.preventDefault();
      const next = at === -1 && event.shiftKey ? -1 : (at + step) % stops.length;
      stops.at(next)?.focus();
    } else if (at + step < 0 || at + step >= stops.length) {
      // Focus returns to the anchor, and the browser's own Tab then carries on from there.
      close();
    }
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
      if (event.key === 'Tab') {
        onTab(event);
        return;
      }
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      // A key pressed while focus rests on the panel is meant for the field, and what it types lands there.
      if (event.target === panel) input.focus({ preventScroll: true });
      else if (event.target !== input) return;
      const move = event.shiftKey ? undefined : MOVES.get(event.key);
      if (move) {
        event.preventDefault();
        moveActive(move);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        pick(optionList[active]);
      }
    },
    listening,
  );

  input.addEventListener(
    'input',
    () => {
      const typed = cleanQuery(input.value);
      if (typed === query) {
        remote.stillTyping();
        return;
      }
      query = typed;
      // The remote search reports its new state synchronously, and that report redraws the list.
      remote.ask(query);
    },
    listening,
  );

  const optionAt = (target: EventTarget | null): number => {
    const hit = target instanceof Element ? target.closest('.picker__option') : null;
    return optionList.findIndex((option) => option.element === hit);
  };

  listbox.addEventListener(
    'pointermove',
    (event) => {
      const index = optionAt(event.target);
      if (event.pointerType === 'mouse' && index !== -1 && index !== active) setActive(index, 'pointer');
    },
    listening,
  );
  // A press on a row or on the panel's margin leaves the caret in the field. After a touch the press is
  // let through, so that focus moves to the panel and the on-screen keyboard gets out of the way.
  panel.addEventListener(
    'mousedown',
    (event) => {
      const onControl = event.target instanceof Element && event.target.closest('input, button') !== null;
      if (!onControl && !focusRestsOnPanel()) event.preventDefault();
    },
    listening,
  );
  listbox.addEventListener('click', (event) => pick(optionList[optionAt(event.target)]), listening);

  retryButton.addEventListener(
    'click',
    () => {
      focusRestingPlace();
      remote.retry(query);
    },
    listening,
  );
  closeButton.addEventListener('click', close, listening);
  // On release, not on press: otherwise the tap that dismisses the sheet lands on whatever lies beneath it.
  scrim.addEventListener('click', close, listening);
  dismissByDragging({ panel, scroller: scroll, enabled: isSheet, onDismiss: close, signal: listeners.signal });

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (isSheet() || !(event.target instanceof Node)) return;
      if (panel.contains(event.target) || anchor.contains(event.target)) return;
      close();
      // The press then moves focus to what was pressed; when that is nothing focusable, hand it to the anchor.
      setTimeout(() => {
        if (document.activeElement === document.body) anchor.focus({ preventScroll: true });
      }, 0);
    },
    { capture: true, signal: listeners.signal },
  );

  window.addEventListener('resize', layOut, listening);
  sheetScreen.addEventListener('change', layOut, listening);
  window.visualViewport?.addEventListener('resize', layOut, listening);
  window.visualViewport?.addEventListener('scroll', layOut, listening);

  // ---- open ------------------------------------------------------------------------------

  const picker: SearchPicker = { close };
  openPicker = picker;
  document.body.append(root);
  anchor.setAttribute('aria-expanded', 'true');
  layOut();
  render(false, false);
  focusRestingPlace();
  return picker;
}
