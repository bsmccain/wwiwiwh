import './stage.css';
import type { ScreenBox } from '../map/contracts';
import { button, el, iconButton, setText } from './dom';
import { icon } from './icons';

/** A standing note at the top of the stage about the maps themselves. */
export interface StageNote {
  /** `loading` and `degraded` are quiet lines; `down` is announced at once. */
  readonly tone: 'loading' | 'degraded' | 'down';
  readonly text: string;
  /** Offers a "Try again" button that calls this. */
  readonly onRetry?: () => void;
}

export interface Stage {
  readonly element: HTMLElement;
  /** The three layers, bottom to top: the map pair, the instruments, the place names. All the same size. */
  readonly maps: HTMLElement;
  readonly instruments: HTMLElement;
  readonly plate: HTMLElement;
  /** Where the bar scale goes when the collar has no room for it. */
  readonly mapScale: HTMLElement;
  /** The top of the stage, under the standing note: where the one-time hint goes. */
  readonly top: HTMLElement;
  /** Where toasts come up, just above the caption. */
  readonly toastHost: HTMLElement;
  /** The bottom edge of the stage: the caption band is its last child. */
  readonly foot: HTMLElement;
  /** The page's heading, for assistive technology. */
  setHeading(text: string): void;
  /** Puts up the zoom buttons. */
  offerZoom(onZoom: (delta: number) => void): void;
  /** Disables the zoom button that has nowhere left to go. */
  setZoomRoom(room: { readonly in: boolean; readonly out: boolean }): void;
  /** Shows a standing note about the maps; null takes it away. */
  setNote(note: StageNote | null): void;
  /**
   * The boxes of what is drawn on the maps beneath the place names (the bar scale and the credit on
   * narrow screens), in the layers' own coordinates. Measured when the layout changes, never here.
   */
  reservedBoxes(): readonly ScreenBox[];
  onReservedChange(listener: () => void): void;
  /** Replaces the maps with a message when they cannot be drawn at all. */
  showUnavailable(message: string): void;
}

export interface StageOptions {
  /** The short credit on the map was pressed (narrow screens, where the collar has no credits line). */
  onCredit(): void;
}

function sameBoxes(a: readonly ScreenBox[], b: readonly ScreenBox[]): boolean {
  return (
    a.length === b.length &&
    a.every((box, index) => {
      const other = b[index];
      return other !== undefined && box.x === other.x && box.y === other.y && box.width === other.width && box.height === other.height;
    })
  );
}

/**
 * The stage: everything above the collar. Three layers fill it down to where the caption band
 * begins: the map pair, the instruments, and the place names on top. Around them, in the order Tab
 * takes: a column of notes at the top, and at the bottom the furniture (toasts, the zoom buttons,
 * and on narrow screens the bar scale and a credit) standing on the caption band.
 *
 * The caption lies over the stage's bottom edge instead of sitting below the stage, so the maps
 * never change size because its words did.
 */
export function createStage(options: StageOptions): Stage {
  const heading = el('h1', 'visually-hidden');
  const maps = el('div', 'stage__layer stage__layer--maps');
  const instruments = el('div', 'stage__layer stage__layer--instruments');
  const plate = el('div', 'stage__layer stage__layer--plate');

  // Both regions are in the page from the start: a live region added together with its text is not announced.
  const quietLine = el('p', 'stage__status-line', { role: 'status' });
  const urgentLine = el('p', 'stage__status-line', { role: 'alert' });
  const retry = button('stage__retry', { hidden: '' }, ['Try again']);
  const status = el('div', 'stage__status', {}, [quietLine, urgentLine, retry]);
  const top = el('div', 'stage__top', {}, [status]);

  const mapScale = el('div', 'stage__scale');
  const credit = button('stage__credit', { 'aria-label': 'Map credits: © OpenStreetMap contributors and others' }, ['© OpenStreetMap']);
  credit.addEventListener('click', options.onCredit);
  const toastHost = el('div', 'stage__toasts');
  const zoomIn = iconButton('zoom__button', 'Zoom in', icon('plus'));
  const zoomOut = iconButton('zoom__button', 'Zoom out', icon('minus'));
  const zoom = el('div', 'zoom', { role: 'group', 'aria-label': 'Zoom', hidden: '' }, [zoomIn, zoomOut]);
  const furniture = el('div', 'stage__furniture', {}, [toastHost, mapScale, zoom, credit]);
  const foot = el('div', 'stage__foot', {}, [furniture]);

  const element = el('main', 'stage', {}, [heading, maps, instruments, plate, top, foot]);

  let onRetry: (() => void) | null = null;
  retry.addEventListener('click', () => onRetry?.());

  // --- what the place names must keep off ---

  let reserved: readonly ScreenBox[] = [];
  const reservedListeners: (() => void)[] = [];
  const measureReserved = (): void => {
    const origin = maps.getBoundingClientRect();
    const next = [mapScale, credit].flatMap((part) => {
      const box = part.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return [];
      return [{ x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height }];
    });
    if (sameBoxes(next, reserved)) return;
    reserved = next;
    for (const listener of reservedListeners) listener();
  };
  // The furniture stands on the caption, so it moves when the caption or the stage changes size.
  const layoutChanges = new ResizeObserver(measureReserved);
  for (const part of [element, foot, mapScale, credit]) layoutChanges.observe(part);

  return {
    element,
    maps,
    instruments,
    plate,
    mapScale,
    top,
    toastHost,
    foot,
    setHeading: (text) => setText(heading, text),
    offerZoom(onZoom) {
      zoomIn.addEventListener('click', () => onZoom(1));
      zoomOut.addEventListener('click', () => onZoom(-1));
      zoom.hidden = false;
    },
    setZoomRoom(room) {
      for (const [control, other, hasRoom] of [
        [zoomIn, zoomOut, room.in],
        [zoomOut, zoomIn, room.out],
      ] as const) {
        // Focus must not be left on a button that has just stopped working.
        if (!hasRoom && document.activeElement === control) other.focus({ preventScroll: true });
        control.disabled = !hasRoom;
      }
    },
    setNote(note) {
      if (note) status.dataset['tone'] = note.tone;
      else delete status.dataset['tone'];
      setText(quietLine, note && note.tone !== 'down' ? note.text : '');
      setText(urgentLine, note?.tone === 'down' ? note.text : '');
      onRetry = note?.onRetry ?? null;
      retry.hidden = onRetry === null;
    },
    reservedBoxes: () => reserved,
    onReservedChange(listener) {
      reservedListeners.push(listener);
    },
    showUnavailable(message) {
      layoutChanges.disconnect();
      for (const part of [maps, instruments, plate, status, mapScale, credit, zoom]) part.remove();
      element.append(el('p', 'stage__unavailable', { role: 'alert' }, [message]));
    },
  };
}
