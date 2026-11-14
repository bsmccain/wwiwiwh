import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Theme, View } from '../app/types';
import type { Registration } from '../geo/registration';
import type { LngLat, Outline } from '../geo/types';

/** A position inside the stage, in CSS pixels from its top-left corner. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle inside the stage, in CSS pixels. */
export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Which of the two stacked maps. Away is the base map, the one that takes input; Home is the overlay
 * whose camera follows it. Whichever has the ground (see `MapStyles.ground`) is drawn underneath.
 */
export type Sheet = 'home' | 'away';

/** The id of the one vector source both styles use (OpenFreeMap, OpenMapTiles schema). */
export const SOURCE_ID = 'omt';

/** The zoom levels the Away camera may take. */
export const ZOOM_RANGE = { min: 4, max: 18 } as const;

/**
 * What a sheet shows besides its streets, printed by that sheet's own map in its own ink, so that
 * it moves, turns and hides with the sheet: the road a drive takes, and the area a drive reaches.
 */
export interface SheetDrawing {
  readonly route: readonly LngLat[] | null;
  readonly reach: Outline | null;
}

export const NO_DRAWING: SheetDrawing = { route: null, reach: null };

export interface MapStyles {
  /**
   * The sheet that prints the ground (the paper and the tints of land and water) and so lies
   * underneath. The other sheet is line-work printed over it. Away unless the viewer chose Home.
   */
  readonly ground: Sheet;
  /** Style of the Away (base) map. */
  readonly base: StyleSpecification;
  /**
   * Style of the Home (overlay) map. Home runs at `zoomOffset` zoom levels above Away (see
   * `zoomOffset()` in geo/registration), so the builder shifts its zoom stops by that much and the two
   * maps thicken and thin together. Called again whenever the offset has drifted noticeably.
   */
  readonly overlay: (zoomOffset: number) => StyleSpecification;
  /**
   * The layers a sheet's drawing is printed with, to go on top of that sheet's style. `zoomOffset` is
   * the same offset `overlay` takes, and matters to Home alone.
   */
  readonly drawing: (sheet: Sheet, zoomOffset: number) => LayerSpecification[];
  /** Registers runtime images (label tags, route shields) on a map. Called after each style load. */
  readonly prepare?: (map: MapLibreMap, sheet: Sheet) => void;
}

/** Builds the two styles for a theme, with the ground on Away unless told otherwise. Implemented in src/map/style. */
export type StyleFactory = (theme: Theme, ground?: Sheet) => MapStyles;

export interface DualMapOptions {
  /** Element that will hold both map canvases. The caller positions and sizes it; the pair fills it. */
  readonly container: HTMLElement;
  readonly registration: Registration;
  readonly view: View;
  readonly styles: MapStyles;
}

export interface FitOptions {
  /** Pixels to keep clear on every side, or per side. Default 48. */
  readonly padding?: number | { top: number; right: number; bottom: number; left: number };
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly animate?: boolean;
  /**
   * The framing answers something the person just did (measured a line, say) and is theirs to keep:
   * `viewchange` reports it with `byUser: true`. Otherwise a framing is the app's own choice of view.
   */
  readonly asUser?: boolean;
}

export interface MoveOptions {
  /** Ease to the new view instead of jumping. Default true (always false under reduced motion). */
  readonly animate?: boolean;
  /**
   * The move is the person's own doing (a button or key they pressed), not the app's choice of view,
   * so `viewchange` reports it with `byUser: true`.
   */
  readonly asUser?: boolean;
}

/**
 * Whether the maps can draw.
 *  - ok       : everything asked for has loaded or is loading normally.
 *  - degraded : some tiles failed to load, so parts of a sheet are missing. (Missing lettering never
 *               shows up here: MapLibre draws the characters locally and reports nothing.)
 *  - down     : a sheet cannot draw at all (its tile source or the map worker failed to load).
 * While not ok the pair retries on its own, with a growing pause, and at once when the browser comes
 * back online.
 */
export type MapHealthState = 'ok' | 'degraded' | 'down';

export interface MapHealth {
  readonly state: MapHealthState;
  /** The sheets that are affected; empty when ok. */
  readonly sheets: readonly Sheet[];
}

export interface DualMapEvents {
  /**
   * The picture changed: the Away camera moved and/or the registration changed. Fired synchronously,
   * inside the map's own render frame for camera moves, so anything drawn over the maps should
   * reposition itself right here (not in a later requestAnimationFrame) to stay glued to the canvases.
   * It can fire more than once per frame. Listeners must be cheap: write transforms, never read layout.
   */
  frame: undefined;
  /**
   * The Away camera came to rest. `byUser` is true for gestures on the map and for API moves flagged
   * `asUser`; it is false for views the app chose (framing a pair, following a link).
   */
  viewchange: { readonly view: View; readonly byUser: boolean };
  /**
   * The registration changed, by a gesture on the map or by `setRegistration`. `final` is false while
   * a slide or turn gesture is still in progress.
   */
  registrationchange: { readonly registration: Registration; readonly final: boolean };
  /**
   * Home started or stopped being moved on its own: by a gesture on the map (`onMap` true), or by a
   * handle drawn over it calling `setRegistration` with `final: false` (which starts one) and then
   * with a final change (which ends it). A slide made on the map ends with the pin under the pointer
   * that made it.
   */
  gesture: { readonly kind: 'slide' | 'turn'; readonly phase: 'start' | 'end'; readonly onMap: boolean };
  /**
   * A tap or click on the map that was not part of a drag. Not fired for presses that slid or
   * turned Home. A listener that uses the click for something drawn over the maps says so with
   * `claimClick`.
   */
  click: { readonly point: ScreenPoint; readonly away: LngLat; readonly home: LngLat };
  /** Both maps have finished loading and drawing the current view. */
  idle: undefined;
  /** The maps' ability to draw changed. See `MapHealth`. */
  health: MapHealth;
}

/**
 * The pair of stacked maps, kept locked together at the same ground scale.
 *
 * Away (base) is interactive and always north-up and flat. Home (overlay) never receives input; its
 * camera is derived from Away's camera and the registration on every frame.
 *
 * Gestures the pair handles itself:
 *  - drag / wheel / pinch / double-click / arrow keys and +/- : move and zoom both maps together.
 *  - Shift+drag (mouse), or any one-finger / left-button drag while slide mode is on: slide Home. The
 *    pin jumps to the spot that was grabbed (`repin`), then that spot follows the pointer; a press
 *    without movement therefore just moves the pin there. (With a mouse the jump is on press; with a
 *    finger it waits until the finger moves or lifts, so the first finger of a pinch moves nothing.)
 *  - Alt+drag or right-button drag (mouse), or a two-finger twist while slide mode is on: turn Home
 *    about the pin.
 */
export interface DualMap {
  /** The underlying maps, for reading tile data (e.g. querySourceFeatures). Do not move their cameras directly. */
  readonly base: MapLibreMap;
  readonly overlay: MapLibreMap;

  /** Size of the stage in CSS pixels. */
  getSize(): { width: number; height: number };

  getView(): View;
  /** Moves the Away camera. A move further than about two stage diagonals jumps instead of animating. */
  setView(view: View, options?: MoveOptions): void;
  /** Frames the given Away positions. An app-chosen view (`viewchange` reports byUser false) unless `asUser` is set. */
  fit(points: readonly LngLat[], options?: FitOptions): void;
  zoomBy(delta: number, options?: MoveOptions): void;
  /** Moves the view by this many pixels (the picture shifts the other way). */
  panBy(dx: number, dy: number, options?: MoveOptions): void;
  /** True while the Away camera is animating or being dragged, pinched or wheeled. */
  isMoving(): boolean;

  getRegistration(): Registration;
  /**
   * Replaces the registration and emits `registrationchange` (final defaults to true). A non-final
   * change starts a Home gesture if none is running; the next final change ends it (see `gesture`).
   */
  setRegistration(registration: Registration, options?: { final?: boolean }): void;
  /**
   * For a `click` listener, while it is being called: the click was for something drawn over the
   * maps (the pin, lying under the pointer), not for the map. A second click or tap on the same spot
   * then does not zoom, as the second half of a double click would.
   */
  claimClick(): void;

  setSlideMode(on: boolean): void;
  /**
   * Measuring: taps place trip ends, so double-click / double-tap zoom is off and the stage shows a
   * crosshair cursor (class `wwiwiwh-stage--measure`).
   */
  setMeasureMode(on: boolean): void;
  setHomeHidden(hidden: boolean): void;
  setStyles(styles: MapStyles): void;
  /** Replaces what a sheet shows besides its streets. A drawing whose route and reach are the ones already shown costs nothing. */
  setDrawing(sheet: Sheet, drawing: SheetDrawing): void;
  /** Lets the pair act on a wheel event that landed on something drawn over the maps (a handle). */
  passWheel(event: WheelEvent): void;

  getHealth(): MapHealth;
  /** Asks both maps to load again whatever failed, now, instead of waiting for the next automatic try. */
  retry(): void;

  /** Stage position of an Away position / of a Home position. */
  projectAway(position: LngLat): ScreenPoint;
  projectHome(position: LngLat): ScreenPoint;
  /** The Away position / the Home position drawn at a stage position. */
  unprojectAway(point: ScreenPoint): LngLat;
  unprojectHome(point: ScreenPoint): LngLat;

  /** Ground metres per CSS pixel at the given Away position (default: the view centre). */
  metersPerPixel(at?: LngLat): number;

  on<K extends keyof DualMapEvents>(type: K, listener: (event: DualMapEvents[K]) => void): () => void;

  /** Re-measures the stage now. (The pair also watches its container's size by itself.) */
  resize(): void;
  destroy(): void;
}

/** Implemented in src/map/engine. */
export type CreateDualMap = (options: DualMapOptions) => DualMap;
