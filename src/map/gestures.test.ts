import { describe, expect, it } from 'vitest';
import { fromMercator, toMercator } from '../geo/mercator';
import { baseToOverlay, overlayToBase, type Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { ScreenPoint } from './contracts';
import { bindHomeGestures, HomeGestures, type GestureHost, type PointerInput } from './gestures';

const SAN_JOSE: LngLat = { lng: -121.8896, lat: 37.3322 };
const LONDON: LngLat = { lng: -0.1276, lat: 51.5073 };
const STAGE = { width: 1440, height: 900 };
const WORLD_PX = 512 * 2 ** 10;

/** A north-up Away at zoom 10 centred on London, with the bookkeeping of the real map pair. */
function createHost(options: { slideMode?: boolean; rotation?: number } = {}) {
  const center = toMercator(LONDON);
  const log: string[] = [];
  const state = {
    registration: { overlayAnchor: SAN_JOSE, baseAnchor: LONDON, rotation: options.rotation ?? 0 } as Registration,
    slideMode: options.slideMode ?? false,
    held: false,
    finals: 0,
    log,
    /** Says which changes of registration a listener throws on, once the change has been made. */
    failsOn: null as ((final: boolean) => boolean) | null,
  };
  const projectAway = (p: LngLat): ScreenPoint => {
    const m = toMercator(p);
    return { x: (m.x - center.x) * WORLD_PX + STAGE.width / 2, y: (m.y - center.y) * WORLD_PX + STAGE.height / 2 };
  };
  const unprojectAway = (pt: ScreenPoint): LngLat =>
    fromMercator({ x: center.x + (pt.x - STAGE.width / 2) / WORLD_PX, y: center.y + (pt.y - STAGE.height / 2) / WORLD_PX });
  let waiting: (() => void)[] = [];
  const host: GestureHost = {
    getRegistration: () => state.registration,
    setRegistration(registration, final) {
      state.registration = registration;
      if (final) state.finals++;
      log.push(final ? 'final' : 'change');
      if (state.failsOn?.(final)) throw new Error('listener');
    },
    projectAway,
    unprojectAway,
    isSlideMode: () => state.slideMode,
    holdAway(held) {
      state.held = held;
    },
    gesture: (kind, phase) => log.push(`${kind}:${phase}`),
    beforeNextFrame(callback) {
      waiting.push(callback);
      return () => {
        waiting = waiting.filter((other) => other !== callback);
      };
    },
  };
  const gestures = new HomeGestures(host);
  /** The browser draws a frame: whatever was waiting for one runs. */
  const frame = () => {
    const due = waiting;
    waiting = [];
    for (const callback of due) callback();
  };
  /** A pointer move that gets a frame to itself. */
  const drag = (input: PointerInput) => {
    gestures.move(input);
    frame();
  };
  /** Where the Home position that started under `at` is drawn now. */
  const homeSpotAt = (at: ScreenPoint) => baseToOverlay(state.registration, unprojectAway(at));
  const whereIs = (home: LngLat) => projectAway(overlayToBase(state.registration, home));
  return { gestures, state, projectAway, unprojectAway, homeSpotAt, whereIs, frame, drag, framesWaiting: () => waiting.length };
}

/** A mouse event with one button down: the left one, unless `extra` names the right (2). */
const mouse = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
  id: 1,
  kind: 'mouse',
  primary: true,
  button: 0,
  buttons: extra.button === 2 ? 2 : 1,
  point: { x, y },
  shift: false,
  alt: false,
  ctrl: false,
  ...extra,
});

/** The mouse seen with no button down. */
const hover = (x: number, y: number): PointerInput => mouse(x, y, { buttons: 0 });

const finger = (id: number, x: number, y: number, primary = false): PointerInput => ({
  id,
  kind: 'touch',
  primary,
  button: 0,
  buttons: 1,
  point: { x, y },
  shift: false,
  alt: false,
  ctrl: false,
});

/** A pen: down on the glass with its tip, unless `buttons` says otherwise (0 is a pen in the air). */
const pen = (x: number, y: number, buttons = 1): PointerInput => ({ ...finger(3, x, y, true), kind: 'pen', buttons });

const PIN = { x: STAGE.width / 2, y: STAGE.height / 2 };

function expectNear(a: ScreenPoint, b: ScreenPoint, tolerance = 0.01) {
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(tolerance);
}

describe('mouse in browse mode', () => {
  it('leaves a plain drag to Away', () => {
    const { gestures, state, drag, framesWaiting } = createHost();
    expect(gestures.press(mouse(300, 300))).toBe(false);
    gestures.move(mouse(400, 380));
    expect(framesWaiting()).toBe(0);
    drag(mouse(420, 390));
    gestures.release(1);
    expect(state.log).toEqual([]);
    expect(state.held).toBe(false);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('leaves Ctrl+click (a context click on macOS) alone even with Shift', () => {
    const { gestures, state } = createHost();
    expect(gestures.press(mouse(300, 300, { shift: true, ctrl: true }))).toBe(false);
    expect(state.log).toEqual([]);
  });
});

describe('sliding Home with Shift+drag', () => {
  it('moves the pin to the grabbed spot without moving the picture', () => {
    const { gestures, state, homeSpotAt, projectAway } = createHost();
    const far = { x: 900, y: 200 };
    const homeThereBefore = homeSpotAt(far);
    expect(gestures.press(mouse(300, 620, { shift: true }))).toBe(true);
    expect(state.held).toBe(true);
    expectNear(projectAway(state.registration.baseAnchor), { x: 300, y: 620 });
    // Repinning rescales Home by a hair far from the pin, so allow a pixel.
    const homeThereAfter = homeSpotAt(far);
    expect(Math.abs(homeThereAfter.lng - homeThereBefore.lng)).toBeLessThan(1e-3);
    expect(Math.abs(homeThereAfter.lat - homeThereBefore.lat)).toBeLessThan(1e-3);
    expect(state.log).toEqual(['slide:start', 'change']);
  });

  it('keeps the grabbed spot under the pointer', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    for (const [x, y] of [[320, 600], [512, 333], [1300, 80], [-40, 950]] as const) {
      drag(mouse(x, y, { shift: true }));
      expectNear(whereIs(grabbed), { x, y });
    }
    expect(state.registration.overlayAnchor).toEqual(grabbed);
  });

  it('ignores wobble within the slop, then follows exactly', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    drag(mouse(303, 622, { shift: true }));
    expectNear(whereIs(grabbed), { x: 300, y: 620 });
    expect(state.log).toEqual(['slide:start', 'change']);
    drag(mouse(306, 622, { shift: true }));
    expectNear(whereIs(grabbed), { x: 306, y: 622 });
    // Back inside the slop: it is a drag by now, so Home keeps following.
    drag(mouse(301, 620, { shift: true }));
    expectNear(whereIs(grabbed), { x: 301, y: 620 });
  });

  it('ends with a final change and owns the click that follows', () => {
    const { gestures, state, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    drag(mouse(500, 500, { shift: true }));
    gestures.release(1);
    expect(state.log).toEqual(['slide:start', 'change', 'change', 'final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.claimsClick()).toBe(true);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('treats a press without movement as "put the pin here"', () => {
    const { gestures, state, projectAway } = createHost();
    gestures.press(mouse(820, 410, { shift: true }));
    gestures.release(1);
    expect(state.log).toEqual(['slide:start', 'change', 'final', 'slide:end']);
    expectNear(projectAway(state.registration.baseAnchor), { x: 820, y: 410 });
    expect(gestures.claimsClick()).toBe(true);
  });

  it('closes a slide whose release never arrived when the next press comes', () => {
    const { gestures, state, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    drag(mouse(400, 500, { shift: true }));
    // The button came up outside the window. The next press is an ordinary one.
    expect(gestures.press(mouse(700, 300))).toBe(false);
    expect(state.log).toEqual(['slide:start', 'change', 'change', 'final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('forgets an unclaimed click at the next press', () => {
    const { gestures } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    gestures.release(1);
    gestures.press(mouse(300, 620));
    gestures.release(1);
    expect(gestures.claimsClick()).toBe(false);
  });
});

describe('sliding Home in slide mode', () => {
  it('slides on a plain left drag', () => {
    const { gestures, homeSpotAt, whereIs, drag } = createHost({ slideMode: true });
    expect(gestures.press(mouse(600, 300))).toBe(true);
    const grabbed = homeSpotAt({ x: 600, y: 300 });
    drag(mouse(700, 420));
    expectNear(whereIs(grabbed), { x: 700, y: 420 });
  });

  it('does nothing for touch when slide mode is off', () => {
    const { gestures, state, drag } = createHost();
    expect(gestures.press(finger(5, 200, 500, true))).toBe(false);
    drag(finger(5, 280, 540));
    gestures.release(5);
    expect(state.log).toEqual([]);
  });
});

describe('sliding Home with one finger', () => {
  it('leaves the pin alone until the finger moves, then slides the spot it landed on', () => {
    const { gestures, state, homeSpotAt, whereIs, projectAway, drag } = createHost({ slideMode: true });
    const before = state.registration;
    expect(gestures.press(finger(5, 200, 500, true))).toBe(true);
    expect(state.held).toBe(true);
    const grabbed = homeSpotAt({ x: 200, y: 500 });
    // A finger that has only landed may still be the first of a pinch.
    drag(finger(5, 202, 503));
    expect(state.registration).toBe(before);
    expect(state.log).toEqual([]);

    drag(finger(5, 280, 540));
    expect(state.log).toEqual(['slide:start', 'change']);
    expectNear(projectAway(state.registration.baseAnchor), { x: 280, y: 540 });
    expectNear(whereIs(grabbed), { x: 280, y: 540 });
    drag(finger(5, 90, 610));
    expectNear(whereIs(grabbed), { x: 90, y: 610 });

    gestures.release(5);
    expect(state.log).toEqual(['slide:start', 'change', 'change', 'final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.claimsClick()).toBe(true);
  });

  it('treats a tap as "put the pin here", when the finger lifts', () => {
    const { gestures, state, projectAway } = createHost({ slideMode: true });
    gestures.press(finger(5, 820, 410, true));
    expect(state.log).toEqual([]);
    gestures.release(5);
    expect(state.log).toEqual(['slide:start', 'final', 'slide:end']);
    expectNear(projectAway(state.registration.baseAnchor), { x: 820, y: 410 });
    expect(state.held).toBe(false);
    expect(gestures.claimsClick()).toBe(true);
  });

  it('leaves no trace of a finger the browser took away before it moved', () => {
    const { gestures, state } = createHost({ slideMode: true });
    const before = state.registration;
    gestures.press(finger(5, 820, 410, true));
    gestures.release(5, true);
    expect(state.registration).toBe(before);
    expect(state.log).toEqual([]);
    expect(state.held).toBe(false);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('keeps what a slide did when the browser takes the finger away', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost({ slideMode: true });
    gestures.press(finger(5, 200, 500, true));
    const grabbed = homeSpotAt({ x: 200, y: 500 });
    drag(finger(5, 260, 560));
    gestures.release(5, true);
    expectNear(whereIs(grabbed), { x: 260, y: 560 });
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
  });

  it('never shows the first finger of a pinch: the pin does not move and nothing is announced', () => {
    const { gestures, state, drag } = createHost({ slideMode: true });
    const before = state.registration;
    gestures.press(finger(5, 200, 500, true));
    gestures.press(finger(6, 320, 420));
    expect(state.held).toBe(false);
    // Spreading the fingers apart without twisting is a pinch: Home does not move.
    drag(finger(5, 150, 533));
    drag(finger(6, 380, 380));
    gestures.release(5);
    gestures.release(6);
    expect(state.registration).toBe(before);
    expect(state.log).toEqual([]);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('keeps a slide that had already moved when a second finger lands', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost({ slideMode: true });
    gestures.press(finger(5, 200, 500, true));
    const grabbed = homeSpotAt({ x: 200, y: 500 });
    // The second finger lands before the frame that would have drawn this move.
    gestures.move(finger(5, 260, 560));
    gestures.press(finger(6, 400, 300));
    expectNear(whereIs(grabbed), { x: 260, y: 560 });
    expect(state.log).toEqual(['slide:start', 'change', 'final', 'slide:end']);
    // The first finger no longer drags Home.
    drag(finger(5, 100, 100));
    expectNear(whereIs(grabbed), { x: 260, y: 560 });
  });

  it('does not start a slide with the finger left over after a pinch', () => {
    const { gestures, state, drag } = createHost({ slideMode: true });
    gestures.press(finger(5, 200, 500, true));
    gestures.press(finger(6, 320, 420));
    gestures.release(6);
    drag(finger(5, 400, 400));
    gestures.release(5);
    expect(state.log).toEqual([]);
  });

  it('recovers when a finger was lifted without a release reaching us', () => {
    const { gestures, state, drag } = createHost({ slideMode: true });
    gestures.press(finger(5, 200, 500, true));
    // No release for finger 5. The next first finger starts cleanly.
    expect(gestures.press(finger(9, 600, 300, true))).toBe(true);
    expect(state.log).toEqual([]);
    drag(finger(9, 640, 330));
    expect(state.log).toEqual(['slide:start', 'change']);
  });
});

describe('one change per frame', () => {
  it('acts on the latest position only, however many moves a frame brings', () => {
    const { gestures, state, homeSpotAt, whereIs, frame, framesWaiting } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    for (let x = 310; x <= 700; x += 10) gestures.move(mouse(x, 600, { shift: true }));
    expect(state.log).toEqual(['slide:start', 'change']);
    expectNear(whereIs(grabbed), { x: 300, y: 620 });
    expect(framesWaiting()).toBe(1);

    frame();
    expect(state.log).toEqual(['slide:start', 'change', 'change']);
    expectNear(whereIs(grabbed), { x: 700, y: 600 });
    expect(framesWaiting()).toBe(0);
    // A frame with no move in it changes nothing.
    frame();
    expect(state.log).toEqual(['slide:start', 'change', 'change']);
  });

  it('acts on a move still waiting when the pointer is released, before the gesture ends', () => {
    const { gestures, state, homeSpotAt, whereIs, frame, framesWaiting } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    gestures.move(mouse(500, 400, { shift: true }));
    gestures.move(mouse(812, 345, { shift: true }));
    gestures.release(1);
    expect(state.log).toEqual(['slide:start', 'change', 'change', 'final', 'slide:end']);
    expectNear(whereIs(grabbed), { x: 812, y: 345 });
    // The frame that was asked for has been called off.
    expect(framesWaiting()).toBe(0);
    frame();
    expect(state.log).toHaveLength(5);
  });

  it('turns once per frame too, by the whole angle swept since the last one', () => {
    const { gestures, state, frame } = createHost();
    const around = (degrees: number) => ({
      x: PIN.x + 200 * Math.cos((degrees * Math.PI) / 180),
      y: PIN.y + 200 * Math.sin((degrees * Math.PI) / 180),
    });
    const start = around(0);
    gestures.press(mouse(start.x, start.y, { alt: true }));
    for (const degrees of [5, 12, 20, 31]) {
      const p = around(degrees);
      gestures.move(mouse(p.x, p.y, { alt: true }));
    }
    expect(state.log).toEqual([]);
    frame();
    expect(state.log).toEqual(['turn:start', 'change']);
    expect(state.registration.rotation).toBeCloseTo(31, 6);
  });

  it('acts on a waiting move when the gesture is cut short', () => {
    const { gestures, state, homeSpotAt, whereIs, framesWaiting } = createHost({ slideMode: true });
    gestures.press(mouse(600, 300));
    const grabbed = homeSpotAt({ x: 600, y: 300 });
    gestures.move(mouse(700, 420));
    gestures.finish();
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expectNear(whereIs(grabbed), { x: 700, y: 420 });
    expect(framesWaiting()).toBe(0);
  });
});

describe('turning Home with the mouse', () => {
  /** A point on the circle of `radius` around the pin, `degrees` clockwise from east. */
  const around = (degrees: number, radius = 200) => ({
    x: PIN.x + radius * Math.cos((degrees * Math.PI) / 180),
    y: PIN.y + radius * Math.sin((degrees * Math.PI) / 180),
  });

  it('turns about the pin by the angle the pointer sweeps, on Alt+drag', () => {
    const { gestures, state, drag } = createHost();
    const start = around(10);
    expect(gestures.press(mouse(start.x, start.y, { alt: true }))).toBe(true);
    const next = around(47);
    drag(mouse(next.x, next.y, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(37, 6);
    expect(state.registration.baseAnchor).toEqual(LONDON);
    expect(state.registration.overlayAnchor).toEqual(SAN_JOSE);
    const back = around(-20);
    drag(mouse(back.x, back.y, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(-30, 6);
    gestures.release(1);
    expect(state.log).toEqual(['turn:start', 'change', 'change', 'final', 'turn:end']);
    expect(gestures.claimsClick()).toBe(true);
  });

  it('squares up within two degrees of a quarter turn and lets go beyond', () => {
    const { gestures, state, drag } = createHost();
    const at = (degrees: number) => {
      const p = around(degrees);
      drag(mouse(p.x, p.y, { alt: true }));
      return state.registration.rotation;
    };
    const start = around(0);
    gestures.press(mouse(start.x, start.y, { alt: true }));
    expect(at(88.5)).toBe(90);
    expect(at(91.9)).toBe(90);
    expect(at(92.5)).toBeCloseTo(92.5, 6);
    expect(at(179)).toBe(180);
    expect(at(-91)).toBe(-90);
    expect(at(1.2)).toBe(0);
    expect(at(30)).toBeCloseTo(30, 6);
  });

  it('adds to the rotation Home already has', () => {
    const { gestures, state, drag } = createHost({ rotation: 170 });
    const start = around(0);
    gestures.press(mouse(start.x, start.y, { alt: true }));
    const next = around(25);
    drag(mouse(next.x, next.y, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(-165, 6);
  });

  it('turns on a right-button drag and suppresses the menu that follows', () => {
    const { gestures, state, drag } = createHost();
    const start = around(0);
    expect(gestures.press(mouse(start.x, start.y, { button: 2 }))).toBe(true);
    const next = around(15);
    drag(mouse(next.x, next.y, { button: 2 }));
    gestures.release(1);
    expect(state.registration.rotation).toBeCloseTo(15, 6);
    expect(gestures.shouldSuppressContextMenu()).toBe(true);
    expect(gestures.shouldSuppressContextMenu()).toBe(false);
  });

  it('leaves the menu alone after a right-click that turned nothing', () => {
    const { gestures, state } = createHost();
    gestures.press(mouse(500, 300, { button: 2 }));
    gestures.release(1);
    expect(state.log).toEqual([]);
    expect(state.held).toBe(false);
    expect(gestures.shouldSuppressContextMenu()).toBe(false);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('suppresses a menu that opens on press, which would otherwise swallow the drag', () => {
    const { gestures } = createHost();
    gestures.press(mouse(500, 300, { button: 2 }));
    expect(gestures.shouldSuppressContextMenu()).toBe(true);
  });

  it('owes no second suppression once the menu of that press has come up', () => {
    const { gestures, drag } = createHost();
    const start = around(0);
    gestures.press(mouse(start.x, start.y, { button: 2 }));
    expect(gestures.shouldSuppressContextMenu()).toBe(true);
    const next = around(15);
    drag(mouse(next.x, next.y, { button: 2 }));
    gestures.release(1);
    // A later menu, from the keyboard say, is not this drag's.
    expect(gestures.shouldSuppressContextMenu()).toBe(false);
  });

  it('does not claim the click of an Alt+click that turned nothing', () => {
    const { gestures, state, drag } = createHost();
    gestures.press(mouse(500, 300, { alt: true }));
    drag(mouse(502, 301, { alt: true }));
    gestures.release(1);
    expect(state.log).toEqual([]);
    expect(gestures.claimsClick()).toBe(false);
  });

  it('holds still while the pointer is on top of the pin, then picks up without a jump', () => {
    const { gestures, state, drag } = createHost();
    const start = around(0);
    gestures.press(mouse(start.x, start.y, { alt: true }));
    const quarter = around(40);
    drag(mouse(quarter.x, quarter.y, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(40, 6);
    drag(mouse(PIN.x + 2, PIN.y + 1, { alt: true }));
    const out = around(200);
    drag(mouse(out.x, out.y, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(40, 6);
    const on = around(210);
    drag(mouse(on.x, on.y, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(50, 6);
  });

  it('turns about a pin that is off screen', () => {
    const { gestures, state, projectAway, drag } = createHost();
    state.registration = { ...state.registration, baseAnchor: { lng: 1.5, lat: 52.2 } };
    const pin = projectAway(state.registration.baseAnchor);
    expect(pin.x).toBeGreaterThan(STAGE.width);
    gestures.press(mouse(pin.x - 900, pin.y, { alt: true }));
    drag(mouse(pin.x - 900 * Math.cos(0.2), pin.y - 900 * Math.sin(0.2), { alt: true }));
    expect(state.registration.rotation).toBeCloseTo((0.2 * 180) / Math.PI, 5);
  });
});

describe('turning Home with a two-finger twist', () => {
  type Host = ReturnType<typeof createHost>;
  /** Two fingers on a circle of `radius` around (400, 400), turned `degrees` clockwise. */
  const pair = (degrees: number, radius = 100) => {
    const r = (degrees * Math.PI) / 180;
    return [
      { x: 400 - radius * Math.cos(r), y: 400 - radius * Math.sin(r) },
      { x: 400 + radius * Math.cos(r), y: 400 + radius * Math.sin(r) },
    ] as const;
  };
  /** Moves both fingers within one frame, as a real twist does. */
  const twistTo = ({ gestures, frame }: Host, degrees: number, radius?: number) => {
    const [a, b] = pair(degrees, radius);
    gestures.move(finger(5, a.x, a.y));
    gestures.move(finger(6, b.x, b.y));
    frame();
  };
  const land = ({ gestures }: Host, radius?: number) => {
    const [a, b] = pair(0, radius);
    gestures.press(finger(5, a.x, a.y, true));
    gestures.press(finger(6, b.x, b.y));
  };
  const turns = ({ state }: Host) => state.log.filter((entry) => entry.startsWith('turn'));

  it('needs each finger to travel more than 25px round the circle before it turns anything', () => {
    const host = createHost({ slideMode: true, rotation: 20 });
    land(host);
    // On a circle of radius 100 that is 14.3 degrees.
    twistTo(host, 8);
    twistTo(host, 14);
    expect(host.state.registration.rotation).toBe(20);
    expect(host.state.log).toEqual([]);
    twistTo(host, 15);
    expect(host.state.log).toEqual(['turn:start']);
    // The slop itself is not turned.
    expect(host.state.registration.rotation).toBe(20);
  });

  it('asks fingers that are close together for a wider angle, and fingers far apart for a narrower one', () => {
    const near = createHost({ slideMode: true });
    land(near, 40);
    twistTo(near, 30, 40);
    expect(turns(near)).toEqual([]);
    twistTo(near, 37, 40);
    expect(turns(near)).toEqual(['turn:start']);

    const far = createHost({ slideMode: true });
    land(far, 250);
    twistTo(far, 6, 250);
    expect(turns(far)).toEqual(['turn:start']);
  });

  it('turns Home by what is twisted beyond the slop, about the pin', () => {
    const host = createHost({ slideMode: true, rotation: 20 });
    const { state, gestures } = host;
    const anchors = { home: state.registration.overlayAnchor, away: state.registration.baseAnchor };
    land(host);
    twistTo(host, 15);
    expect(state.registration.rotation).toBe(20);
    twistTo(host, 35);
    expect(state.registration.rotation).toBeCloseTo(40, 6);
    twistTo(host, 5);
    expect(state.registration.rotation).toBeCloseTo(10, 6);
    expect(state.registration.overlayAnchor).toEqual(anchors.home);
    expect(state.registration.baseAnchor).toEqual(anchors.away);
    gestures.release(6);
    expect(state.log.slice(-3)).toEqual(['change', 'final', 'turn:end']);
  });

  it('is not fooled by a pinch that spreads the fingers', () => {
    const host = createHost({ slideMode: true });
    land(host);
    twistTo(host, 2, 60);
    twistTo(host, -3, 220);
    twistTo(host, 1, 300);
    expect(host.state.registration.rotation).toBe(0);
    expect(host.state.log).toEqual([]);
  });

  it('does not turn for a pinch whose fingers swing round as they close', () => {
    const host = createHost({ slideMode: true });
    // From 180px apart to 84px, turning 12 degrees on the way: what a hurried pinch looks like.
    land(host, 90);
    for (let step = 1; step <= 12; step++) twistTo(host, step, 90 - 4 * step);
    expect(host.state.registration.rotation).toBe(0);
    expect(host.state.log).toEqual([]);
  });

  it('stays a pinch once the fingers have changed their spread by more than 15%, however they twist afterwards', () => {
    const host = createHost({ slideMode: true });
    land(host);
    twistTo(host, 3, 114);
    twistTo(host, 6, 116);
    twistTo(host, 60, 116);
    twistTo(host, 90, 100);
    expect(host.state.registration.rotation).toBe(0);
    expect(host.state.log).toEqual([]);
    host.gestures.release(5);
    host.gestures.release(6);
    expect(host.state.log).toEqual([]);
  });

  it('lets the fingers spread freely once the turn has started', () => {
    const host = createHost({ slideMode: true });
    land(host);
    twistTo(host, 15);
    twistTo(host, 30, 180);
    expect(host.state.registration.rotation).toBeCloseTo(15, 6);
  });

  it('squares up like the mouse does', () => {
    const host = createHost({ slideMode: true, rotation: 80 });
    land(host);
    twistTo(host, 15);
    twistTo(host, 24);
    expect(host.state.registration.rotation).toBe(90);
  });

  it('stops when a third finger lands', () => {
    const host = createHost({ slideMode: true });
    land(host);
    twistTo(host, 15);
    twistTo(host, 28);
    host.gestures.press(finger(7, 700, 700));
    expect(host.state.log.slice(-2)).toEqual(['final', 'turn:end']);
    twistTo(host, 60);
    expect(host.state.registration.rotation).toBeCloseTo(13, 6);
  });

  it('never turns when slide mode is off', () => {
    const host = createHost();
    land(host);
    twistTo(host, 40);
    expect(host.state.log).toEqual([]);
  });
});

describe('finish', () => {
  it('ends a slide in progress, keeping where Home is', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost({ slideMode: true });
    gestures.press(mouse(600, 300));
    const grabbed = homeSpotAt({ x: 600, y: 300 });
    drag(mouse(700, 420));
    gestures.finish();
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expectNear(whereIs(grabbed), { x: 700, y: 420 });
    drag(mouse(900, 420));
    expectNear(whereIs(grabbed), { x: 700, y: 420 });
  });

  it('lets go of a finger that had not yet taken hold of Home, without moving the pin', () => {
    const { gestures, state } = createHost({ slideMode: true });
    const before = state.registration;
    gestures.press(finger(5, 200, 500, true));
    gestures.finish();
    expect(state.registration).toBe(before);
    expect(state.log).toEqual([]);
    expect(state.held).toBe(false);
  });
});

describe('a mouse whose release goes missing', () => {
  it('ends a slide at the first move that shows the button up, where the pointer last was with it down', () => {
    const { gestures, state, homeSpotAt, whereIs, drag, frame, framesWaiting } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    drag(mouse(500, 500, { shift: true }));
    // Still waiting for its frame when the button turns out to be up.
    gestures.move(mouse(520, 480, { shift: true }));
    gestures.move(hover(900, 100));
    expect(state.log).toEqual(['slide:start', 'change', 'change', 'change', 'final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.holds(1)).toBe(false);
    expectNear(whereIs(grabbed), { x: 520, y: 480 });
    expect(framesWaiting()).toBe(0);
    // Home no longer follows the pointer.
    gestures.move(hover(1000, 50));
    frame();
    expectNear(whereIs(grabbed), { x: 520, y: 480 });
    expect(state.log).toHaveLength(6);
  });

  it('ends a slide made in slide mode the same way', () => {
    const { gestures, state, drag } = createHost({ slideMode: true });
    gestures.press(mouse(600, 300));
    drag(mouse(700, 420));
    gestures.move(hover(710, 430));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('ends an Alt+drag turn, keeping the turn so far', () => {
    const { gestures, state, drag } = createHost();
    gestures.press(mouse(PIN.x + 200, PIN.y, { alt: true }));
    drag(mouse(PIN.x, PIN.y + 200, { alt: true }));
    expect(state.registration.rotation).toBeCloseTo(90, 6);
    gestures.move(hover(PIN.x - 200, PIN.y));
    expect(state.log).toEqual(['turn:start', 'change', 'final', 'turn:end']);
    expect(state.registration.rotation).toBeCloseTo(90, 6);
    expect(state.held).toBe(false);
  });

  it('ends a right-button turn once the right button is up, whatever else is down', () => {
    const { gestures, state, drag } = createHost();
    gestures.press(mouse(PIN.x + 200, PIN.y, { button: 2 }));
    drag(mouse(PIN.x, PIN.y + 200, { button: 2 }));
    gestures.move(mouse(PIN.x - 200, PIN.y, { buttons: 1 }));
    expect(state.log).toEqual(['turn:start', 'change', 'final', 'turn:end']);
    expect(state.held).toBe(false);
  });

  it('ends a slide when the left button comes up while the right one is still down', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    // A second button going down sends no press of its own, and the slide goes on.
    drag(mouse(400, 600, { shift: true, buttons: 3 }));
    expectNear(whereIs(grabbed), { x: 400, y: 600 });
    // Nor does the left one coming up send a release, for as long as the right is held.
    gestures.move(mouse(450, 600, { shift: true, buttons: 2 }));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expectNear(whereIs(grabbed), { x: 400, y: 600 });
  });

  it('does not watch the buttons of a finger, which has none', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost({ slideMode: true });
    gestures.press(finger(5, 200, 500, true));
    const grabbed = homeSpotAt({ x: 200, y: 500 });
    drag({ ...finger(5, 280, 540), buttons: 0 });
    expectNear(whereIs(grabbed), { x: 280, y: 540 });
    expect(state.log).toEqual(['slide:start', 'change']);
  });

  it('ends a slide made with a pen at the first move that shows it in the air, where it last was on the glass', () => {
    const { gestures, state, homeSpotAt, whereIs, drag, framesWaiting } = createHost({ slideMode: true });
    gestures.press(pen(200, 500));
    const grabbed = homeSpotAt({ x: 200, y: 500 });
    drag(pen(280, 540));
    // The lift went unheard. A pen is still heard from while it hovers.
    gestures.move(pen(700, 100, 0));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.holds(3)).toBe(false);
    expectNear(whereIs(grabbed), { x: 280, y: 540 });
    drag(pen(900, 300, 0));
    expect(framesWaiting()).toBe(0);
    expectNear(whereIs(grabbed), { x: 280, y: 540 });
  });

  it('carries a pen slide on while the pen reports another of its buttons: its barrel button, its eraser', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost({ slideMode: true });
    gestures.press(pen(200, 500));
    const grabbed = homeSpotAt({ x: 200, y: 500 });
    drag(pen(280, 540, 2));
    drag(pen(300, 560, 32));
    expectNear(whereIs(grabbed), { x: 300, y: 560 });
    expect(state.log).toEqual(['slide:start', 'change', 'change']);
    expect(state.held).toBe(true);
  });

  it('treats capture that is lost without a release as the release', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    drag(mouse(500, 500, { shift: true }));
    gestures.release(1, true);
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
    expectNear(whereIs(grabbed), { x: 500, y: 500 });
  });
});

describe('a listener that throws', () => {
  it('on the last change of a slide: the slide is over and Away is let go before the error travels on', () => {
    const { gestures, state, homeSpotAt, whereIs, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    drag(mouse(500, 500, { shift: true }));
    state.failsOn = (final) => final;
    expect(() => gestures.release(1)).toThrow('listener');
    expect(state.held).toBe(false);
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(gestures.holds(1)).toBe(false);
    // Home does not follow the pointer, and the next press is an ordinary one.
    state.failsOn = null;
    drag(hover(900, 100));
    expectNear(whereIs(grabbed), { x: 500, y: 500 });
    expect(gestures.press(mouse(700, 300))).toBe(false);
    expect(state.held).toBe(false);
  });

  it('on a move still waiting when the button comes up: the slide ends all the same', () => {
    const { gestures, state } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    gestures.move(mouse(500, 500, { shift: true }));
    state.failsOn = (final) => !final;
    expect(() => gestures.release(1)).toThrow('listener');
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.holds(1)).toBe(false);
  });

  it('on the press itself: the slide has begun, and says so, so its pointer is still captured and its release still ends it', () => {
    const { gestures, state, projectAway } = createHost();
    state.failsOn = () => true;
    expect(() => gestures.press(mouse(300, 620, { shift: true }))).toThrow('listener');
    expect(gestures.holds(1)).toBe(true);
    expectNear(projectAway(state.registration.baseAnchor), { x: 300, y: 620 });
    state.failsOn = null;
    gestures.release(1);
    expect(state.log).toEqual(['slide:start', 'change', 'final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('while an old gesture is closed by a new press: the old one is over and the new press is taken', () => {
    const { gestures, state, projectAway } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    gestures.move(mouse(400, 500, { shift: true }));
    // The release never came. The next press finds a slide with a move still waiting.
    state.failsOn = (final) => !final && state.log.length === 3;
    expect(() => gestures.press(mouse(700, 300, { shift: true }))).toThrow('listener');
    expect(state.log).toEqual(['slide:start', 'change', 'change', 'final', 'slide:end', 'slide:start', 'change']);
    expect(gestures.holds(1)).toBe(true);
    expectNear(projectAway(state.registration.baseAnchor), { x: 700, y: 300 });
    gestures.release(1);
    expect(state.held).toBe(false);
  });

  it('on the last change of a turn: the turn is over and Away is let go', () => {
    const { gestures, state, drag } = createHost();
    gestures.press(mouse(PIN.x + 200, PIN.y, { alt: true }));
    drag(mouse(PIN.x, PIN.y + 200, { alt: true }));
    state.failsOn = (final) => final;
    expect(() => gestures.release(1)).toThrow('listener');
    expect(state.log.slice(-2)).toEqual(['final', 'turn:end']);
    expect(state.held).toBe(false);
    expect(gestures.holds(1)).toBe(false);
  });

  it('on the last change of a twist: the twist is over', () => {
    const { gestures, state, frame } = createHost({ slideMode: true });
    gestures.press(finger(5, 300, 400, true));
    gestures.press(finger(6, 500, 400));
    for (const y of [330, 260, 200]) {
      gestures.move(finger(5, 300 + (400 - y) / 2, y));
      gestures.move(finger(6, 500 - (400 - y) / 2, 800 - y));
      frame();
    }
    expect(state.log).toContain('turn:start');
    state.failsOn = (final) => final;
    expect(() => gestures.release(6)).toThrow('listener');
    expect(state.log.slice(-2)).toEqual(['final', 'turn:end']);
    expect(gestures.holds(5)).toBe(false);
  });

  it('when a gesture is cut short: nothing is left in progress or held', () => {
    const { gestures, state } = createHost({ slideMode: true });
    gestures.press(mouse(600, 300));
    gestures.move(mouse(700, 420));
    state.failsOn = () => true;
    expect(() => gestures.finish()).toThrow('listener');
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
    expect(gestures.holds(1)).toBe(false);
  });
});

describe('finish, with nothing in progress', () => {
  it('still lets go of Away, so nothing can leave it locked for good', () => {
    const { gestures, state } = createHost();
    state.held = true;
    gestures.finish();
    expect(state.held).toBe(false);
    expect(state.log).toEqual([]);
  });
});

describe('the pointer a gesture is made with', () => {
  it('is held from the press to the release, and no other pointer is', () => {
    const { gestures } = createHost();
    expect(gestures.holds(1)).toBe(false);
    gestures.press(mouse(300, 620, { shift: true }));
    expect(gestures.holds(1)).toBe(true);
    expect(gestures.holds(2)).toBe(false);
    gestures.release(1);
    expect(gestures.holds(1)).toBe(false);
  });

  it('is both fingers of a twist', () => {
    const { gestures } = createHost({ slideMode: true });
    gestures.press(finger(5, 300, 400, true));
    gestures.press(finger(6, 500, 400));
    expect(gestures.holds(5)).toBe(true);
    expect(gestures.holds(6)).toBe(true);
    gestures.press(finger(7, 700, 700));
    expect(gestures.holds(5)).toBe(false);
  });
});

describe('the context menu during a gesture', () => {
  it('is kept from opening while Home is being slid: it would take the release with it', () => {
    const { gestures, drag } = createHost();
    gestures.press(mouse(300, 620, { shift: true }));
    drag(mouse(400, 600, { shift: true, buttons: 3 }));
    expect(gestures.shouldSuppressContextMenu()).toBe(true);
    gestures.release(1);
    expect(gestures.shouldSuppressContextMenu()).toBe(false);
  });

  it('is kept from opening during an Alt+drag turn, and owed nothing afterwards', () => {
    const { gestures, drag } = createHost();
    gestures.press(mouse(PIN.x + 200, PIN.y, { alt: true }));
    drag(mouse(PIN.x, PIN.y + 200, { alt: true }));
    expect(gestures.shouldSuppressContextMenu()).toBe(true);
    gestures.release(1);
    expect(gestures.shouldSuppressContextMenu()).toBe(false);
  });

  it('opens as usual for Ctrl+Alt+click, a context click on macOS that turns nothing', () => {
    const { gestures, state } = createHost();
    expect(gestures.press(mouse(500, 300, { alt: true, ctrl: true }))).toBe(false);
    expect(gestures.shouldSuppressContextMenu()).toBe(false);
    expect(state.held).toBe(false);
  });
});

describe('pointer events fed to the gestures', () => {
  type Listener = (event: FakeEvent) => void;

  /** Something to listen on. Unlike the real thing it lets a listener's error reach whoever sent the event. */
  class FakeTarget {
    private readonly listeners = new Map<string, Set<Listener>>();

    addEventListener(type: string, listener: Listener, options?: { signal?: AbortSignal }): void {
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(listener);
      options?.signal?.addEventListener('abort', () => set.delete(listener));
    }

    send(event: FakeEvent): FakeEvent {
      for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
      return event;
    }
  }

  /** As much of Away's canvas container as the binding touches. */
  class FakeElement extends FakeTarget {
    readonly captured = new Set<number>();
    getBoundingClientRect = () => ({ left: 40, top: 20 });
    setPointerCapture = (id: number) => void this.captured.add(id);
    hasPointerCapture = (id: number) => this.captured.has(id);
  }

  interface FakeEvent {
    readonly type: string;
    readonly target: unknown;
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly button: number;
    readonly buttons: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    defaultPrevented: boolean;
    preventDefault(): void;
  }

  function setUp(options: Parameters<typeof createHost>[0] = {}) {
    const host = createHost(options);
    const element = new FakeElement();
    const win = new FakeTarget();
    const unbind = bindHomeGestures(element as unknown as HTMLElement, host.gestures, win as unknown as Window);
    /** A mouse event at a stage position, with the left button down unless said otherwise. */
    const event = (type: string, x = 0, y = 0, props: Partial<FakeEvent> = {}): FakeEvent => ({
      type,
      target: element,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x + 40,
      clientY: y + 20,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...props,
    });
    const shiftPress = (x: number, y: number) => element.send(event('pointerdown', x, y, { shiftKey: true }));
    return { ...host, element, win, unbind, event, shiftPress };
  }

  it('captures the pointer of a press that belongs to Home, and reads positions from the stage corner', () => {
    const { element, shiftPress, state, projectAway } = setUp();
    shiftPress(300, 620);
    expect(element.captured.has(1)).toBe(true);
    expectNear(projectAway(state.registration.baseAnchor), { x: 300, y: 620 });
  });

  it('leaves the pointer of an ordinary press to Away', () => {
    const { element, event, state } = setUp();
    element.send(event('pointerdown', 300, 620));
    expect(element.captured.size).toBe(0);
    expect(state.held).toBe(false);
  });

  it('captures the pointer even when a listener throws on the press', () => {
    const { element, shiftPress, state } = setUp();
    state.failsOn = () => true;
    expect(() => shiftPress(300, 620)).toThrow('listener');
    expect(element.captured.has(1)).toBe(true);
  });

  it('follows moves and ends on a release that are only heard on the window', () => {
    const { win, event, shiftPress, state, homeSpotAt, whereIs, frame } = setUp();
    shiftPress(300, 620);
    const grabbed = homeSpotAt({ x: 300, y: 620 });
    win.send(event('pointermove', 500, 500, { target: null }));
    frame();
    expectNear(whereIs(grabbed), { x: 500, y: 500 });
    win.send(event('pointerup', 500, 500, { target: null, buttons: 0 }));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('ends on a move that shows the button up, wherever on the page the mouse is', () => {
    const { win, event, shiftPress, state } = setUp();
    shiftPress(300, 620);
    win.send(event('pointermove', 2000, -300, { target: null, buttons: 0 }));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('knows a pen from a finger: a slide made with one ends when the pen is seen in the air', () => {
    const { element, win, event, state, frame } = setUp({ slideMode: true });
    const pen = { pointerId: 3, pointerType: 'pen' };
    element.send(event('pointerdown', 300, 620, pen));
    win.send(event('pointermove', 380, 660, pen));
    frame();
    expect(state.log).toEqual(['slide:start', 'change']);
    win.send(event('pointermove', 700, 100, { ...pen, buttons: 0 }));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('ends when capture is lost without a release', () => {
    const { element, event, shiftPress, state } = setUp();
    shiftPress(300, 620);
    element.captured.clear();
    element.send(event('lostpointercapture'));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('is not ended by capture the canvas inside lost, nor by news of a capture taken again since', () => {
    const { element, event, shiftPress, gestures } = setUp();
    shiftPress(300, 620);
    element.send(event('lostpointercapture', 0, 0, { target: 'the canvas' }));
    element.send(event('lostpointercapture'));
    expect(gestures.holds(1)).toBe(true);
  });

  it('ends when a finger is taken away by the browser', () => {
    const { element, win, event, state } = setUp({ slideMode: true });
    const touch = { pointerId: 7, pointerType: 'touch' };
    element.send(event('pointerdown', 200, 500, touch));
    win.send(event('pointermove', 280, 540, touch));
    win.send(event('pointercancel', 280, 540, touch));
    expect(state.log.slice(-2)).toEqual(['final', 'slide:end']);
    expect(state.held).toBe(false);
  });

  it('ends when the window loses focus', () => {
    const { win, event, shiftPress, state, gestures } = setUp();
    shiftPress(300, 620);
    win.send(event('blur'));
    expect(gestures.holds(1)).toBe(false);
    expect(state.held).toBe(false);
  });

  it('keeps the context menu from opening during a gesture, wherever on the page it would open', () => {
    const { win, event, shiftPress } = setUp();
    expect(win.send(event('contextmenu', 0, 0, { target: null })).defaultPrevented).toBe(false);
    shiftPress(300, 620);
    expect(win.send(event('contextmenu', 0, 0, { target: null })).defaultPrevented).toBe(true);
    win.send(event('pointerup', 300, 620, { buttons: 0 }));
    expect(win.send(event('contextmenu', 0, 0, { target: null })).defaultPrevented).toBe(false);
  });

  it('hears nothing once unbound', () => {
    const { element, win, event, shiftPress, unbind, state } = setUp();
    unbind();
    shiftPress(300, 620);
    win.send(event('pointermove', 500, 500));
    expect(state.log).toEqual([]);
    expect(element.captured.size).toBe(0);
  });
});
