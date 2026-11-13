import 'maplibre-gl/dist/maplibre-gl.css';
import './engine.css';
import { GPUInitializationError, MapLibreMap, setWorkerCount, setWorkerUrl } from 'maplibre-gl';
import type { GeoJSONSource, JumpToOptions, MapMovementEvent, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { View } from '../app/types';
import { clamp, metersPerPixel, wrapLng } from '../geo/mercator';
import { baseToOverlay, overlayCamera, overlayToBase, zoomOffset, type Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import { NO_DRAWING, ZOOM_RANGE } from './contracts';
import type { CreateDualMap, DualMap, DualMapEvents, DualMapOptions, MoveOptions, ScreenPoint, Sheet, SheetDrawing } from './contracts';
import { createEmitter } from './engine-emitter';
import {
  easeOut,
  fitView,
  gestureKind,
  nearestWorldCopy,
  offsetHasDrifted,
  panView,
  planMove,
  toInsets,
  type StageSize,
} from './engine-math';
import { watchMapHealth } from './engine-recovery';
import { BY_WHEEL_STEP, stepZoomOnWheel } from './engine-wheel';
import { bindHomeGestures, HomeGestures } from './gestures';
import { REACH_SOURCE_ID, ROUTE_SOURCE_ID, reachData, routeData, withDrawing } from './style/drawing';

const UNAVAILABLE_MESSAGE = {
  webgl: "This browser can't draw the maps because WebGL is off. Turn on hardware acceleration or try another browser.",
  other: 'The maps could not start. Reload the page to try again.',
} as const;

/**
 * Thrown by `createDualMap` when the maps cannot start: the browser has no WebGL 2 (`reason`
 * 'webgl'), or MapLibre failed to initialise some other way. The message is fit to show a person;
 * the original error is the `cause`.
 */
export class MapUnavailableError extends Error {
  override readonly name = 'MapUnavailableError';
  readonly reason: 'webgl' | 'other';

  constructor(cause: unknown) {
    const reason = cause instanceof GPUInitializationError ? 'webgl' : 'other';
    super(UNAVAILABLE_MESSAGE[reason], { cause });
    this.reason = reason;
  }
}

const DEFAULT_FIT_PADDING = 48;
/** Duration of one zoom or pan step asked for by the app (a button, a key). */
const STEP_MS = 200;

/**
 * Every camera move made through this module is marked as the app's own choice of view or as asked
 * for by the person (a button, a key), so `viewchange` can say which. Moves MapLibre makes for input
 * on the map itself carry no mark.
 */
const BY_APP = { wwiwiwhBy: 'app' } as const;
const AS_USER = { wwiwiwhBy: 'user' } as const;
type MoveTag = typeof BY_APP | typeof AS_USER;
type TaggedMove = MapMovementEvent & { readonly wwiwiwhBy?: MoveTag['wwiwiwhBy']; readonly wwiwiwhStretch?: number } & Partial<typeof BY_WHEEL_STEP>;

const moveTag = (options: MoveOptions | undefined): MoveTag => (options?.asUser ? AS_USER : BY_APP);

/** An eased move to a view: where it is going (asked again whenever the stage changes), and when it is due there. */
interface MoveUnderWay {
  aim: () => View | null;
  readonly tag: MoveTag;
  readonly arrivesAt: number;
  /** Names the stretch of the move now running. A move that is aimed again carries on as a new stretch. */
  stretch: number;
}

const GESTURE_CLASS = { slide: 'wwiwiwh-stage--sliding', turn: 'wwiwiwh-stage--turning' } as const;

type ListenerWrap = <Event>(handler: (event: Event) => void) => (event: Event) => void;
const asIs: ListenerWrap = (handler) => handler;

let workersReady = false;

function prepareWorkers(): void {
  if (workersReady) return;
  workersReady = true;
  setWorkerUrl(workerUrl);
  // One each, so the two sheets parse their tiles side by side.
  setWorkerCount(2);
}

function sheetElement(sheet: Sheet): HTMLDivElement {
  const element = document.createElement('div');
  element.className = `wwiwiwh-sheet wwiwiwh-sheet--${sheet}`;
  return element;
}

function startMaps(options: DualMapOptions, awayElement: HTMLElement, homeElement: HTMLElement) {
  const center: [number, number] = [options.view.center.lng, options.view.center.lat];
  const zoom = clamp(options.view.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max);
  const shared = {
    center,
    zoom,
    attributionControl: false,
    // One observer on the stage resizes both maps together; two of their own could land a frame apart.
    trackResize: false,
  } as const;

  const base = new MapLibreMap({
    ...shared,
    container: awayElement,
    style: withDrawing(options.styles.base, options.styles.drawing('away', 0), NO_DRAWING),
    minZoom: ZOOM_RANGE.min,
    maxZoom: ZOOM_RANGE.max,
    // Away stays flat and north-up for good, which frees twist and right-drag for turning Home.
    maxPitch: 0,
    pitchWithRotate: false,
    touchPitch: false,
    rollEnabled: false,
    dragRotate: false,
    // Shift+drag slides Home.
    boxZoom: false,
  });
  base.touchZoomRotate.disableRotation();
  base.keyboard.disableRotation();

  try {
    const home = new MapLibreMap({
      ...shared,
      container: homeElement,
      style: withDrawing(
        options.styles.overlay(zoomOffset(options.registration)),
        options.styles.drawing('home', zoomOffset(options.registration)),
        NO_DRAWING,
      ),
      interactive: false,
      // Home goes exactly where the registration puts it. MapLibre's own limits would clamp it
      // differently from Away at low zoom and high latitude, and the two would drift apart.
      transformConstrain: (lngLat, homeZoom) => ({ center: lngLat, zoom: homeZoom }),
    });
    return { base, home };
  } catch (error) {
    base.remove();
    throw error;
  }
}

export const createDualMap: CreateDualMap = (options: DualMapOptions): DualMap => {
  prepareWorkers();

  const stage = document.createElement('div');
  stage.className = 'wwiwiwh-stage';
  const awayElement = sheetElement('away');
  const homeElement = sheetElement('home');
  // Home never takes input or focus; Away's canvas speaks for the pair.
  homeElement.setAttribute('aria-hidden', 'true');
  stage.append(awayElement, homeElement);
  options.container.append(stage);

  let maps: ReturnType<typeof startMaps>;
  try {
    maps = startMaps(options, awayElement, homeElement);
  } catch (cause) {
    stage.remove();
    throw new MapUnavailableError(cause);
  }
  const { base, home } = maps;
  const mapOf = (sheet: Sheet): MapLibreMap => (sheet === 'away' ? base : home);

  const events = createEmitter<DualMapEvents>();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let styles = options.styles;
  let registration = options.registration;
  /** The zoom offset the current Home style was built for. */
  let homeStyleOffset = zoomOffset(registration);
  let size: StageSize = { width: stage.clientWidth, height: stage.clientHeight };
  let slideMode = false;
  let measureMode = false;
  let homeHeld = false;
  /** The click of the last press on the map was Home's (it slid or turned it) or was claimed by a listener. */
  let clickClaimed = false;
  /**
   * The Home gesture in progress, and whether it is being made through `setRegistration` (by a handle
   * drawn over the maps) instead of on the map itself.
   */
  let homeGesture: { readonly kind: 'slide' | 'turn'; readonly byHandle: boolean } | null = null;
  let awayContextLost = false;
  let destroyed = false;
  /** Where a zoom step in flight is heading, so a second step adds to it instead of to the zoom in passing. */
  let zoomTarget: number | null = null;
  let underWay: MoveUnderWay | null = null;
  let stretches = 0;
  let moveStartedAt: { lng: number; lat: number; zoom: number } | null = null;
  /** How many of Away's own event handlers we are inside. Away must not be redrawn from within them. */
  let awayEventDepth = 0;
  const styleLoaded: Record<Sheet, boolean> = { away: false, home: false };
  /** What each sheet shows besides its streets. */
  const drawings: Record<Sheet, SheetDrawing> = { away: NO_DRAWING, home: NO_DRAWING };
  const settled: Record<Sheet, boolean> = { away: false, home: false };

  // --- geometry ---

  function projectAway(position: LngLat): ScreenPoint {
    const point = base.project([nearestWorldCopy(position.lng, base.getCenter().lng), position.lat]);
    return { x: point.x, y: point.y };
  }

  function unprojectAway(point: ScreenPoint): LngLat {
    const position = base.unproject([point.x, point.y]);
    return { lng: wrapLng(position.lng), lat: position.lat };
  }

  function getView(): View {
    const center = base.getCenter();
    return { center: { lng: wrapLng(center.lng), lat: center.lat }, zoom: base.getZoom() };
  }

  function isMoving(): boolean {
    return base.isMoving() || wheelSteps.isTurning();
  }

  // --- keeping Home locked to Away ---

  /**
   * Puts Home's camera where the registration says and draws it at once. Called from Away's `move`,
   * this runs inside Away's own render frame before Away paints, so both canvases show the same
   * camera in the same frame. (`jumpTo` alone would leave Home a frame behind whenever it had no
   * frame of its own pending.)
   */
  function syncHome(): void {
    const camera = overlayCamera(registration, {
      center: base.getCenter(),
      zoom: base.getZoom(),
      bearing: base.getBearing(),
    });
    home.jumpTo({ center: [camera.center.lng, camera.center.lat], zoom: camera.zoom, bearing: camera.bearing });
    home.redraw();
  }

  /**
   * Draws Away now instead of on its next frame, for camera changes made outside a frame: Home has
   * already been redrawn, and a caller running after this frame's animation callbacks (a
   * ResizeObserver, say) would otherwise show the two sheets one frame apart. MapLibre cannot redraw
   * a map from inside that map's own events; there Away is about to paint anyway.
   */
  function redrawAway(): void {
    if (awayEventDepth === 0) base.redraw();
  }

  /** Wraps a listener on Away so `redrawAway` knows when it is being called from inside one. */
  const insideAway: ListenerWrap = (handler) => (event) => {
    awayEventDepth++;
    try {
      handler(event);
    } finally {
      awayEventDepth--;
    }
  };

  function applyRegistration(next: Registration, final: boolean): void {
    registration = next;
    syncHome();
    events.emit('registrationchange', { registration, final });
    events.emit('frame', undefined);
    if (final) refreshHomeStyle();
  }

  // --- styles ---

  /** A sheet's style as its map is given it: with the layers of its drawing on top, and the drawing itself. */
  function drawn(sheet: Sheet, style: StyleSpecification): StyleSpecification {
    return withDrawing(style, styles.drawing(sheet, homeStyleOffset), drawings[sheet]);
  }

  function applyStyle(sheet: Sheet, style: StyleSpecification): void {
    // A style that is still loading cannot be diffed against, so it is replaced outright.
    mapOf(sheet).setStyle(drawn(sheet, style), { diff: styleLoaded[sheet] });
  }

  /**
   * Hands a sheet's map the drawing as it stands now. A style that is still on its way has no
   * sources to hand it to: it was written out with the drawing of the moment, and is handed the
   * drawing again when it has loaded.
   */
  function showDrawing(sheet: Sheet, changed: { route: boolean; reach: boolean }): void {
    const map = mapOf(sheet);
    if (!map.style) return;
    const { route, reach } = drawings[sheet];
    if (changed.route) map.getSource<GeoJSONSource>(ROUTE_SOURCE_ID)?.setData(routeData(route));
    if (changed.reach) map.getSource<GeoJSONSource>(REACH_SOURCE_ID)?.setData(reachData(reach));
  }

  /** Rebuilds the Home style once its zoom offset has drifted from the one the style was built for. */
  function refreshHomeStyle(): void {
    const offset = zoomOffset(registration);
    // Never mid-gesture: swapping the style under a moving Home would stutter. The end of the gesture comes back here.
    if (homeGesture || !offsetHasDrifted(homeStyleOffset, offset)) return;
    homeStyleOffset = offset;
    applyStyle('home', styles.overlay(offset));
  }

  function watchSheet(sheet: Sheet): void {
    const map = mapOf(sheet);
    const wrap = sheet === 'away' ? insideAway : asIs;

    map.on('styledataloading', () => {
      styleLoaded[sheet] = false;
    });
    map.on('style.load', () => {
      styleLoaded[sheet] = true;
      styles.prepare?.(map, sheet);
      // The style was written out before it loaded; the drawing may have changed since.
      showDrawing(sheet, { route: true, reach: true });
    });

    // A sheet is settled when its last rendered frame ended idle and its camera has not moved since.
    map.on('render', () => {
      settled[sheet] = false;
    });
    map.on(
      'idle',
      wrap(() => {
        settled[sheet] = true;
        recovery.idle(sheet);
        announceIdle();
      }),
    );

    map.on(
      'sourcedata',
      wrap((event) => recovery.sourceData(sheet, event)),
    );
    map.on(
      'error',
      wrap((event) => {
        // Loading failures are followed and mended. Anything else is a fault in a style or in this code.
        if (!recovery.error(sheet, event)) console.warn(`[wwiwiwh] ${sheet === 'away' ? 'Away' : 'Home'} map:`, event.error);
      }),
    );
  }

  function announceIdle(): void {
    // `loaded()` catches a camera or style change the other sheet has not rendered yet.
    if (!settled.away || !settled.home || !base.loaded() || !home.loaded() || isMoving()) return;
    // A sheet that is down has drawn nothing, so the view is not there to be called drawn.
    if (recovery.getHealth().state === 'down') return;
    events.emit('idle', undefined);
  }

  let wasDown = false;
  const recovery = watchMapHealth({ away: base, home }, (health) => {
    events.emit('health', health);
    const down = health.state === 'down';
    // Idle was held back while a sheet was down. If both sheets finished drawing in the meantime, it is due now.
    if (wasDown && !down) announceIdle();
    wasDown = down;
  });

  // --- Away's camera ---

  base.on('movestart', () => {
    const center = base.getCenter();
    moveStartedAt = { lng: center.lng, lat: center.lat, zoom: base.getZoom() };
  });

  base.on(
    'move',
    insideAway(() => {
      settled.away = false;
      syncHome();
      events.emit('frame', undefined);
    }),
  );

  base.on(
    'moveend',
    insideAway((event: TaggedMove) => {
      // An earlier stretch of the move under way has ended because the move was aimed again. The move goes on.
      if (underWay && event.wwiwiwhStretch !== undefined && event.wwiwiwhStretch !== underWay.stretch) return;
      underWay = null;
      zoomTarget = null;
      // A turn of the wheel under reduced motion: the view has come to rest when the wheel has.
      if (event.wwiwiwhWheelStep) return;
      wheelSteps.forget();
      const center = base.getCenter();
      const from = moveStartedAt;
      const stayedPut = from !== null && from.lng === center.lng && from.lat === center.lat && from.zoom === base.getZoom();
      // MapLibre reports some input that changes nothing as a move (Shift+arrow with rotation off, for one).
      if (!event.wwiwiwhBy && stayedPut) return;
      events.emit('viewchange', { view: getView(), byUser: event.wwiwiwhBy !== 'app' });
    }),
  );

  home.on('move', () => {
    settled.home = false;
  });

  const wheelSteps = stepZoomOnWheel(base, reducedMotion, () => {
    events.emit('viewchange', { view: getView(), byUser: true });
    // Both sheets may have finished drawing while the wheel was still counted as turning.
    announceIdle();
  });

  function jump(camera: JumpToOptions, tag: MoveTag): void {
    base.jumpTo(camera, tag);
    redrawAway();
  }

  /** Moves Away to the view `aim` gives. An eased move asks `aim` again if the stage changes on the way. */
  function moveTo(aim: () => View | null, options: MoveOptions | undefined): void {
    const view = aim();
    if (!view) return;
    const center: [number, number] = [view.center.lng, view.center.lat];
    const zoom = clamp(view.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max);
    const tag = moveTag(options);
    const plan =
      options?.animate === false || reducedMotion.matches
        ? ({ kind: 'jump' } as const)
        : planMove(getView(), { center: view.center, zoom }, size);
    if (plan.kind === 'jump') {
      jump({ center, zoom }, tag);
      return;
    }
    const stretch = ++stretches;
    base.easeTo({ center, zoom, duration: plan.duration, easing: easeOut }, { ...tag, wwiwiwhStretch: stretch });
    underWay = { aim, tag, arrivesAt: performance.now() + plan.duration, stretch };
  }

  /**
   * Sends the eased move under way to where it is meant to go now, in the time it has left. MapLibre
   * aims a move at the middle the stage had when the move began, so one that is not aimed again
   * after a resize ends up beside its destination. `easeOut` restarted partway carries on along its
   * own curve, so the movement shows no seam.
   */
  function aimAgain(move: MoveUnderWay): void {
    const view = move.aim();
    if (!view) return;
    const center: [number, number] = [view.center.lng, view.center.lat];
    const zoom = clamp(view.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max);
    move.stretch = ++stretches;
    const duration = Math.max(0, move.arrivesAt - performance.now());
    base.easeTo({ center, zoom, duration, easing: easeOut }, { ...move.tag, wwiwiwhStretch: move.stretch });
  }

  // --- Home on its own ---

  function startGesture(kind: 'slide' | 'turn', byHandle: boolean): void {
    endGesture();
    homeGesture = { kind, byHandle };
    stage.classList.add(GESTURE_CLASS[kind]);
    events.emit('gesture', { kind, phase: 'start', onMap: !byHandle });
  }

  function endGesture(): void {
    if (!homeGesture) return;
    const { kind, byHandle } = homeGesture;
    homeGesture = null;
    stage.classList.remove(GESTURE_CLASS[kind]);
    events.emit('gesture', { kind, phase: 'end', onMap: !byHandle });
    refreshHomeStyle();
  }

  function updatePanLock(): void {
    const locked = slideMode || homeHeld;
    if (locked === base.dragPan.isEnabled()) {
      if (locked) base.dragPan.disable();
      else base.dragPan.enable();
    }
  }

  const gestures = new HomeGestures({
    getRegistration: () => registration,
    setRegistration: applyRegistration,
    projectAway,
    unprojectAway,
    isSlideMode: () => slideMode,
    holdAway(held) {
      homeHeld = held;
      // Like any press on a map, taking hold of Home stops whatever Away was still doing.
      if (held) base.stop();
      updatePanLock();
    },
    gesture(kind, phase) {
      if (phase === 'start') startGesture(kind, false);
      else if (homeGesture && !homeGesture.byHandle) endGesture();
    },
    beforeNextFrame(callback) {
      const frame = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(frame);
    },
  });
  const unbindGestures = bindHomeGestures(base.getCanvasContainer(), gestures);

  base.on(
    'click',
    insideAway((event) => {
      clickClaimed = gestures.claimsClick();
      if (clickClaimed) return;
      const point = { x: event.point.x, y: event.point.y };
      const away = unprojectAway(point);
      events.emit('click', { point, away, home: baseToOverlay(registration, away) });
    }),
  );

  base.on('mousedown', () => {
    clickClaimed = false;
  });

  // A double click zooms only when its second click was the map's own: not one that put the pin
  // there, nor one a listener claimed for something drawn over the maps. That covers a first click
  // that put the pin there too, since the second then lands on the pin. (A press that moved too far
  // to be a click to MapLibre, but not to the browser, has not been asked about yet; it is here.)
  base.on('dblclick', (event) => {
    if (gestures.claimsClick() || clickClaimed) event.preventDefault();
  });

  // In slide mode a single finger is Home's alone. MapLibre must not read a double tap or a tap and
  // drag into it as well and zoom both maps under the slide. A second finger is left to it: a pinch
  // still zooms.
  base.on('touchstart', (event) => {
    if (slideMode && event.originalEvent.touches.length === 1) event.preventDefault();
  });

  watchSheet('away');
  watchSheet('home');

  // --- size ---

  base.on('webglcontextlost', () => {
    awayContextLost = true;
  });
  base.on('webglcontextrestored', () => {
    awayContextLost = false;
  });

  function resize(): void {
    if (destroyed) return;
    size = { width: stage.clientWidth, height: stage.clientHeight };
    home.resize();
    // MapLibre's public resize() also stops the map, which would end a pinch, a drag or a wheel zoom in
    // progress where it stands; this is the half of it that only resizes. A map without its WebGL
    // context has nothing to resize, and MapLibre does it itself when the context returns.
    if (!awayContextLost) base._resizeInternal();
    if (underWay) aimAgain(underWay);
    syncHome();
    // Resizing a canvas clears it, so Away is redrawn in this same frame too.
    redrawAway();
    events.emit('frame', undefined);
    // A different stage shows a different view. While Away is moving, the end of that movement says so.
    if (!isMoving()) events.emit('viewchange', { view: getView(), byUser: false });
  }

  const resizeObserver = new ResizeObserver(() => {
    if (stage.clientWidth !== size.width || stage.clientHeight !== size.height) resize();
  });
  resizeObserver.observe(stage);

  syncHome();

  return {
    base,
    overlay: home,

    getSize: () => size,

    getView,
    setView(view, moveOptions) {
      moveTo(() => view, moveOptions);
    },
    fit(points, fitOptions = {}) {
      const limits = {
        padding: toInsets(fitOptions.padding, DEFAULT_FIT_PADDING),
        minZoom: Math.max(ZOOM_RANGE.min, fitOptions.minZoom ?? ZOOM_RANGE.min),
        maxZoom: Math.min(ZOOM_RANGE.max, fitOptions.maxZoom ?? ZOOM_RANGE.max),
        zoomWhenPoint: base.getZoom(),
      };
      // Framed for the stage as it is when asked: a stage that changes on the way gets a framing of its own.
      moveTo(() => fitView(points, size, limits), { animate: fitOptions.animate, asUser: fitOptions.asUser });
    },
    zoomBy(delta, moveOptions) {
      const from = zoomTarget ?? base.getZoom();
      const zoom = clamp(from + delta, ZOOM_RANGE.min, ZOOM_RANGE.max);
      // Already at the limit: there is nowhere to go, so nothing moves and nothing is reported.
      if (zoom === from) return;
      if (moveOptions?.animate === false || reducedMotion.matches) {
        jump({ zoom }, moveTag(moveOptions));
        return;
      }
      base.easeTo({ zoom, duration: STEP_MS, easing: easeOut }, moveTag(moveOptions));
      zoomTarget = zoom;
    },
    panBy(dx, dy, moveOptions) {
      const animate = moveOptions?.animate !== false && !reducedMotion.matches;
      if (!animate && underWay) {
        // A move to somewhere is not cut short by a nudge: it goes on, to a destination nudged as much.
        const { aim } = underWay;
        underWay.aim = () => {
          const view = aim();
          return view && panView(view, dx, dy);
        };
        aimAgain(underWay);
        return;
      }
      base.panBy([dx, dy], animate ? { duration: STEP_MS, easing: easeOut } : { duration: 0 }, moveTag(moveOptions));
      if (!animate) redrawAway();
    },
    isMoving,

    getRegistration: () => registration,
    setRegistration(next, changeOptions) {
      const final = changeOptions?.final ?? true;
      if (!final && !homeGesture) {
        // A change that changes nothing moves nothing: the gesture starts with the first one that does.
        const kind = gestureKind(registration, next);
        if (kind) startGesture(kind, true);
      }
      try {
        applyRegistration(next, final);
      } finally {
        // Whatever went wrong on the way, a handle's last word ends its gesture.
        if (final && homeGesture?.byHandle) endGesture();
      }
    },
    claimClick() {
      clickClaimed = true;
      // A double tap is counted by MapLibre from touches, not from clicks: its count starts over.
      if (base.doubleClickZoom.isEnabled()) {
        base.doubleClickZoom.disable();
        base.doubleClickZoom.enable();
      }
    },

    setSlideMode(on) {
      if (on === slideMode) return;
      slideMode = on;
      // A slide or twist in progress ends where it is: its pointers no longer mean "Home".
      if (!on) gestures.finish();
      stage.classList.toggle('wwiwiwh-stage--slide', on);
      updatePanLock();
    },
    setHomeHidden(hidden) {
      stage.classList.toggle('wwiwiwh-stage--home-hidden', hidden);
    },
    setMeasureMode(on) {
      if (on === measureMode) return;
      measureMode = on;
      stage.classList.toggle('wwiwiwh-stage--measure', on);
      // Taps and clicks place trip ends while measuring, so two quick ones must not zoom as well.
      // (The one handler answers both the double click and the double tap.)
      if (on) base.doubleClickZoom.disable();
      else base.doubleClickZoom.enable();
    },
    passWheel(event) {
      // Handed to Away as a wheel turn of its own, so it zooms about the pointer exactly as it would
      // have had the handle not been in the way.
      base.getCanvasContainer().dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          cancelable: true,
        }),
      );
    },
    getHealth: () => recovery.getHealth(),
    retry: () => recovery.retry(),
    setDrawing(sheet, drawing) {
      const before = drawings[sheet];
      const changed = { route: drawing.route !== before.route, reach: drawing.reach !== before.reach };
      if (!changed.route && !changed.reach) return;
      drawings[sheet] = drawing;
      showDrawing(sheet, changed);
    },
    setStyles(next) {
      styles = next;
      homeStyleOffset = zoomOffset(registration);
      applyStyle('away', styles.base);
      applyStyle('home', styles.overlay(homeStyleOffset));
    },

    projectAway,
    projectHome: (position) => projectAway(overlayToBase(registration, position)),
    unprojectAway,
    unprojectHome: (point) => baseToOverlay(registration, unprojectAway(point)),

    metersPerPixel: (at) => metersPerPixel((at ?? base.getCenter()).lat, base.getZoom()),

    on: (type, listener) => events.on(type, listener),

    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      // Closes a slide or turn still in progress, so no pointer move of it is left waiting for a frame.
      gestures.finish();
      unbindGestures();
      wheelSteps.destroy();
      recovery.destroy();
      events.clear();
      home.remove();
      base.remove();
      stage.remove();
    },
  };
};
