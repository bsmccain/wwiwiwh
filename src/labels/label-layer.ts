import type { LngLat } from '../geo/types';
import type { DualMap, ScreenBox, Sheet } from '../map/contracts';
import { liesOnAny } from './collide';

/** One label as a collision pass wants it shown. */
export interface LabelSpec {
  /** Stands for the same place of the same sheet from pass to pass. */
  readonly key: string;
  readonly sheet: Sheet;
  readonly name: string;
  readonly position: LngLat;
  /** Cities are set larger. */
  readonly city: boolean;
  /** Size of the label's own box, without the outline or halo drawn around it. */
  readonly width: number;
  readonly height: number;
  /** How far that outline or halo reaches beyond the box on every side. */
  readonly bleed: number;
  /** How far below (or, negative, above) its place the label sits. */
  readonly shift: number;
}

/** The label elements on the plate. */
export interface LabelLayer {
  /** The shift of the label now on show for a key, or undefined when there is none. */
  shiftOf(key: string): number | undefined;
  /** Makes these the labels on show: new ones fade in, the rest fade out. */
  show(labels: readonly LabelSpec[]): void;
  /** Puts every label where its place is drawn right now. Cheap enough for every map frame. */
  follow(): void;
  /**
   * Takes off at once, with no fade, every label that as drawn now lies on one of these boxes. Cheap
   * enough for every map frame, for a handful of boxes.
   */
  hideOn(boxes: readonly ScreenBox[]): void;
  destroy(): void;
}

/** A shifted label that would move further than this in one go fades across instead of jumping. */
export const HOP_PX = 6;
/** Keep in step with --dur-fast. */
const FADE_MS = 120;
/** Elements kept for reuse once their label is gone. */
const MAX_SPARE_ELEMENTS = 48;

const CLASS_NAME = 'wwiwiwh-name';
const CLASS_ON = 'wwiwiwh-name--on';

interface LabelView {
  readonly key: string;
  readonly sheet: Sheet;
  readonly element: HTMLElement;
  position: LngLat;
  /** Half the size of the element's box. */
  halfWidth: number;
  halfHeight: number;
  readonly bleed: number;
  shift: number;
  /** The last position written to the element. */
  x: number;
  y: number;
  /** Set while the label fades out, before its element is taken back. */
  leaving: ReturnType<typeof setTimeout> | null;
}

/**
 * Keeps one element per label inside `root` and moves them with the maps. Elements are reused, so
 * the plate does not grow however long the maps are moved about.
 */
export function createLabelLayer(root: HTMLElement, dual: Pick<DualMap, 'projectHome' | 'projectAway'>): LabelLayer {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** Labels on show. */
  const views = new Map<string, LabelView>();
  /** Labels fading out. They still ride with the maps until they are gone. */
  const leaving = new Set<LabelView>();
  const spareElements: HTMLElement[] = [];
  let pixelRatio = window.devicePixelRatio || 1;

  /** The one thing done per label per map frame: project, and write a transform if it moved. */
  function place(view: LabelView): void {
    const point = view.sheet === 'home' ? dual.projectHome(view.position) : dual.projectAway(view.position);
    // Whole device pixels keep the lettering crisp. The label is then at most half a pixel off its place.
    const x = Math.round((point.x - view.halfWidth) * pixelRatio) / pixelRatio;
    const y = Math.round((point.y + view.shift - view.halfHeight) * pixelRatio) / pixelRatio;
    if (x === view.x && y === view.y) return;
    view.x = x;
    view.y = y;
    view.element.style.transform = `translate3d(${x}px,${y}px,0)`;
  }

  function takeElement(): HTMLElement {
    const spare = spareElements.pop();
    if (spare) return spare;
    const element = document.createElement('span');
    root.append(element);
    return element;
  }

  function giveBack(element: HTMLElement): void {
    element.hidden = true;
    if (spareElements.length < MAX_SPARE_ELEMENTS) spareElements.push(element);
    else element.remove();
  }

  function mount(label: LabelSpec): LabelView {
    const element = takeElement();
    element.className = `${CLASS_NAME} ${CLASS_NAME}--${label.sheet}${label.city ? ` ${CLASS_NAME}--city` : ''}`;
    element.textContent = label.name;
    // Away's halo is drawn from this attribute (see type-plate.css).
    if (label.sheet === 'away') element.dataset.name = label.name;
    else delete element.dataset.name;
    // A Home tag is given its width, a whole number of pixels, so both its edges are crisp.
    element.style.width = label.sheet === 'home' ? `${label.width}px` : '';
    return {
      key: label.key,
      sheet: label.sheet,
      element,
      position: label.position,
      halfWidth: label.width / 2,
      halfHeight: label.height / 2,
      bleed: label.bleed,
      shift: label.shift,
      x: Number.NaN,
      y: Number.NaN,
      leaving: null,
    };
  }

  function retire(view: LabelView): void {
    views.delete(view.key);
    view.element.classList.remove(CLASS_ON);
    if (reducedMotion.matches) {
      giveBack(view.element);
      return;
    }
    leaving.add(view);
    view.leaving = setTimeout(() => {
      leaving.delete(view);
      giveBack(view.element);
    }, FADE_MS);
  }

  /** Whether a label, with its outline or halo, is drawn on one of the boxes. */
  function isOn(view: LabelView, boxes: readonly ScreenBox[]): boolean {
    return liesOnAny(
      {
        left: view.x - view.bleed,
        top: view.y - view.bleed,
        right: view.x + 2 * view.halfWidth + view.bleed,
        bottom: view.y + 2 * view.halfHeight + view.bleed,
      },
      boxes,
    );
  }

  /** A label of this place that is still fading out at about this spot, taken back before it is gone. */
  function revive(label: LabelSpec): LabelView | undefined {
    for (const view of leaving) {
      if (view.key !== label.key || Math.abs(view.shift - label.shift) > HOP_PX) continue;
      if (view.leaving !== null) clearTimeout(view.leaving);
      view.leaving = null;
      leaving.delete(view);
      return view;
    }
    return undefined;
  }

  return {
    shiftOf: (key) => views.get(key)?.shift,

    show(labels) {
      pixelRatio = window.devicePixelRatio || 1;
      const wanted = new Set<string>();
      for (const label of labels) {
        wanted.add(label.key);
        let view = views.get(label.key);
        if (view && Math.abs(view.shift - label.shift) > HOP_PX) {
          retire(view);
          view = undefined;
        }
        if (view) {
          view.position = label.position;
          view.shift = label.shift;
          if (view.halfWidth !== label.width / 2) {
            // The font arrived after the label was first measured.
            view.halfWidth = label.width / 2;
            if (label.sheet === 'home') view.element.style.width = `${label.width}px`;
          }
          place(view);
          continue;
        }
        view = revive(label) ?? mount(label);
        view.position = label.position;
        view.shift = label.shift;
        place(view);
        views.set(view.key, view);
        view.element.hidden = false;
        view.element.classList.add(CLASS_ON);
      }
      for (const view of [...views.values()]) {
        if (!wanted.has(view.key)) retire(view);
      }
    },

    follow() {
      for (const view of views.values()) place(view);
      for (const view of leaving) place(view);
    },

    hideOn(boxes) {
      if (boxes.length === 0) return;
      for (const view of views.values()) {
        if (!isOn(view, boxes)) continue;
        views.delete(view.key);
        view.element.classList.remove(CLASS_ON);
        giveBack(view.element);
      }
      for (const view of leaving) {
        if (!isOn(view, boxes)) continue;
        if (view.leaving !== null) clearTimeout(view.leaving);
        leaving.delete(view);
        giveBack(view.element);
      }
    },

    destroy() {
      for (const view of leaving) {
        if (view.leaving !== null) clearTimeout(view.leaving);
      }
      views.clear();
      leaving.clear();
      spareElements.length = 0;
      root.replaceChildren();
    },
  };
}
