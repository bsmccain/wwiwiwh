import './collar.css';
import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { Sheet } from '../map/contracts';
import { el, setText } from './dom';
import { createLegend, type Legend } from './legend';
import type { Overlays } from './overlays';
import { createPinSection } from './pin-section';
import type { Readouts } from './readouts';
import { createShare, type Share } from './share';
import { createSlideTools, type SlideTools } from './slide-tools';
import { createTools, type Tools } from './tools';

export interface Collar {
  readonly element: HTMLElement;
  readonly legend: Legend;
  readonly tools: Tools;
  readonly slideTools: SlideTools;
  readonly share: Share;
  /** Where the bar scale is drawn on wide screens. */
  readonly scaleHost: HTMLElement;
  /** Says under the bar scale where on the map its scale is taken. */
  setScaleNote(text: string): void;
}

export type CollarActions = Pick<
  Controller,
  'pickPlace' | 'swap' | 'turnBy' | 'squareUp' | 'slideBy' | 'toggleSlide' | 'toggleMeasure' | 'toggleRings' | 'setHomeHidden'
>;

/**
 * The collar: the margin of the printed sheet, where everything that is not map lives. Left to
 * right on wide screens: the legend (which is also the place pickers), the bar scale, the pin, the
 * tools, and sharing with the credits. In this order in the page too, which is the order Tab takes.
 */
export function createCollar(deps: {
  store: Store<AppState>;
  actions: CollarActions;
  overlays: Overlays;
  /** Null where the maps could not start: the collar still shows the places, with its map tools off. */
  readouts: Readouts | null;
  onCopy: () => void;
  onMore: () => void;
  /** One of the two spots in the pin sentence was pressed. */
  onSpot: (sheet: Sheet, part: HTMLElement) => void;
  /** Slide mode's own Done was pressed. */
  onLeaveMode: () => void;
}): Collar {
  const { store, actions, readouts } = deps;
  const mapReady = readouts !== null;

  const legend = createLegend({ store, actions, overlays: deps.overlays, disabled: !mapReady });
  const scaleHost = el('div', 'scale__bar');
  const scaleNote = el('p', 'scale__note');
  const scale = el('section', 'collar__section scale', { 'aria-label': 'Scale' }, [scaleHost, scaleNote]);
  const tools = createTools({ store, actions, disabled: !mapReady });
  const slideTools = createSlideTools({ actions, onDone: deps.onLeaveMode, disabled: !mapReady });
  const share = createShare({ onCopy: deps.onCopy, onMore: deps.onMore, copyDisabled: !mapReady });

  // Two groups, so that the collar can break into two rows where one is too narrow: what is on the
  // sheet, then what can be done with it. On other widths the groups dissolve into one row.
  const about = el('div', 'collar__group collar__group--about', {}, [
    legend.element,
    mapReady && scale,
    readouts && createPinSection({ readouts, actions, onSpot: deps.onSpot }),
  ]);
  const doing = el('div', 'collar__group collar__group--doing', {}, [tools.element, slideTools.element, share.element]);
  // A region, not a footer: these are the page's main controls, not its small print.
  const element = el('div', 'collar', { role: 'region', 'aria-label': 'Map key and tools' }, [about, doing]);

  // On narrow screens slide mode swaps the row of tools for its own (collar.css). Focus that was on
  // the button that vanished goes to its counterpart in the row that took its place.
  const showMode = (mode: AppState['mode'], previous: AppState['mode'] | null): void => {
    const slideToolHadFocus = document.activeElement === tools.button('slide');
    const slideRowHadFocus = slideTools.hasFocus();
    element.dataset['mode'] = mode;
    if (mode === 'slide' && slideToolHadFocus && slideTools.isShown()) slideTools.focusDone();
    else if (previous === 'slide' && slideRowHadFocus) tools.button('slide').focus({ preventScroll: true });
  };
  store.select((state) => state.mode, showMode);
  showMode(store.get().mode, null);

  return { element, legend, tools, slideTools, share, scaleHost, setScaleNote: (text) => setText(scaleNote, text) };
}
