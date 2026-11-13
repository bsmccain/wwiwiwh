import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { distanceMeters } from '../geo/distance';
import { baseToOverlay, overlayToBase } from '../geo/registration';
import { spansToText } from './readout';
import { pinSpans, tripSpans } from '../ui/sentences';
import { NO_DRAWING, type MapStyles } from '../map/contracts';
import type { RoadService } from '../routing/valhalla';
import { createController, FRAMING_ZOOM, LINE_ZOOM, SPOT_ZOOM, type Controller } from './controller';
import type { Prefs } from './prefs';
import { centeredRegistration, defaultLinkState, presetPlace } from './defaults';
import { createLinkSync, type AddressBar } from './link-sync';
import { createStore, type Store } from './store';
import { FakeDualMap } from './testing/fake-dual';
import type { AppState, Drive, Place } from './types';
import { decodeLink } from './url';

const tokyo = presetPlace('tokyo') as Place;
const paris = presetPlace('paris') as Place;
const berlin = presetPlace('berlin') as Place;

/** A road service that is asked and never answers, so that no test here leans on the public server. */
function silentRoads(): { roads: RoadService; asked: string[] } {
  const asked: string[] = [];
  const never = <A>(what: string): Promise<A> => {
    asked.push(what);
    return new Promise<A>(() => undefined);
  };
  return { roads: { route: () => never('route'), reach: () => never('reach') }, asked };
}

function setup() {
  const link = defaultLinkState();
  const store: Store<AppState> = createStore<AppState>({
    ...link,
    mode: 'browse',
    tripDraft: null,
    driveSide: 'home',
    driveDraft: null,
    route: null,
    reach: null,
    homeHidden: false,
    units: 'mi',
    themeChoice: 'auto',
    theme: 'light',
    shortcutsOn: true,
    slideHintDone: false,
  });
  const dual = new FakeDualMap({ center: link.away.center, zoom: 10 }, link.reg);
  let prefersDark = false;
  const themeListeners = new Set<() => void>();
  const applied: string[] = [];
  const saved: Prefs[] = [];
  const roads = silentRoads();
  const fakeStyles = { base: {}, overlay: () => ({}), drawing: () => [] } as unknown as MapStyles;
  const controller = createController({
    store,
    dual,
    styles: () => fakeStyles,
    systemTheme: {
      prefersDark: () => prefersDark,
      onChange(listener) {
        themeListeners.add(listener);
        return () => themeListeners.delete(listener);
      },
    },
    applyTheme: (theme) => applied.push(theme),
    pageUrl: () => 'https://example.test/wwiwiwh/',
    savePrefs: (prefs) => saved.push(prefs),
    roads: roads.roads,
  });
  const setSystemDark = (dark: boolean) => {
    prefersDark = dark;
    for (const listener of themeListeners) listener();
  };
  return { store, dual, controller, applied, saved, setSystemDark, roadsAsked: roads.asked };
}

describe('controller', () => {
  it('picking a new Away pins centre on centre, keeps the trip and reframes', () => {
    const { store, dual, controller } = setup();
    const trip = store.get().trip;
    controller.turnBy(30);
    controller.pickPlace('away', tokyo);
    const s = store.get();
    expect(s.away).toBe(tokyo);
    expect(s.reg).toEqual(centeredRegistration(s.home, tokyo));
    expect(dual.getRegistration()).toEqual(s.reg);
    expect(s.trip).toBe(trip);
    expect(s.view).toBeNull();
    expect(dual.calls).toContain('fit');
    expect(dual.getView().zoom).toBe(FRAMING_ZOOM.wide);
  });

  it('picking a new Home swaps in that place’s own trip, or none', () => {
    const { store, controller } = setup();
    controller.pickPlace('home', berlin);
    expect(store.get().trip).toBeNull();
    controller.pickPlace('home', tokyo);
    expect(store.get().trip?.fromName).toBe('Yokohama');
    controller.pickPlace('home', presetPlace('san-jose') as Place);
    expect(store.get().trip?.fromName).toBe('Palo Alto');
  });

  it('frames further out on a narrow stage', () => {
    const { dual, controller } = setup();
    dual.size = { width: 390, height: 640 };
    controller.frame();
    expect(dual.getView().zoom).toBe(FRAMING_ZOOM.narrow);
  });

  it('frames with the pin in the middle, whichever way the trip runs', () => {
    const { store, dual, controller } = setup();
    controller.frame();
    expect(distanceMeters(dual.getView().center, dual.getRegistration().baseAnchor)).toBeLessThan(50);
    controller.slideBy(250, -90);
    controller.turnBy(40);
    controller.frame();
    expect(distanceMeters(dual.getView().center, dual.getRegistration().baseAnchor)).toBeLessThan(50);
    store.set({ trip: null });
    controller.frame();
    expect(distanceMeters(dual.getView().center, dual.getRegistration().baseAnchor)).toBeLessThan(0.01);
  });

  it('tells listeners about a place change once, never half-way', () => {
    const { store, dual, controller } = setup();
    const seen: string[] = [];
    store.subscribe((s) => {
      // Whenever anything hears of a change, the pin already belongs to the places on show.
      expect(dual.getRegistration().baseAnchor).toEqual(s.reg.baseAnchor);
      seen.push(`${s.home.name} over ${s.away.name}`);
    });
    controller.pickPlace('away', tokyo);
    expect(seen).toEqual(['San Jose over Tokyo']);
    controller.swap();
    expect(seen).toEqual(['San Jose over Tokyo', 'Tokyo over San Jose']);
  });

  it('keeps the swapped view inside the zoom range', () => {
    const { store, dual, controller } = setup();
    controller.pickPlace('home', presetPlace('singapore') as Place);
    controller.pickPlace('away', presetPlace('oslo') as Place);
    dual.userMoves({ center: dual.getView().center, zoom: 17.8 });
    controller.swap();
    expect(dual.getView().zoom).toBe(18);
    expect(store.get().view?.zoom).toBe(18);
  });

  it('remembers a view reached with the zoom buttons or keys', () => {
    const { store, controller } = setup();
    expect(store.get().view).toBeNull();
    controller.zoomBy(1);
    expect(store.get().view?.zoom).toBe(11);
    controller.panBy(100, 0);
    expect(store.get().view?.center.lng).toBeGreaterThan(-0.1276);
  });

  it('saves the viewer’s settings when they change, and only then', () => {
    const { controller, saved } = setup();
    controller.turnBy(5);
    controller.toggleRings();
    expect(saved).toEqual([]);
    controller.toggleUnits();
    controller.setThemeChoice('dark');
    controller.setShortcutsOn(false);
    controller.finishSlideHint();
    controller.finishSlideHint();
    expect(saved).toEqual([
      { units: 'km', themeChoice: 'auto', shortcutsOn: true, slideHintDone: false },
      { units: 'km', themeChoice: 'dark', shortcutsOn: true, slideHintDone: false },
      { units: 'km', themeChoice: 'dark', shortcutsOn: false, slideHintDone: false },
      { units: 'km', themeChoice: 'dark', shortcutsOn: false, slideHintDone: true },
    ]);
  });

  describe('the pin by address', () => {
    const infiniteLoop = { name: 'One Infinite Loop', position: { lat: 37.3318, lng: -122.0312 } };
    const downingStreet = { name: '10 Downing Street', position: { lat: 51.5034, lng: -0.1276 } };
    const nothingNear = () => null;
    /** A plate that calls every spot it is asked about "Somewhere". */
    const somewhere = () => ({ name: 'Somewhere', distanceMeters: 100, bearingDeg: 0 });
    const scene = (store: Store<AppState>, dual: FakeDualMap) => {
      const { home, away, spots, trip, units } = store.get();
      return { home, away, spots, trip, units, registration: dual.getRegistration() };
    };

    it('brings a spot of Home under the pin, keeping the Away spot and the turn', () => {
      const { store, dual, controller } = setup();
      controller.turnBy(20);
      const awayBefore = dual.getRegistration().baseAnchor;
      controller.pinSpot('home', infiniteLoop);
      const reg = dual.getRegistration();
      expect(reg.overlayAnchor).toEqual(infiniteLoop.position);
      expect(reg.baseAnchor).toEqual(awayBefore);
      expect(reg.rotation).toBe(20);
      expect(store.get().spots.home).toEqual({ name: 'One Infinite Loop', at: infiniteLoop.position });
      // Both maps centre on the pin, close enough to see its streets, and the view is remembered.
      expect(distanceMeters(dual.getView().center, awayBefore)).toBeLessThan(0.01);
      expect(store.get().view?.zoom).toBe(SPOT_ZOOM);
    });

    it('keeps a closer zoom when pinning an address, and any zoom when pinning a centre', () => {
      const { store, dual, controller } = setup();
      dual.userMoves({ center: dual.getView().center, zoom: 15.5 });
      controller.pinSpot('away', downingStreet);
      expect(dual.getView().zoom).toBe(15.5);
      dual.userMoves({ center: dual.getView().center, zoom: 9 });
      controller.pinSpot('home', { name: null, position: store.get().home.center });
      expect(dual.getView().zoom).toBe(9);
    });

    it('moves the pin to a spot of Away, bringing the Home spot along', () => {
      const { store, dual, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      const reg = dual.getRegistration();
      expect(reg.overlayAnchor).toEqual(infiniteLoop.position);
      expect(reg.baseAnchor).toEqual(downingStreet.position);
      expect(distanceMeters(dual.getView().center, downingStreet.position)).toBeLessThan(0.01);
      const spans = pinSpans(scene(store, dual), nothingNear);
      expect(spans && spansToText(spans)).toBe('One Infinite Loop sits on 10 Downing Street.');
    });

    it('keeps a spot’s name only while the pin is still on it', () => {
      const { store, dual, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      // Sliding Home by its pin keeps the Home spot under the pin and takes it off the Away spot.
      controller.slideBy(300, 0);
      const spans = pinSpans(scene(store, dual), () => ({ name: 'Bow', distanceMeters: 300, bearingDeg: 0 }));
      expect(spans && spansToText(spans)).toBe('One Infinite Loop sits on Bow.');
      // Putting the pin somewhere else on Home leaves neither name standing.
      controller.pinAtCenter();
      expect(pinSpans(scene(store, dual), nothingNear)).toBeNull();
    });

    it('a spot with no name of its own clears the old name', () => {
      const { store, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('home', { name: null, position: store.get().home.center });
      expect(store.get().spots.home).toBeNull();
    });

    it('forgets the names when a place changes or the pair is lined up again, and swaps them on Swap', () => {
      const { store, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      controller.swap();
      expect(store.get().spots.home?.name).toBe('10 Downing Street');
      expect(store.get().spots.away?.name).toBe('One Infinite Loop');
      controller.lineUpAgain();
      expect(store.get().spots).toEqual({ home: null, away: null });
      controller.pinSpot('away', downingStreet);
      controller.pickPlace('away', paris);
      expect(store.get().spots.away).toBeNull();
    });

    it('measures from the pin to an address on Home', () => {
      const { store, dual, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      const stanford = { name: 'Stanford Stadium', position: { lat: 37.4346, lng: -122.1609 } };
      controller.measureTo('home', stanford);
      const trip = store.get().trip;
      expect(trip).toEqual({ from: infiniteLoop.position, to: stanford.position, fromName: 'One Infinite Loop', toName: 'Stanford Stadium' });
      // Framed as a line, not as a pair of places: closer than the metro view when the line is short.
      expect(dual.getView().zoom).toBe(LINE_ZOOM);
      // And that view is theirs: it goes into the link, so a reload shows the line the same way.
      expect(store.get().view?.zoom).toBe(LINE_ZOOM);
      const text = spansToText(tripSpans(scene(store, dual), somewhere) ?? []);
      expect(text).toMatch(/^One Infinite Loop to Stanford Stadium is \d+(\.\d)? mi \(\d+(\.\d)? km\) in a straight line\./);
      // The Away end under the pin goes by the pin's own name there.
      expect(text).toContain('that runs from 10 Downing Street to Somewhere.');
    });

    it('measures from the pin to an address on Away, and names where it lands', () => {
      const { store, dual, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      const heathrow = { name: 'Heathrow Airport', position: { lat: 51.47, lng: -0.4543 } };
      controller.measureTo('away', heathrow);
      const trip = store.get().trip!;
      expect(distanceMeters(overlayToBase(dual.getRegistration(), trip.to), heathrow.position)).toBeLessThan(0.01);
      expect(trip.toName).toBeUndefined();
      expect(spansToText(tripSpans(scene(store, dual), nothingNear) ?? [])).toContain(
        'Laid on London, that runs from 10 Downing Street to Heathrow Airport.',
      );
      // Once Home is turned the line no longer lands on the airport, so the name goes.
      controller.turnBy(30);
      expect(spansToText(tripSpans(scene(store, dual), somewhere) ?? [])).toContain('that runs from 10 Downing Street to Somewhere.');
    });

    it('measures from a start already placed while measuring, not from the pin', () => {
      const { store, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.toggleMeasure();
      const start = { lat: 37.39, lng: -122.08 };
      store.set({ tripDraft: start });
      expect(controller.measureTo('home', { name: 'Stanford Stadium', position: { lat: 37.4346, lng: -122.1609 } })).toBe(true);
      const s = store.get();
      expect(s.trip?.from).toEqual(start);
      expect(s.trip?.fromName).toBeUndefined();
      expect(s.trip?.toName).toBe('Stanford Stadium');
      expect(s.mode).toBe('browse');
      expect(s.tripDraft).toBeNull();
    });

    it('leaves the view alone when a line from a clicked start is already in sight, and frames the line when it is not', () => {
      const { store, dual, controller } = setup();
      const reg = dual.getRegistration();
      // Two spots of Home that lie on screen near the middle of the view.
      const start = baseToOverlay(reg, dual.unprojectAway({ x: 600, y: 380 }));
      const near = baseToOverlay(reg, dual.unprojectAway({ x: 900, y: 420 }));
      const view = dual.getView();
      store.set({ mode: 'measure', tripDraft: start });
      expect(controller.measureTo('home', { name: 'Near', position: near })).toBe(true);
      expect(dual.getView()).toBe(view);

      const far = baseToOverlay(reg, dual.unprojectAway({ x: 5000, y: 380 }));
      store.set({ mode: 'measure', tripDraft: start });
      expect(controller.measureTo('home', { name: 'Far', position: far })).toBe(true);
      expect(dual.getView()).not.toBe(view);
      // The line is what is framed, not the pin: the view's centre lies between its two ends.
      const middle = overlayToBase(reg, { lat: (start.lat + far.lat) / 2, lng: (start.lng + far.lng) / 2 });
      expect(distanceMeters(dual.getView().center, middle)).toBeLessThan(2000);
    });

    it('draws nothing when the target is where the line would start', () => {
      const { store, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      const before = store.get().trip;
      expect(controller.measureTo('home', infiniteLoop)).toBe(false);
      expect(controller.measureTo('away', downingStreet)).toBe(false);
      expect(store.get().trip).toBe(before);
    });

    it('swapping twice gives back every name of a trip', () => {
      const { store, controller } = setup();
      // The curated trip: "Palo Alto to San Jose", neither end under a named pin.
      const before = store.get().trip!;
      controller.swap();
      const swapped = store.get().trip!;
      expect(swapped.fromLanding?.name).toBe('Palo Alto');
      expect(swapped.toLanding?.name).toBe('San Jose');
      controller.swap();
      const back = store.get().trip!;
      expect(back.fromName).toBe(before.fromName);
      expect(back.toName).toBe(before.toName);
      expect(distanceMeters(back.from, before.from)).toBeLessThan(0.01);
    });

    it('swapping turns the names of a trip’s ends inside out', () => {
      const { store, dual, controller } = setup();
      controller.pinSpot('home', infiniteLoop);
      controller.pinSpot('away', downingStreet);
      controller.measureTo('away', { name: 'Heathrow Airport', position: { lat: 51.47, lng: -0.4543 } });
      controller.swap();
      const trip = store.get().trip!;
      expect(trip.fromName).toBe('10 Downing Street');
      expect(trip.toName).toBe('Heathrow Airport');
      expect(spansToText(tripSpans(scene(store, dual), somewhere) ?? [])).toMatch(
        /^10 Downing Street to Heathrow Airport is .* Laid on San Jose, that runs from One Infinite Loop to Somewhere\.$/,
      );
    });
  });

  it('knows whether the pin is on the stage', () => {
    const { dual, controller } = setup();
    expect(controller.pinIsOnStage()).toBe(true);
    dual.userMoves({ center: { lat: 53.5, lng: -2.2 }, zoom: 10 });
    expect(controller.pinIsOnStage()).toBe(false);
  });

  it('swap exchanges the places and keeps every drawn thing on the same ground', () => {
    const { store, dual, controller } = setup();
    controller.turnBy(25);
    controller.slideBy(120, -60);
    const before = store.get();
    const regBefore = dual.getRegistration();
    const viewBefore = dual.getView();
    const tripAwayBefore = overlayToBase(regBefore, before.trip!.from);

    controller.swap();
    const after = store.get();
    expect(after.home).toBe(before.away);
    expect(after.away).toBe(before.home);
    expect(after.reg.rotation).toBeCloseTo(-25, 9);
    // What was in the middle of the screen on Home is now the centre of the Away camera.
    expect(distanceMeters(dual.getView().center, baseToOverlay(regBefore, viewBefore.center))).toBeLessThan(0.01);
    // The trip's start is now a Home position: the Away spot it used to lie on.
    expect(distanceMeters(after.trip!.from, tripAwayBefore)).toBeLessThan(0.01);
    expect(after.trip!.fromName).toBeUndefined();
    // And laid back on the new Away it lands where it was first drawn.
    expect(distanceMeters(overlayToBase(after.reg, after.trip!.from), before.trip!.from)).toBeLessThan(0.01);

    controller.swap();
    expect(store.get().home).toBe(before.home);
    expect(store.get().reg.rotation).toBeCloseTo(25, 9);
    expect(distanceMeters(dual.getView().center, viewBefore.center)).toBeLessThan(0.01);
  });

  it('slides Home by screen pixels and leaves Away alone', () => {
    const { dual, controller } = setup();
    const view = dual.getView();
    const pinBefore = dual.projectAway(dual.getRegistration().baseAnchor);
    controller.slideBy(32, -8);
    const pinAfter = dual.projectAway(dual.getRegistration().baseAnchor);
    expect(pinAfter.x - pinBefore.x).toBeCloseTo(32, 6);
    expect(pinAfter.y - pinBefore.y).toBeCloseTo(-8, 6);
    expect(dual.getView()).toBe(view);
  });

  it('turns, squares up, and re-pins at the centre without moving the picture', () => {
    const { store, dual, controller } = setup();
    controller.turnBy(-5);
    controller.turnBy(-5);
    expect(store.get().reg.rotation).toBeCloseTo(-10, 9);
    controller.squareUp();
    expect(store.get().reg.rotation).toBe(0);

    controller.slideBy(200, 100);
    const under = dual.unprojectHome({ x: 720, y: 400 });
    controller.pinAtCenter();
    const reg = dual.getRegistration();
    expect(distanceMeters(reg.baseAnchor, dual.getView().center)).toBeLessThan(0.01);
    expect(distanceMeters(reg.overlayAnchor, under)).toBeLessThan(0.01);
  });

  it('lines up again after sliding and turning', () => {
    const { store, controller } = setup();
    controller.slideBy(300, 40);
    controller.turnBy(77);
    controller.toggleSlide();
    controller.lineUpAgain();
    const s = store.get();
    expect(s.reg).toEqual(centeredRegistration(s.home, s.away));
    expect(s.mode).toBe('browse');
    expect(s.view).toBeNull();
  });

  it('drives the map pair from mode, hide and theme changes', () => {
    const { store, dual, controller, applied, setSystemDark } = setup();
    controller.toggleSlide();
    expect(dual.slideMode).toBe(true);
    controller.toggleMeasure();
    expect(store.get().mode).toBe('measure');
    expect(dual.slideMode).toBe(false);
    expect(dual.measureMode).toBe(true);
    expect(controller.cancel()).toBe(true);
    expect(dual.measureMode).toBe(false);
    expect(controller.cancel()).toBe(false);

    controller.setHomeHidden(true);
    expect(dual.homeHidden).toBe(true);

    setSystemDark(true);
    expect(store.get().theme).toBe('dark');
    expect(applied).toEqual(['dark']);
    expect(dual.styles).not.toBeNull();
    controller.setThemeChoice('light');
    expect(store.get().theme).toBe('light');
    setSystemDark(false);
    expect(applied).toEqual(['dark', 'light']);
  });

  it('remembers only the views the person chose', () => {
    const { store, dual, controller } = setup();
    controller.frame();
    expect(store.get().view).toBeNull();
    dual.userMoves({ center: { lat: 51.6, lng: -0.3 }, zoom: 11.23456 });
    expect(store.get().view).toEqual({ center: { lat: 51.6, lng: -0.3 }, zoom: 11.23 });
  });

  it('builds a link that reopens exactly this view', () => {
    const { dual, controller } = setup();
    controller.slideBy(50, 50);
    controller.turnBy(12);
    const link = controller.currentLink();
    expect(link.startsWith('https://example.test/wwiwiwh/#home=san-jose&away=london&pin=')).toBe(true);
    const { state, incomplete } = decodeLink(link.split('#')[1] as string);
    expect(incomplete).toBe(false);
    expect(state.reg.rotation).toBe(12);
    expect(distanceMeters(state.reg.baseAnchor, dual.getRegistration().baseAnchor)).toBeLessThan(2);
    expect(state.view?.zoom).toBe(10);
  });

  it('reports how far the two maps disagree in scale across the screen', () => {
    const { dual, controller } = setup();
    expect(controller.scaleDrift()).toBeLessThan(0.01);
    dual.setView({ center: dual.getView().center, zoom: 5 });
    expect(controller.scaleDrift()).toBeGreaterThan(0.03);
  });
});

describe('a drive', () => {
  const paloAlto = { lat: 37.4419, lng: -122.143 };
  const sanJoseCentre = defaultLinkState().home.center;
  const kingsCross = { lat: 51.5308, lng: -0.1238 };
  const heathrow = { lat: 51.47, lng: -0.4543 };
  const onHome: Drive = { on: 'home', from: paloAlto, to: sanJoseCentre, match: 'time' };
  const route = { meters: 27_963, seconds: 1338, line: [paloAlto, sanJoseCentre] };
  const outline = [[[paloAlto, sanJoseCentre, kingsCross, paloAlto]]];

  it('is set by its two ends on one place, takes the place of the trip, and is asked about', () => {
    vi.useFakeTimers();
    const { store, dual, controller, roadsAsked } = setup();
    expect(store.get().trip).not.toBeNull();
    controller.toggleDrive();
    expect(store.get().mode).toBe('drive');
    // Presses on the map are taken as they are while measuring.
    expect(dual.measureMode).toBe(true);
    expect(controller.driveEnd('away', { name: 'King’s Cross', position: kingsCross })).toBe(true);
    expect(store.get()).toMatchObject({ mode: 'drive', driveSide: 'away', driveDraft: { at: kingsCross, name: 'King’s Cross' }, drive: null });
    expect(controller.driveEnd('away', { name: 'Heathrow', position: heathrow })).toBe(true);
    expect(store.get()).toMatchObject({
      mode: 'browse',
      driveDraft: null,
      trip: null,
      drive: { on: 'away', from: kingsCross, to: heathrow, fromName: 'King’s Cross', toName: 'Heathrow', match: 'time' },
      route: { status: 'finding' },
    });
    expect(dual.measureMode).toBe(false);
    try {
      vi.advanceTimersByTime(0);
      expect(roadsAsked).toEqual(['route']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an end on the other place, or on the spot it starts from', () => {
    const { store, controller } = setup();
    controller.toggleDrive();
    controller.driveEnd('away', { name: 'King’s Cross', position: kingsCross });
    expect(controller.driveEnd('home', { name: 'Palo Alto', position: paloAlto })).toBe(false);
    expect(controller.driveEnd('away', { name: 'The same door', position: kingsCross })).toBe(false);
    expect(store.get()).toMatchObject({ mode: 'drive', drive: null, driveDraft: { at: kingsCross } });
  });

  it('brings a start picked by address into sight, and frames the finished drive when an end is out of sight', () => {
    const { store, dual, controller } = setup();
    controller.toggleDrive();
    const reading = { lat: 51.4543, lng: -0.9781 };
    controller.driveEnd('away', { name: 'Reading', position: reading });
    expect(distanceMeters(dual.getView().center, reading)).toBeLessThan(1);
    dual.calls.length = 0;
    controller.driveEnd('away', { name: 'Heathrow', position: heathrow });
    expect(dual.calls).toContain('fit');
    // The view that shows the drive is theirs: it goes into the link.
    expect(store.get().view).not.toBeNull();
  });

  it('leaves the view alone when both ends are in sight already', () => {
    const { dual, controller } = setup();
    controller.toggleDrive();
    const { center } = dual.getView();
    controller.driveEnd('away', { name: null, position: center });
    dual.calls.length = 0;
    controller.driveEnd('away', { name: null, position: dual.unprojectAway({ x: 600, y: 300 }) });
    expect(dual.calls).not.toContain('fit');
    expect(dual.calls).not.toContain('setView');
  });

  it('is made from the trip, between the same two ends and by the same names', () => {
    const { store, controller } = setup();
    const trip = store.get().trip;
    controller.driveTheTrip();
    expect(store.get().trip).toBeNull();
    expect(store.get().drive).toEqual({ on: 'home', from: trip?.from, to: trip?.to, fromName: 'Palo Alto', toName: 'San Jose', match: 'time' });
  });

  it('gives way to a line that is measured after it', () => {
    const { store, controller } = setup();
    controller.driveTheTrip();
    controller.measureTo('home', { name: 'Stanford Stadium', position: { lat: 37.4346, lng: -122.1609 } });
    expect(store.get().drive).toBeNull();
    expect(store.get().trip).not.toBeNull();
  });

  it('draws the road on the place it is driven on, and the reach on the other', () => {
    const { store, dual } = setup();
    store.set({ drive: onHome, trip: null });
    store.set({ route: { status: 'found', route } });
    expect(dual.drawings).toEqual({ home: { route: route.line, reach: null }, away: NO_DRAWING });
    store.set({ reach: { status: 'found', outline } });
    expect(dual.drawings).toEqual({ home: { route: route.line, reach: null }, away: { route: null, reach: outline } });
    store.set({ drive: { ...onHome, to: kingsCross } });
    // Another drive: nothing is known about it yet.
    expect(dual.drawings).toEqual({ home: NO_DRAWING, away: NO_DRAWING });
  });

  it('stays on its own roads when the places are swapped: the other sheet is now the one it is on', () => {
    const { store, dual, controller } = setup();
    store.set({ drive: onHome, trip: null });
    store.set({ route: { status: 'found', route } });
    store.set({ reach: { status: 'found', outline } });
    controller.swap();
    expect(store.get().drive).toEqual({ ...onHome, on: 'away' });
    expect(store.get().driveSide).toBe('away');
    // Nothing new to ask: the same road, and the same spot for its start on the other place.
    expect(store.get().route).toEqual({ status: 'found', route });
    expect(store.get().reach).toEqual({ status: 'found', outline });
    expect(dual.drawings).toEqual({ away: { route: route.line, reach: null }, home: { route: null, reach: outline } });
  });

  it('survives a change of the other place, and goes with its own', () => {
    const { store, controller } = setup();
    store.set({ drive: onHome, trip: null });
    controller.pickPlace('away', tokyo);
    expect(store.get().drive).toBe(onHome);
    expect(store.get().trip).toBeNull();
    controller.pickPlace('home', berlin);
    expect(store.get().drive).toBeNull();
    // A new Home that comes with a trip of its own brings it, now that no drive is in its place.
    controller.pickPlace('home', presetPlace('san-jose') as Place);
    expect(store.get().trip?.fromName).toBe('Palo Alto');
  });

  it('keeps the drive, and not the new Home’s own trip, when Home changes under a drive on Away', () => {
    const { store, controller } = setup();
    const onAway: Drive = { on: 'away', from: kingsCross, to: heathrow, match: 'time' };
    store.set({ drive: onAway, trip: null, home: berlin });
    controller.pickPlace('home', presetPlace('san-jose') as Place);
    expect(store.get().drive).toBe(onAway);
    expect(store.get().trip).toBeNull();
  });

  it('frames its two ends with the pin, whichever place it is on', () => {
    const { store, dual, controller } = setup();
    store.set({ drive: { on: 'away', from: kingsCross, to: heathrow, match: 'time' }, trip: null });
    dual.calls.length = 0;
    controller.frame();
    expect(dual.calls).toEqual(['fit']);
    // The pin goes in the middle: each end is framed together with its mirror image through it.
    expect(distanceMeters(dual.getView().center, dual.getRegistration().baseAnchor)).toBeLessThan(1);
  });

  it('switches what the reach matches, and only when there is a drive', () => {
    const { store, controller } = setup();
    controller.setDriveMatch('distance');
    expect(store.get().drive).toBeNull();
    store.set({ drive: onHome, trip: null });
    controller.setDriveMatch('distance');
    expect(store.get().drive).toEqual({ ...onHome, match: 'distance' });
    const same = store.get().drive;
    controller.setDriveMatch('distance');
    expect(store.get().drive).toBe(same);
  });

  it('is cleared with whatever was found out about it', () => {
    const { store, dual, controller } = setup();
    store.set({ drive: onHome, trip: null });
    store.set({ route: { status: 'found', route } });
    controller.clearDrive();
    expect(store.get()).toMatchObject({ drive: null, route: null, reach: null });
    expect(dual.drawings).toEqual({ home: NO_DRAWING, away: NO_DRAWING });
  });

  it('starts over on the place the last drive was on, and takes up a start again when the place is switched', () => {
    const { store, controller } = setup();
    store.set({ drive: { ...onHome, on: 'away' }, trip: null });
    controller.toggleDrive();
    expect(store.get().driveSide).toBe('away');
    controller.driveEnd('away', { name: null, position: kingsCross });
    controller.setDriveSide('home');
    expect(store.get()).toMatchObject({ driveSide: 'home', driveDraft: null, mode: 'drive' });
    controller.toggleDrive();
    expect(store.get().mode).toBe('browse');
  });

  it('leaves a start behind when the mode is left, however it is left', () => {
    for (const leave of ['cancel', 'toggleSlide', 'toggleMeasure', 'lineUpAgain', 'swap'] as const) {
      const { store, controller } = setup();
      controller.toggleDrive();
      controller.driveEnd('home', { name: null, position: paloAlto });
      controller[leave]();
      expect(store.get().driveDraft, leave).toBeNull();
      expect(store.get().mode, leave).not.toBe('drive');
    }
  });

  it('is part of the link, and comes back from it', () => {
    const { store, controller } = setup();
    store.set({ drive: { on: 'away', from: kingsCross, to: heathrow, toName: 'Heathrow', match: 'distance' }, trip: null });
    const link = controller.currentLink();
    expect(link).toContain('&drive=51.5308,-0.1238~51.47,-0.4543&on=away&dt=Heathrow&same=distance');
    const again = setup();
    again.controller.applyLink(decodeLink(link.slice(link.indexOf('#'))).state);
    expect(again.store.get().drive).toEqual(store.get().drive);
    expect(again.store.get().driveSide).toBe('away');
    expect(again.store.get().route).toEqual({ status: 'finding' });
  });
});

describe('link sync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function withAddress(initialHash = '') {
    const ctx = setup();
    const log: string[] = [];
    let hash = initialHash;
    const listeners = new Set<() => void>();
    const address: AddressBar = {
      hash: () => hash,
      push: (h) => {
        hash = `#${h}`;
        log.push(`push ${h}`);
      },
      replace: (h) => {
        hash = `#${h}`;
        log.push(`replace ${h}`);
      },
      onNavigate(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const incomplete = vi.fn();
    const sync = createLinkSync({ store: ctx.store, controller: ctx.controller as Controller, address, onIncomplete: incomplete });
    const navigateTo = (h: string) => {
      hash = h;
      for (const listener of listeners) listener();
    };
    return { ...ctx, log, sync, navigateTo, incomplete };
  }

  it('writes nothing until something changes', () => {
    const { log, controller } = withAddress();
    controller.frame();
    vi.advanceTimersByTime(1000);
    expect(log).toEqual([]);
  });

  it('rewrites the entry once after a burst of movement', () => {
    const { log, dual, controller } = withAddress();
    for (let i = 0; i < 20; i++) controller.slideBy(5, 0);
    dual.userMoves({ center: { lat: 51.5, lng: -0.2 }, zoom: 10.5 });
    expect(log).toEqual([]);
    vi.advanceTimersByTime(299);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^replace home=san-jose&away=london&pin=.*&view=51\.5,-0\.2,10\.5$/);
  });

  it('adds a history entry when a place changes', () => {
    const { log, controller } = withAddress();
    controller.pickPlace('away', paris);
    expect(log).toEqual(['push home=san-jose&away=paris']);
    controller.swap();
    expect(log[1]).toMatch(/^push home=paris&away=san-jose/);
  });

  it('follows Back to an earlier address without writing a new entry', () => {
    const { log, store, dual, navigateTo, incomplete, controller } = withAddress();
    controller.pickPlace('away', paris);
    navigateTo('#home=san-jose&away=tokyo&turn=40&view=35.68,139.76,11');
    const s = store.get();
    expect(s.away.name).toBe('Tokyo');
    expect(dual.getRegistration().rotation).toBe(40);
    expect(dual.getView()).toEqual({ center: { lat: 35.68, lng: 139.76 }, zoom: 11 });
    vi.advanceTimersByTime(1000);
    expect(log).toHaveLength(1);
    expect(incomplete).not.toHaveBeenCalled();
  });

  it('repairs an address it could not fully understand and says so', () => {
    const { log, store, navigateTo, incomplete } = withAddress();
    navigateTo('#home=atlantis&away=paris');
    expect(store.get().home.name).toBe('San Jose');
    expect(store.get().away.name).toBe('Paris');
    expect(log).toEqual(['replace home=san-jose&away=paris']);
    expect(incomplete).toHaveBeenCalledTimes(1);
  });

  it('ignores the echo of its own write', () => {
    const { log, controller, navigateTo, dual } = withAddress();
    controller.pickPlace('away', paris);
    const calls = dual.calls.length;
    navigateTo('#home=san-jose&away=paris');
    expect(dual.calls.length).toBe(calls);
    expect(log).toHaveLength(1);
  });

  it('rewrites the entry for a drive, and never for what the road service says about it', () => {
    const { store, log } = withAddress();
    const drive: Drive = { on: 'home', from: { lat: 37.4419, lng: -122.143 }, to: { lat: 37.3382, lng: -121.8863 }, match: 'time' };
    store.set({ drive, trip: null });
    vi.advanceTimersByTime(300);
    expect(log).toEqual(['replace home=san-jose&away=london&drive=37.4419,-122.143~37.3382,-121.8863']);
    store.set({ route: { status: 'found', route: { meters: 1, seconds: 1, line: [] } }, reach: { status: 'finding' } });
    store.set({ reach: { status: 'unavailable' } });
    vi.advanceTimersByTime(5000);
    expect(log).toHaveLength(1);
  });

  it('flushes a pending write on demand', () => {
    const { log, controller, sync } = withAddress();
    controller.turnBy(10);
    sync.flush();
    expect(log).toEqual(['replace home=san-jose&away=london&turn=10']);
    vi.advanceTimersByTime(1000);
    expect(log).toHaveLength(1);
  });

  it('finishes the entry being left before adding the next', () => {
    const { log, controller } = withAddress();
    controller.turnBy(10);
    controller.pickPlace('away', paris);
    expect(log).toEqual(['replace home=san-jose&away=london&turn=10', 'push home=san-jose&away=paris']);
    vi.advanceTimersByTime(1000);
    expect(log).toHaveLength(2);
  });

  it('repairs the address on request', () => {
    const { log, sync } = withAddress('#home=atlantis');
    sync.repair();
    expect(log).toEqual(['replace home=san-jose&away=london']);
  });
});
