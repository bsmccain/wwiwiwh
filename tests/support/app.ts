import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { Controller } from '../../src/app/controller';
import type { Store } from '../../src/app/store';
import type { AppState, Trip, View } from '../../src/app/types';
import { distanceMeters } from '../../src/geo/distance';
import type { LngLat } from '../../src/geo/types';
import type { DualMap, MapHealthState, ScreenPoint, Sheet } from '../../src/map/contracts';

/** The running app, as `src/main.ts` publishes it. */
interface RunningApp {
  readonly store: Store<AppState>;
  readonly dual: DualMap;
  readonly controller: Controller;
}

/** What the page keeps for the tests from the moment the app starts (see `watchApp`). */
interface AppWatch {
  /** How many times the map pair has said that the view is drawn. */
  idles: number;
  /** Every state of health the map pair has reported, in order. */
  readonly health: MapHealthState[];
  /** The running app. Throws while it has not started. */
  app(): RunningApp;
}

declare global {
  interface Window {
    __wwiwiwh?: RunningApp;
    /** Put there by `watchApp` before any script of the page runs. */
    __wwiwiwhWatch: AppWatch;
  }
}

/** The app's state together with what the map pair is showing. */
export interface Snapshot extends AppState {
  /** The Away camera as it stands. (`view` is null for as long as the view is the app's own choice.) */
  readonly camera: View;
  /** Where the pin is drawn, in stage pixels. */
  readonly pin: ScreenPoint;
  /** Where the trip's two ends are drawn, in stage pixels. */
  readonly tripEnds: readonly [ScreenPoint, ScreenPoint] | null;
  readonly stage: { readonly width: number; readonly height: number };
  readonly health: MapHealthState;
}

/** The trip of a snapshot, where its ends are drawn on the stage, and how long it is. Throws when there is none. */
export function tripOf({ trip, tripEnds }: Snapshot): {
  readonly trip: Trip;
  readonly ends: readonly [ScreenPoint, ScreenPoint];
  readonly meters: number;
} {
  if (!trip || !tripEnds) throw new Error('There is no trip.');
  return { trip, ends: tripEnds, meters: distanceMeters(trip.from, trip.to) };
}

export type Role = 'home' | 'away';
/** The rows of the pin menu, by the words each begins with. */
export type PinMenuRow =
  | 'Home spot'
  | 'Away spot'
  | 'Measure from the pin to an address'
  | 'Measure from the start to an address'
  | 'Put the pin at the centre of the view';
export type ToolName = 'Slide Home' | 'Measure' | 'Rings' | 'Hide Home';

/**
 * Runs in the page before the app does. The app publishes itself as `window.__wwiwiwh` at the end of
 * its start-up; catching that assignment is the one way to hear the map pair's events from the
 * very first one.
 */
function watchApp(): void {
  let running: RunningApp | undefined;
  const watch: AppWatch = {
    idles: 0,
    health: [],
    app() {
      if (!running) throw new Error('The app has not started.');
      return running;
    },
  };
  window.__wwiwiwhWatch = watch;
  Object.defineProperty(window, '__wwiwiwh', {
    configurable: true,
    get: () => running,
    set(started: RunningApp) {
      running = started;
      started.dual.on('idle', () => {
        watch.idles++;
      });
      started.dual.on('health', ({ state }) => {
        watch.health.push(state);
      });
    },
  });
}

/** Has every page of the context note the map pair's events from the start. */
export async function watchAppIn(context: BrowserContext): Promise<void> {
  await context.addInitScript(watchApp);
}

/** One page showing the app: how the tests open it, wait for it, read it and reach its controls. */
export class WwiwiwhApp {
  readonly caption: Locator;
  readonly captionBand: Locator;
  readonly toast: Locator;
  readonly statusNote: Locator;
  readonly picker: Locator;
  /** What a picker asks, and the line under it that says what a pick will do. */
  readonly pickerHeading: Locator;
  readonly pickerLine: Locator;
  readonly menu: Locator;
  /** The pin menu, while it is on the screen. (A picker opened from it stands in its place for a while.) */
  readonly pinMenu: Locator;
  readonly plaque: Locator;
  readonly ringLabels: Locator;
  readonly pinHandle: Locator;
  /** The element that carries the marks of a slide or a turn of Home in progress. */
  readonly mapStage: Locator;

  constructor(
    readonly page: Page,
    /** Fingers, not a mouse: controls are tapped. */
    readonly touch: boolean,
  ) {
    this.caption = page.locator('.caption__text');
    this.captionBand = page.locator('.caption');
    this.toast = page.locator('.toast');
    this.statusNote = page.locator('.stage__status');
    this.picker = page.locator('.picker');
    this.pickerHeading = this.picker.locator('.picker__title');
    this.pickerLine = this.picker.locator('.picker__line');
    this.menu = page.locator('.menu');
    this.pinMenu = page.getByRole('dialog', { name: 'The pin', exact: true });
    this.plaque = page.locator('.wwiwiwh-trip-plaque:not(.wwiwiwh-trip-plaque--draft)');
    this.ringLabels = page.locator('.wwiwiwh-ring-label');
    this.pinHandle = page.locator('.wwiwiwh-pin');
    this.mapStage = page.locator('.wwiwiwh-stage');
  }

  /** Opens the app, at a link when one is given, and waits for its first view to be drawn. */
  async open(hash = ''): Promise<void> {
    await this.goto(hash);
    await this.drawn();
  }

  /** Opens the app without waiting for a view to be drawn (for when none will be). */
  async goto(hash = ''): Promise<void> {
    await this.page.goto(hash ? `./#${hash}` : './');
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.drawn();
  }

  /**
   * Resolves once the map pair has announced a drawn view (`idle`) and is at rest now: nothing
   * moving, nothing loading, nothing failed.
   */
  async drawn(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const dual = window.__wwiwiwh?.dual;
        if (!dual || window.__wwiwiwhWatch.idles === 0) return false;
        return !dual.isMoving() && dual.base.loaded() && dual.overlay.loaded() && dual.getHealth().state === 'ok';
      },
      undefined,
      { timeout: 30_000 },
    );
  }

  /**
   * Resolves once nothing is moving and nothing is still loading, whether or not it loaded well: every
   * tile that was asked for has arrived or has failed.
   */
  async atRest(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const dual = window.__wwiwiwh?.dual;
        return !!dual && !dual.isMoving() && dual.base.loaded() && dual.overlay.loaded();
      },
      undefined,
      { timeout: 30_000 },
    );
  }

  async state(): Promise<Snapshot> {
    return this.page.evaluate(() => {
      const { store, dual } = window.__wwiwiwhWatch.app();
      const state = store.get();
      const registration = dual.getRegistration();
      return {
        ...state,
        camera: dual.getView(),
        pin: dual.projectAway(registration.baseAnchor),
        tripEnds: state.trip ? ([dual.projectHome(state.trip.from), dual.projectHome(state.trip.to)] as const) : null,
        stage: dual.getSize(),
        health: dual.getHealth().state,
      };
    });
  }

  /** How often the map pair has announced a drawn view, and every state of health it has reported, since the page loaded. */
  async heard(): Promise<{ idles: number; health: MapHealthState[] }> {
    return this.page.evaluate(() => ({ idles: window.__wwiwiwhWatch.idles, health: [...window.__wwiwiwhWatch.health] }));
  }

  /** The Home position drawn under a point of the page. */
  async homeUnder(pagePoint: ScreenPoint): Promise<LngLat> {
    const origin = await this.stageOrigin();
    return this.page.evaluate((at) => window.__wwiwiwhWatch.app().dual.unprojectHome(at), { x: pagePoint.x - origin.x, y: pagePoint.y - origin.y });
  }

  /** The part of the address that holds the shared view. */
  async hash(): Promise<string> {
    return this.page.evaluate(() => window.location.hash);
  }

  /** Where the stage's top-left corner is on the page. */
  async stageOrigin(): Promise<ScreenPoint> {
    const box = await this.page.locator('.stage__layer--maps').boundingBox();
    if (!box) throw new Error('The map layers are not on the page.');
    return { x: box.x, y: box.y };
  }

  /** Where a stage position is on the page. */
  async onPage(point: ScreenPoint): Promise<ScreenPoint> {
    const origin = await this.stageOrigin();
    return { x: origin.x + point.x, y: origin.y + point.y };
  }

  /** A position on the stage given as shares of its width and height, in stage pixels. */
  async stagePoint(acrossShare: number, downShare: number): Promise<ScreenPoint> {
    const { stage } = await this.state();
    return { x: Math.round(stage.width * acrossShare), y: Math.round(stage.height * downShare) };
  }

  /** The same, as a spot on the page: somewhere to press or to start a drag. */
  async stageSpot(acrossShare: number, downShare: number): Promise<ScreenPoint> {
    return this.onPage(await this.stagePoint(acrossShare, downShare));
  }

  /** Presses a control the way this device does: a tap of a finger, or a click of the mouse. */
  async press(control: Locator): Promise<void> {
    if (this.touch) await control.tap();
    else await control.click();
  }

  /** Presses a spot on the page (map positions have no element of their own to aim at). */
  async pressAt(point: ScreenPoint): Promise<void> {
    if (this.touch) await this.page.touchscreen.tap(point.x, point.y);
    else await this.page.mouse.click(point.x, point.y);
  }

  /** Where the pin is drawn, on the page. */
  async pinOnPage(): Promise<ScreenPoint> {
    return this.onPage((await this.state()).pin);
  }

  /**
   * Lets a handle (the pin, a trip end) that lies at `spot` on the page see a pointer clear of it, as
   * it does when someone goes to it: the mouse is brought up beside it, or a finger touches the map a
   * good way off. Until then a handle rests, and lets presses through to the map.
   */
  async comeTo(spot: ScreenPoint): Promise<void> {
    if (!this.touch) {
      await this.page.mouse.move(spot.x + 70, spot.y + 50);
      return;
    }
    const origin = await this.stageOrigin();
    const { stage } = await this.state();
    // The quarter of the stage that lies across from the handle, both ways.
    const acrossShare = spot.x - origin.x > stage.width / 2 ? 0.25 : 0.75;
    const downShare = spot.y - origin.y > stage.height / 2 ? 0.25 : 0.75;
    await this.page.touchscreen.tap(origin.x + stage.width * acrossShare, origin.y + stage.height * downShare);
  }

  /** Clicks or taps the pin where it is drawn, without dragging it. */
  async pressPin(): Promise<void> {
    await this.pressAt(await this.pinOnPage());
  }

  legendRow(role: Role): Locator {
    return this.page.locator(`.legend__row--${role}`);
  }

  legendName(role: Role): Locator {
    return this.legendRow(role).locator('.legend__name');
  }

  get swapButton(): Locator {
    return this.page.getByRole('button', { name: 'Swap', exact: true });
  }

  tool(name: ToolName): Locator {
    return this.page.locator('.tools').getByRole('button', { name, exact: true });
  }

  /** A button of slide mode's own row, which takes the place of the tools on narrow screens. */
  slideTool(name: string): Locator {
    return this.page.locator('.slide-tools').getByRole('button', { name, exact: true });
  }

  captionButton(name: string): Locator {
    return this.captionBand.getByRole('button', { name, exact: true });
  }

  /** One of the collar's two buttons that turn Home (wide screens). */
  turnButton(direction: 'left' | 'right'): Locator {
    return this.page.locator('.pin__controls').getByRole('button', { name: `Turn ${direction}`, exact: true });
  }

  /** The collar's Square up (wide screens). */
  get squareUpButton(): Locator {
    return this.page.locator('.pin__controls').getByRole('button', { name: 'Square up', exact: true });
  }

  /** The collar's line about the turn as it is shown; the same line is there again, worded for a screen reader. */
  get turnReadout(): Locator {
    return this.page.locator('.pin__readout [aria-hidden="true"]');
  }

  get turnReadoutSpoken(): Locator {
    return this.page.locator('.pin__readout .visually-hidden');
  }

  zoomButton(direction: 'in' | 'out'): Locator {
    return this.page.getByRole('button', { name: `Zoom ${direction}`, exact: true });
  }

  get moreButton(): Locator {
    return this.page.locator('.share__more');
  }

  /** One of the choices in the More menu, by the word on it. */
  menuChoice(word: string): Locator {
    return this.menu.getByRole('radio', { name: word, exact: true });
  }

  /** A row of the pin menu. The rows for the two spots go on to say which spot the pin holds now. */
  pinMenuRow(row: PinMenuRow): Locator {
    return this.pinMenu.getByRole('button', { name: new RegExp(`^${row}`) });
  }

  /** Opens the pin menu from the pin and chooses one of its rows. */
  async choosePinMenuRow(row: PinMenuRow): Promise<void> {
    await this.pressPin();
    await this.press(this.pinMenuRow(row));
  }

  /**
   * The pin sentence where this screen shows it: in the collar on wide screens, in the caption on
   * narrow ones (for as long as the caption has nothing more pressing to say, such as a trip).
   */
  get pinSentence(): Locator {
    return this.touch ? this.caption : this.page.locator('.pin__sentence');
  }

  /** One of the two spots the pin sentence names, which is a control: it opens the picker for that spot. */
  sentenceSpot(sheet: Sheet): Locator {
    return this.pinSentence.locator(`.spot-part--${sheet}`);
  }

  /** The one filled button. Its wording is longer where there is room. */
  get copyLinkButton(): Locator {
    return this.page.getByRole('button', { name: /^Copy link( to this view)?$/ });
  }

  /** The row of the open picker with this name; where a group is named, the row of that group. */
  pickerOption(placeName: string, inGroup?: string): Locator {
    const rows = inGroup === undefined ? this.picker : this.pickerGroup(inGroup);
    return rows.locator('.picker__option', { has: this.page.locator('.picker__name', { hasText: new RegExp(`^${placeName}$`) }) });
  }

  /** The name on the row of the open picker that lies over a spot of the page, or null when none does. */
  async pickerNameAt(pagePoint: ScreenPoint): Promise<string | null> {
    return this.page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('.picker__option')?.querySelector('.picker__name')?.textContent ?? null,
      pagePoint,
    );
  }

  /**
   * The rows and group labels of the open picker that are not in full sight, by what they say: cut
   * off by an edge of the list or of the screen, or covered by something else.
   */
  async pickerRowsOutOfSight(): Promise<string[]> {
    return this.picker.locator('.picker__group-label, .picker__option').evaluateAll((rows) =>
      rows
        .filter((row) => {
          const box = row.getBoundingClientRect();
          const middle = box.left + box.width / 2;
          const shows = (y: number): boolean => row.contains(document.elementFromPoint(middle, y));
          return !shows(box.top + 1) || !shows(box.bottom - 1);
        })
        .map((row) => (row.textContent ?? '').trim()),
    );
  }

  /** One of the labelled groups a picker lists its rows in. */
  pickerGroup(label: string): Locator {
    return this.picker.getByRole('group', { name: label, exact: true });
  }

  /** Closes the open picker without picking: by its Close button where it is a sheet, with Escape where it is a popover. */
  async closePicker(): Promise<void> {
    if (this.touch) await this.picker.getByRole('button', { name: 'Close', exact: true }).tap();
    else await this.page.keyboard.press('Escape');
  }

  /** Types into the open picker's field and chooses the row with this name from what the search finds. */
  async searchAndPick(query: string, name: string): Promise<void> {
    await this.picker.getByRole('combobox').fill(query);
    await this.press(this.pickerOption(name).first());
  }

  /** Opens the picker for a role and chooses the place with this name from what it lists. */
  async pickPlace(role: Role, placeName: string): Promise<void> {
    await this.press(this.legendRow(role));
    await this.press(this.pickerOption(placeName).first());
  }
}
