import { defaultTripFor } from '../data/trips';
import {
  baseToOverlay,
  overlayToBase,
  relativeScale,
  repin,
  rotateOverlay,
  swapRegistration,
  zoomOffset,
} from '../geo/registration';
import { distanceMeters } from '../geo/distance';
import { clamp, fromMercator, toMercator, wrapDeltaX } from '../geo/mercator';
import type { LngLat } from '../geo/types';
import type { Units } from '../geo/units';
import { NO_DRAWING, ZOOM_RANGE, type DualMap, type Sheet, type SheetDrawing, type StyleFactory } from '../map/contracts';
import { valhalla, type RoadService } from '../routing/valhalla';
import { NARROW_PX } from './breakpoints';
import { centeredRegistration, NO_SPOTS } from './defaults';
import { DEFAULT_MATCH, driveBetween, driveOnAway, onAway, otherSheet, startDrive } from './drive';
import { createDriveRunner } from './drive-runner';
import { savePrefs, type Prefs } from './prefs';
import type { Store } from './store';
import { nameAt, sameSpot, tidyName } from './spots';
import { resolveTheme } from './theme';
import type { AppState, Drive, DriveEnd, DriveMatch, LinkState, Place, ThemeChoice, Trip } from './types';
import { encodeLink } from './url';

/** Zoom used when a pair is framed automatically. Phones show less ground, so they start further out. */
export const FRAMING_ZOOM = { wide: 10.2, narrow: 9.4 } as const;
/** Stages narrower than this are treated as phones. */
export const NARROW_STAGE_PX = NARROW_PX;
/**
 * Pinning a named spot zooms in at least this far: the streets around an address are what there is
 * to compare, and this is the first zoom at which both maps letter their street names.
 */
export const SPOT_ZOOM = 14;
/** How close framing a measured line may zoom: a walk to the corner should fill the view, not the whole metro. */
export const LINE_ZOOM = 15;
/** A line shorter than this, in metres, is no line at all (its two ends were the same spot). */
const SHORTEST_LINE_METERS = 10;
/** Beyond this much disagreement in ground scale somewhere on screen, the comparison stops being fair. */
export const SCALE_DRIFT_LIMIT = 0.03;

export type ShareOutcome = 'copied' | 'shared' | 'cancelled' | 'failed';

export interface ControllerDeps {
  readonly store: Store<AppState>;
  readonly dual: DualMap;
  readonly styles: StyleFactory;
  /** Reports the system colour scheme and notifies when it changes. */
  readonly systemTheme: { prefersDark(): boolean; onChange(listener: () => void): () => void };
  /** Where the theme is applied to the page (sets data-theme on the root element). */
  readonly applyTheme: (theme: 'light' | 'dark') => void;
  /** The address the page is served from, without a hash. */
  readonly pageUrl: () => string;
  /** Where the viewer's preferences are kept. Defaults to this browser's local storage. */
  readonly savePrefs?: (prefs: Prefs) => void;
  /** Where driving routes are asked for. Defaults to the public routing server. */
  readonly roads?: RoadService;
}

/** A spot chosen by address or landmark. A null name means "no name of its own" (the place's centre, say). */
export interface PickedSpot {
  readonly name: string | null;
  readonly position: LngLat;
}

/** Everything the interface can ask the app to do. Each method is one user-visible action. */
export interface Controller {
  pickPlace(role: 'home' | 'away', place: Place): void;
  /**
   * Sets one end of the pin by position. On Home, that spot is brought under the pin (the Away spot
   * stays). On Away, the pin and the Home spot it holds move there. The turn is kept, and the view
   * centres on the pin, zoomed in to street scale for a named spot unless it is closer already.
   */
  pinSpot(sheet: Sheet, spot: PickedSpot): void;
  /**
   * Draws the trip to a spot on Home or on Away and frames it: from the start already placed while
   * measuring, otherwise from the pin. Returns false, drawing nothing, when the spot is where the
   * line would start.
   */
  measureTo(sheet: Sheet, spot: PickedSpot): boolean;
  swap(): void;
  /** Pin centre on centre again, undo any turn, and reframe. */
  lineUpAgain(): void;
  toggleSlide(): void;
  toggleMeasure(): void;
  /** Starts or stops setting a drive: the next two presses on the map put down its start and its end. */
  toggleDrive(): void;
  /** While a drive is being set: which place it is driven on. A start already put down on the other is taken up again. */
  setDriveSide(sheet: Sheet): void;
  /**
   * Sets the next end of a drive by address: its start, on whichever place the spot was found in,
   * and then its end, which must be on that same place. The finished drive takes the place of any
   * trip and is framed if an end is out of sight. Returns false, changing nothing, when the spot
   * cannot be that end (it is on the other place, or it is where the drive starts).
   */
  driveEnd(sheet: Sheet, spot: PickedSpot): boolean;
  /** Turns the trip into a drive on Home between the same two ends. */
  driveTheTrip(): void;
  /** What the drive's reach on the other place is matched to. */
  setDriveMatch(match: DriveMatch): void;
  clearDrive(): void;
  /** Asks the road service again for whatever it failed to answer. */
  retryDrive(): void;
  /** Leave slide, measure or drive mode (Escape). Returns whether anything was cancelled. */
  cancel(): boolean;
  clearTrip(): void;
  toggleRings(): void;
  setHomeHidden(hidden: boolean): void;
  turnBy(degrees: number): void;
  squareUp(): void;
  /** Slide Home by a number of screen pixels. */
  slideBy(dx: number, dy: number): void;
  /** Move the pin to the middle of the view without moving either map. */
  pinAtCenter(): void;
  zoomBy(delta: number): void;
  panBy(dx: number, dy: number): void;
  setUnits(units: Units): void;
  toggleUnits(): void;
  setThemeChoice(choice: ThemeChoice): void;
  /** Shade in the land and water of Home or of Away; the other place is drawn as streets only. */
  setGround(ground: Sheet): void;
  toggleGround(): void;
  /** Turn the single-letter keyboard shortcuts on or off. */
  setShortcutsOn(on: boolean): void;
  /** The one-time hint about sliding Home is no longer needed. */
  finishSlideHint(): void;
  /**
   * Frame the pin and the trip or drive, with the pin in the middle. `maxZoom` lets a short trip be framed
   * closer than a pair of places is; `asUser` makes the framing the person's own view, kept in the link.
   */
  frame(options?: { animate?: boolean; maxZoom?: number; asUser?: boolean }): void;
  /** Replace everything shareable at once (opening a link, going back in history). */
  applyLink(state: LinkState): void;
  /** A link that reopens exactly what is on screen now. */
  currentLink(): string;
  shareLink(): Promise<ShareOutcome>;
  /** The largest disagreement in ground scale between the two maps anywhere on screen (0.01 = 1%). */
  scaleDrift(): number;
  /** Whether the pin is inside the stage right now. */
  pinIsOnStage(): boolean;
  destroy(): void;
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/**
 * What each sheet shows of the drive: the road it takes on the place it is driven on, and on the
 * other place the area the same driving reaches.
 */
function drawingsOf({ drive, route, reach }: Pick<AppState, 'drive' | 'route' | 'reach'>): Record<Sheet, SheetDrawing> {
  if (!drive) return { home: NO_DRAWING, away: NO_DRAWING };
  const road: SheetDrawing = { route: route?.status === 'found' ? route.route.line : null, reach: null };
  const area: SheetDrawing = { route: null, reach: reach?.status === 'found' ? reach.outline : null };
  return drive.on === 'home' ? { home: road, away: area } : { home: area, away: road };
}

export function createController(deps: ControllerDeps): Controller {
  const { store, dual } = deps;
  const cleanups: (() => void)[] = [];

  // --- keep the map pair in step with the session state ---
  cleanups.push(
    store.select((s) => s.mode, (mode) => {
      dual.setSlideMode(mode === 'slide');
      // Setting a drive takes presses on the map exactly as measuring does.
      dual.setMeasureMode(mode === 'measure' || mode === 'drive');
    }),
    store.subscribe((state, previous) => {
      if (state.drive === previous.drive && state.route === previous.route && state.reach === previous.reach) return;
      const drawings = drawingsOf(state);
      dual.setDrawing('home', drawings.home);
      dual.setDrawing('away', drawings.away);
    }),
    store.select((s) => s.homeHidden, (hidden) => dual.setHomeHidden(hidden)),
    store.subscribe((state, previous) => {
      if (state.theme === previous.theme && state.ground === previous.ground) return;
      if (state.theme !== previous.theme) deps.applyTheme(state.theme);
      dual.setStyles(deps.styles(state.theme, state.ground));
    }),
    deps.systemTheme.onChange(() => {
      store.set((s) => ({ theme: resolveTheme(s.themeChoice, deps.systemTheme.prefersDark()) }));
    }),
    // --- mirror what the person does on the map back into the state ---
    dual.on('registrationchange', ({ registration }) => store.set({ reg: registration })),
    dual.on('viewchange', ({ view, byUser }) => {
      // Only a view the person chose is worth remembering; automatic framing stays automatic.
      if (byUser) store.set({ view: { center: view.center, zoom: roundTo(view.zoom, 2) } });
    }),
    // --- the viewer's own settings outlive the visit ---
    store.subscribe((s, previous) => {
      if (
        s.units === previous.units &&
        s.themeChoice === previous.themeChoice &&
        s.ground === previous.ground &&
        s.shortcutsOn === previous.shortcutsOn &&
        s.slideHintDone === previous.slideHintDone
      ) {
        return;
      }
      (deps.savePrefs ?? savePrefs)({
        units: s.units,
        themeChoice: s.themeChoice,
        ground: s.ground,
        shortcutsOn: s.shortcutsOn,
        slideHintDone: s.slideHintDone,
      });
    }),
  );

  const runner = createDriveRunner({ store, dual, roads: deps.roads ?? valhalla });
  cleanups.push(() => runner.destroy());
  // A drive that came with the link is already there, and may already have been answered from memory.
  const firstDrawings = drawingsOf(store.get());
  dual.setDrawing('home', firstDrawings.home);
  dual.setDrawing('away', firstDrawings.away);

  const isNarrow = () => dual.getSize().width < NARROW_STAGE_PX;

  /** The same line after Home and Away trade places: `before` is the state being swapped out of. */
  function swapTrip(trip: Trip, before: AppState): Trip {
    const reg = dual.getRegistration();
    const landedFrom = overlayToBase(reg, trip.from);
    const landedTo = overlayToBase(reg, trip.to);
    // On the new Home (the old Away) an end is known by the Away spot it lay on: one it was aimed
    // at, or the pin's.
    const pinned = nameAt(before.spots.away, reg.baseAnchor);
    const nameOnAway = (landed: LngLat, landing: Trip['toLanding']): string | null =>
      nameAt(landing, landed) ?? (sameSpot(landed, reg.baseAnchor) ? pinned : null);
    const fromName = nameOnAway(landedFrom, trip.fromLanding);
    const toName = nameOnAway(landedTo, trip.toLanding);
    return {
      from: landedFrom,
      to: landedTo,
      ...(fromName ? { fromName } : {}),
      ...(toName ? { toName } : {}),
      // And where each end lands on the new Away (the old Home) is that end's old name there.
      ...(trip.fromName ? { fromLanding: { name: trip.fromName, at: trip.from } } : {}),
      ...(trip.toName ? { toLanding: { name: trip.toName, at: trip.to } } : {}),
    };
  }

  /** Whether an Away position is on the stage, with a little room around it. */
  function isInSight(position: LngLat): boolean {
    const margin = 24;
    const { width, height } = dual.getSize();
    const at = dual.projectAway(position);
    return at.x >= margin && at.x <= width - margin && at.y >= margin && at.y <= height - margin;
  }

  function tripOnAway(trip: Trip | null): LngLat[] {
    if (!trip) return [];
    const reg = dual.getRegistration();
    return [overlayToBase(reg, trip.from), overlayToBase(reg, trip.to)];
  }

  /** Brings the given Away positions into view, at the zoom a line is looked at, unless they are all in sight already. */
  function showOnAway(points: readonly LngLat[]): void {
    if (points.every(isInSight)) return;
    dual.fit(points, { padding: isNarrow() ? 48 : 96, maxZoom: LINE_ZOOM, minZoom: 6, asUser: true });
  }

  const controller: Controller = {
    pickPlace(role, place) {
      const s = store.get();
      const home = role === 'home' ? place : s.home;
      const away = role === 'away' ? place : s.away;
      const reg = centeredRegistration(home, away);
      // A drive runs on one place's roads, so it only survives when that place stays the same.
      const drive = s.drive && s.drive.on !== role ? s.drive : null;
      // A trip is drawn on Home, so it only survives when Home stays the same. A drive that stays is
      // the one journey on the map: the new Home's own trip does not come with it.
      const trip = drive ? null : role === 'home' ? defaultTripFor(place) : s.trip;
      // One announcement for the whole change, so nothing ever sees the new pin with the old places.
      store.transaction(() => {
        dual.setRegistration(reg);
        store.set({ home, away, reg, spots: NO_SPOTS, trip, drive, tripDraft: null, driveDraft: null, mode: 'browse', view: null });
      });
      controller.frame();
    },

    pinSpot(sheet, spot) {
      const s = store.get();
      const reg = dual.getRegistration();
      const next = sheet === 'home' ? { ...reg, overlayAnchor: spot.position } : { ...reg, baseAnchor: spot.position };
      const named = spot.name ? { name: tidyName(spot.name), at: spot.position } : null;
      store.transaction(() => {
        // The name first: whatever redraws when the pin moves should already know what it is called.
        store.set({ reg: next, spots: { ...s.spots, [sheet]: named }, mode: 'browse', tripDraft: null, driveDraft: null });
        dual.setRegistration(next);
      });
      // Their own choice of where to look, so it is remembered like any move they make. An address
      // is looked at from close up; the centre of a place is not an address.
      const zoom = dual.getView().zoom;
      dual.setView({ center: next.baseAnchor, zoom: named ? Math.max(zoom, SPOT_ZOOM) : zoom }, { asUser: true });
    },

    measureTo(sheet, spot) {
      const s = store.get();
      const reg = dual.getRegistration();
      // A start already clicked while measuring is kept; without one the line starts at the pin.
      const from = s.tripDraft ?? reg.overlayAnchor;
      const to = sheet === 'home' ? spot.position : baseToOverlay(reg, spot.position);
      if (distanceMeters(from, to) < SHORTEST_LINE_METERS) return false;
      const name = spot.name ? tidyName(spot.name) : null;
      const fromName = sameSpot(from, reg.overlayAnchor) ? nameAt(s.spots.home, reg.overlayAnchor) : null;
      const trip: Trip = {
        from,
        to,
        ...(fromName ? { fromName } : {}),
        ...(sheet === 'home' && name ? { toName: name } : {}),
        ...(sheet === 'away' && name ? { toLanding: { name, at: spot.position } } : {}),
      };
      // The line takes the place of any drive: there is one journey on the map at a time.
      store.set({ trip, drive: null, tripDraft: null, driveDraft: null, mode: 'browse' });
      // The view that shows the line is part of what they asked for, so it is theirs: the address
      // bar must reopen it, not the metro view.
      if (sameSpot(from, reg.overlayAnchor)) {
        controller.frame({ maxZoom: LINE_ZOOM, asUser: true });
      } else {
        // A line drawn from a start they clicked is looked at where they already are. Only if an
        // end is out of sight is the line itself framed; the pin has no part in it.
        showOnAway([overlayToBase(reg, from), overlayToBase(reg, to)]);
      }
      return true;
    },

    swap() {
      const s = store.get();
      const reg = dual.getRegistration();
      const view = dual.getView();
      // The new Away camera looks at whatever Home ground is in the middle of the screen now.
      const next = swapRegistration(reg);
      const center = baseToOverlay(reg, view.center);
      // At the ends of the zoom range the picture cannot keep its size; it stays as close as allowed.
      const zoom = clamp(view.zoom + zoomOffset(reg), ZOOM_RANGE.min, ZOOM_RANGE.max);
      // The trip stays where it is drawn: its ends become positions on the new Home (the old Away),
      // and whatever names were known for one side of an end now belong to the other.
      const trip: Trip | null = s.trip ? swapTrip(s.trip, s) : null;
      // A drive stays on its own roads: the place it is driven on is simply the other sheet now.
      const drive: Drive | null = s.drive ? { ...s.drive, on: otherSheet(s.drive.on) } : null;
      store.transaction(() => {
        dual.setRegistration(next);
        dual.setView({ center, zoom }, { animate: false });
        store.set({
          home: s.away,
          away: s.home,
          reg: next,
          spots: { home: s.spots.away, away: s.spots.home },
          trip,
          drive,
          driveSide: otherSheet(s.driveSide),
          tripDraft: null,
          driveDraft: null,
          mode: 'browse',
          view: { center, zoom: roundTo(zoom, 2) },
        });
      });
    },

    lineUpAgain() {
      const s = store.get();
      const reg = centeredRegistration(s.home, s.away);
      store.transaction(() => {
        dual.setRegistration(reg);
        store.set({ reg, spots: NO_SPOTS, view: null, mode: 'browse', tripDraft: null, driveDraft: null });
      });
      controller.frame();
    },

    toggleSlide() {
      store.set((s) => ({ mode: s.mode === 'slide' ? 'browse' : 'slide', tripDraft: null, driveDraft: null }));
    },

    toggleMeasure() {
      store.set((s) => ({ mode: s.mode === 'measure' ? 'browse' : 'measure', tripDraft: null, driveDraft: null }));
    },

    toggleDrive() {
      store.set((s) => ({
        mode: s.mode === 'drive' ? 'browse' : 'drive',
        // Another drive is most likely on the place the last one was on.
        driveSide: s.drive?.on ?? s.driveSide,
        tripDraft: null,
        driveDraft: null,
      }));
    },

    setDriveSide(sheet) {
      if (store.get().driveSide !== sheet) store.set({ driveSide: sheet, driveDraft: null });
    },

    driveEnd(sheet, spot) {
      const s = store.get();
      const reg = dual.getRegistration();
      const name = spot.name ? tidyName(spot.name) : '';
      const end: DriveEnd = { at: spot.position, ...(name ? { name } : {}) };
      if (!s.driveDraft) {
        // The start says which place the drive is on; its end is then looked for there.
        store.set({ mode: 'drive', driveSide: sheet, driveDraft: end, tripDraft: null });
        // The start is shown where they already are, unless it is out of sight.
        const at = onAway(reg, sheet, end.at);
        if (!isInSight(at)) dual.setView({ center: at, zoom: dual.getView().zoom }, { asUser: true });
        return true;
      }
      if (sheet !== s.driveSide) return false;
      const drive = driveBetween(sheet, s.driveDraft, end, s.drive?.match ?? DEFAULT_MATCH);
      if (!drive) return false;
      store.set(startDrive(drive));
      showOnAway(driveOnAway(drive, reg));
      return true;
    },

    driveTheTrip() {
      const s = store.get();
      if (!s.trip) return;
      const reg = dual.getRegistration();
      // An end that sits on the pin goes by the pin's name, as it does in the trip's own sentence.
      const nameOf = (at: LngLat, known: string | undefined): string | null =>
        known ?? (sameSpot(at, reg.overlayAnchor) ? nameAt(s.spots.home, reg.overlayAnchor) : null);
      const end = (at: LngLat, known: string | undefined): DriveEnd => {
        const name = nameOf(at, known);
        return { at, ...(name ? { name } : {}) };
      };
      const drive = driveBetween('home', end(s.trip.from, s.trip.fromName), end(s.trip.to, s.trip.toName), s.drive?.match ?? DEFAULT_MATCH);
      if (drive) store.set(startDrive(drive));
    },

    setDriveMatch(match) {
      const { drive } = store.get();
      if (drive && drive.match !== match) store.set({ drive: { ...drive, match } });
    },

    clearDrive() {
      store.set({ drive: null, driveDraft: null });
    },

    retryDrive() {
      runner.retry();
    },

    cancel() {
      const s = store.get();
      if (s.mode === 'browse') return false;
      store.set({ mode: 'browse', tripDraft: null, driveDraft: null });
      return true;
    },

    clearTrip() {
      store.set({ trip: null, tripDraft: null });
    },

    toggleRings() {
      store.set((s) => ({ rings: !s.rings }));
    },

    setHomeHidden(hidden) {
      store.set({ homeHidden: hidden });
    },

    turnBy(degrees) {
      dual.setRegistration(rotateOverlay(dual.getRegistration(), degrees));
    },

    squareUp() {
      const reg = dual.getRegistration();
      if (reg.rotation !== 0) dual.setRegistration({ ...reg, rotation: 0 });
    },

    slideBy(dx, dy) {
      const reg = dual.getRegistration();
      const pin = dual.projectAway(reg.baseAnchor);
      dual.setRegistration({ ...reg, baseAnchor: dual.unprojectAway({ x: pin.x + dx, y: pin.y + dy }) });
    },

    pinAtCenter() {
      const { width, height } = dual.getSize();
      const at = dual.unprojectAway({ x: width / 2, y: height / 2 });
      dual.setRegistration(repin(dual.getRegistration(), at));
    },

    // Zoom buttons and keys are the person's own moves: the view they lead to is worth remembering.
    zoomBy(delta) {
      dual.zoomBy(delta, { asUser: true });
    },

    panBy(dx, dy) {
      dual.panBy(dx, dy, { asUser: true });
    },

    setUnits(units) {
      store.set({ units });
    },

    toggleUnits() {
      controller.setUnits(store.get().units === 'mi' ? 'km' : 'mi');
    },

    setThemeChoice(choice) {
      store.set({ themeChoice: choice, theme: resolveTheme(choice, deps.systemTheme.prefersDark()) });
    },

    setGround(ground) {
      store.set({ ground });
    },

    toggleGround() {
      controller.setGround(store.get().ground === 'away' ? 'home' : 'away');
    },

    setShortcutsOn(on) {
      store.set({ shortcutsOn: on });
    },

    finishSlideHint() {
      store.set({ slideHintDone: true });
    },

    frame(options) {
      const reg = dual.getRegistration();
      // The pin is the middle of everything (rings, the turn, exact scale), so it goes in the middle
      // of the view: each trip end is framed together with its mirror image through the pin.
      const pin = toMercator(reg.baseAnchor);
      const points: LngLat[] = [reg.baseAnchor];
      const { trip, drive } = store.get();
      for (const end of [...tripOnAway(trip), ...driveOnAway(drive, reg)]) {
        const m = toMercator(end);
        const dx = wrapDeltaX(m.x - pin.x);
        const dy = m.y - pin.y;
        points.push(fromMercator({ x: pin.x + dx, y: pin.y + dy }), fromMercator({ x: pin.x - dx, y: pin.y - dy }));
      }
      const narrow = isNarrow();
      dual.fit(points, {
        padding: narrow ? 28 : 72,
        maxZoom: options?.maxZoom ?? (narrow ? FRAMING_ZOOM.narrow : FRAMING_ZOOM.wide),
        minZoom: 6,
        animate: options?.animate,
        asUser: options?.asUser,
      });
    },

    applyLink(state) {
      store.transaction(() => {
        dual.setRegistration(state.reg);
        store.set({ ...state, mode: 'browse', tripDraft: null, driveDraft: null, driveSide: state.drive?.on ?? store.get().driveSide });
      });
      if (state.view) dual.setView(state.view, { animate: false });
      else controller.frame({ animate: false });
    },

    currentLink() {
      const s = store.get();
      const view = dual.getView();
      const link: LinkState = {
        home: s.home,
        away: s.away,
        reg: dual.getRegistration(),
        spots: s.spots,
        view: { center: view.center, zoom: roundTo(view.zoom, 2) },
        trip: s.trip,
        drive: s.drive,
        rings: s.rings,
      };
      return `${deps.pageUrl()}#${encodeLink(link)}`;
    },

    async shareLink() {
      const url = controller.currentLink();
      const s = store.get();
      const title = `${s.home.name} over ${s.away.name} at the same scale`;
      const nav = globalThis.navigator;
      // The system share sheet is the natural place on phones; desktops copy.
      if (isNarrow() && typeof nav?.share === 'function') {
        try {
          await nav.share({ title, url });
          return 'shared';
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
          // Fall through to copying.
        }
      }
      try {
        await nav.clipboard.writeText(url);
        return 'copied';
      } catch {
        return 'failed';
      }
    },

    scaleDrift() {
      const reg = dual.getRegistration();
      const { width, height } = dual.getSize();
      let worst = 0;
      for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]] as const) {
        const at = dual.unprojectAway({ x: width * fx, y: height * fy });
        worst = Math.max(worst, Math.abs(relativeScale(reg, at) - 1));
      }
      return worst;
    },

    pinIsOnStage() {
      const { width, height } = dual.getSize();
      const pin = dual.projectAway(dual.getRegistration().baseAnchor);
      return pin.x >= 0 && pin.x <= width && pin.y >= 0 && pin.y <= height;
    },

    destroy() {
      for (const cleanup of cleanups) cleanup();
    },
  };

  return controller;
}
