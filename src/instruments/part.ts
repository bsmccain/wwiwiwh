import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { TextMeasurer } from '../dom/text-width';
import type { Registration } from '../geo/registration';
import type { DualMap, ScreenBox, ScreenPoint } from '../map/contracts';
import type { StageSize } from './geometry';
import type { PointerWatch } from './resting';
import type { Sizes } from './sizes';

/** What every instrument is built with. */
export interface InstrumentContext {
  readonly dual: DualMap;
  readonly store: Store<AppState>;
  /** The layer above the maps that holds the instruments. Its pixels are the stage's pixels. */
  readonly layer: HTMLElement;
  /** The drawing the rings and the trip line share, underneath every label and handle. */
  readonly ink: SVGSVGElement;
  /** Widths of lettering that layout has to know before it is drawn. */
  readonly measurer: TextMeasurer;
  /** Sizes of labels that only matter once drawn: to the place names, which keep clear of them. */
  readonly sizes: Sizes;
  /** The pointers seen on the page, which is how a resting handle learns that someone went to it. */
  readonly pointers: PointerWatch;
  /** Lays every instrument out again now, for changes that neither the maps nor the store announce. */
  readonly relayout: () => void;
}

/** The picture as it stands right now, worked out once and handed to every instrument. */
export interface Frame {
  readonly size: StageSize;
  readonly registration: Registration;
  /** Where the pin is on the stage. */
  readonly pin: ScreenPoint;
  /** Ground metres per pixel at the pin: exact there for both maps. */
  readonly metersPerPixel: number;
  /** The turn ring and its knob are showing. */
  readonly turnUp: boolean;
  /**
   * While the pin leaves presses to the map (see pin.ts): how far from its centre its own target
   * reaches. A handle lying that close would take the press in its place, so it steps aside too.
   * Null while the pin takes its presses itself.
   */
  readonly pinAsideRadius: number | null;
  readonly state: AppState;
}

/**
 * One instrument. `layout` runs inside the maps' own render frame and again on every relevant state
 * change, so it only writes (transforms, attributes, text) and never reads layout back.
 */
export interface Part {
  layout(frame: Frame): void;
  /** The stage boxes, as last laid out, that place names must keep clear of. */
  reserved(): readonly ScreenBox[];
  destroy(): void;
}
