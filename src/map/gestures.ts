import { screenAngle, snapRotation } from '../geo/angles';
import { normalizeDegrees, repin, rotateOverlay, type Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { ScreenPoint } from './contracts';
import { distance } from './engine-math';

/** Movement, in CSS pixels, below which a press is still a press and not a drag. */
const DRAG_SLOP_PX = 4;
/**
 * How far each of two fingers must travel round the circle through both before the twist turns Home
 * (MapLibre's own measure for a rotation). An angle would be too easy to reach with fingers close
 * together, where an ordinary pinch swings by many degrees.
 */
const TWIST_SLOP_PX = 25;
/** Once the fingers have moved this much closer together or further apart, they are pinching, and a pinch never turns Home. */
const PINCH_SPREAD_CHANGE = 0.15;
/** Closer to the pivot than this, a pointer's direction swings too wildly to steer by. */
const STEADY_RADIUS_PX = 8;

const RIGHT_BUTTON = 2;
const LEFT_BUTTON = 0;
/** The bits of a pointer event's `buttons` that say the left or the right mouse button is down. */
const LEFT_HELD = 1;
const RIGHT_HELD = 2;

/** A pointer event, reduced to what the gestures need. */
export interface PointerInput {
  readonly id: number;
  /**
   * A pen makes the gestures a finger makes. Unlike a finger it is still heard from once it is
   * lifted, hovering with no button down.
   */
  readonly kind: 'mouse' | 'pen' | 'touch';
  /** True for the first finger down while no other finger is down. */
  readonly primary: boolean;
  /** Which button the press is for (DOM numbering). Only read on presses. */
  readonly button: number;
  /** Every button that is down as of this event (the DOM's bit mask). */
  readonly buttons: number;
  readonly point: ScreenPoint;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
}

/** What the gestures need from the map pair. */
export interface GestureHost {
  getRegistration(): Registration;
  /** Applies a registration made by a gesture. `final` is false until the gesture ends. */
  setRegistration(registration: Registration, final: boolean): void;
  projectAway(position: LngLat): ScreenPoint;
  unprojectAway(point: ScreenPoint): LngLat;
  isSlideMode(): boolean;
  /** A single pointer has taken hold of Home (true) or let go (false): Away must not pan under it. */
  holdAway(held: boolean): void;
  gesture(kind: 'slide' | 'turn', phase: 'start' | 'end'): void;
  /** Runs `callback` once, before the next frame is drawn. Returns a function that calls it off. */
  beforeNextFrame(callback: () => void): () => void;
}

interface Slide {
  readonly kind: 'slide';
  readonly id: number;
  readonly by: PointerInput['kind'];
  readonly origin: ScreenPoint;
  /** Where the pointer was last seen. */
  pointer: ScreenPoint;
  /**
   * Home has been taken hold of: the slide is announced and the pin has jumped to the grabbed spot.
   * A mouse does that on the press. A finger does it once it moves or lifts, because it may yet turn
   * out to be the first finger of a pinch, and the pin would flash under it for nothing.
   */
  taken: boolean;
  moved: boolean;
}

interface Turn {
  readonly kind: 'turn';
  readonly id: number;
  readonly origin: ScreenPoint;
  pointer: ScreenPoint;
  readonly rightButton: boolean;
  /** The context menu for this press has already come up (it opens on press on macOS and Linux). */
  menuAnswered: boolean;
  /** Direction of the pointer from the pin at the last step, or null while it is too close to tell. */
  lastAngle: number | null;
  /** The rotation the pointer asks for, before squaring up. */
  wanted: number;
  started: boolean;
}

interface Twist {
  readonly kind: 'twist';
  readonly first: number;
  readonly second: number;
  lastAngle: number | null;
  /** Distance between the fingers when the second one landed, and the least it has been since. */
  readonly startSpread: number;
  minSpread: number;
  /** Degrees twisted so far while the twist is still within the slop. */
  swept: number;
  wanted: number;
  started: boolean;
  /** The fingers changed their spread before they twisted: this is a pinch, and stays one. */
  pinching: boolean;
}

/**
 * Whether a move of the pointer behind a gesture shows that its press is over, though no release was
 * heard. A mouse reports the button it pressed with as up. A pen in the air reports no button at
 * all; one that is down may report any of them (its tip, its barrel button, its eraser). A finger has
 * nothing to go by.
 */
function showsReleased(gesture: Slide | Turn, buttons: number): boolean {
  if (gesture.kind === 'turn') return (buttons & (gesture.rightButton ? RIGHT_HELD : LEFT_HELD)) === 0;
  if (gesture.by === 'mouse') return (buttons & LEFT_HELD) === 0;
  return gesture.by === 'pen' && buttons === 0;
}

/**
 * The gestures that move Home on its own: slide (the pin jumps to the grabbed spot, which then
 * follows the pointer) and turn (about the pin). DOM-free: `bindHomeGestures` feeds it pointer events.
 *
 *  - mouse: Shift+drag slides in any mode, a plain drag slides in slide mode; Alt+drag and
 *    right-button drag turn.
 *  - touch, slide mode only: one finger slides, a two-finger twist turns. A second finger always ends
 *    the slide, so a pinch (which zooms both maps) never drags Home along.
 *
 * Pointer moves arrive faster than frames are drawn. Each one is only noted, and the latest position
 * is acted on once before the next frame: every change of registration redraws Home and moves
 * whatever is drawn over the maps, which is wasted on a position nobody gets to see. Presses and
 * releases first act on any move still waiting, so a gesture ends exactly where its pointer did.
 *
 * A gesture that could not end would leave Home following the pointer and Away locked until the page
 * is reloaded, so ending never depends on one thing going right. A release that is never heard is
 * made up for by the next move of that mouse or pen that shows nothing down, and by the next press.
 * Whatever the host throws while a gesture is ended (a listener of the registration, say), the
 * gesture is over and Away is let go before the error travels on.
 */
export class HomeGestures {
  private active: Slide | Turn | Twist | null = null;
  private readonly touches = new Map<number, ScreenPoint>();
  private clickIsOurs = false;
  private turnedWithRightButton = false;
  private callOffFrame: (() => void) | null = null;

  constructor(private readonly host: GestureHost) {}

  /** A pointer went down. Returns true when the press belongs to Home and the pointer should be captured. */
  press(input: PointerInput): boolean {
    // A mouse press means no button was down before it, and a first finger means no finger was. A
    // gesture or a finger still on record then never saw its release (it happened outside the
    // window, say). Close it, or Away would stay locked.
    const stale = input.kind === 'mouse' ? this.active !== null : input.primary && this.touches.size > 0;
    try {
      if (stale) this.finish();
      else this.catchUp();
    } finally {
      // Whatever went wrong with the gesture before, this press is still heard. Any click or menu
      // still owed from an earlier press would have arrived before it.
      this.clickIsOurs = false;
      this.turnedWithRightButton = false;
      if (input.kind === 'mouse') this.pressMouse(input);
      else this.pressTouch(input);
    }
    return this.holds(input.id);
  }

  /**
   * Whether a gesture in progress is being made with this pointer, which should then be captured.
   * Unlike what `press` returns, this can still be asked after a press that threw on its way.
   */
  holds(id: number): boolean {
    const active = this.active;
    if (!active) return false;
    return active.kind === 'twist' ? id === active.first || id === active.second : id === active.id;
  }

  move(input: PointerInput): void {
    if (this.touches.has(input.id)) this.touches.set(input.id, input.point);
    const active = this.active;
    if (!active) return;
    if (active.kind === 'twist') {
      if (input.id !== active.first && input.id !== active.second) return;
    } else {
      if (input.id !== active.id) return;
      if (showsReleased(active, input.buttons)) {
        // The button is up and no release was heard: a menu or another window took it. The gesture
        // ends where the pointer last was with the button down, not where it has wandered since.
        this.release(input.id);
        return;
      }
      active.pointer = input.point;
    }
    this.callOffFrame ??= this.host.beforeNextFrame(() => {
      this.callOffFrame = null;
      this.follow();
    });
  }

  /** A pointer was lifted, or (`cancelled`) taken away by the browser. */
  release(id: number, cancelled = false): void {
    try {
      this.catchUp();
    } finally {
      this.touches.delete(id);
      const active = this.active;
      if (active?.kind === 'twist') {
        if (id === active.first || id === active.second) this.endTwist(active);
      } else if (active && id === active.id) {
        if (active.kind === 'turn') this.endTurn(active);
        // A finger that lifts without having moved is a tap: it puts the pin there. One the browser took away is not.
        else if (active.taken || !cancelled) this.endSlide(active);
        else this.dropSlide();
      }
    }
  }

  /**
   * Ends whatever is in progress, keeping what it did. For when its pointers can no longer be
   * trusted. Away is let go whether or not a gesture was on record, so nothing can outlast this.
   */
  finish(): void {
    try {
      this.catchUp();
    } finally {
      const active = this.active;
      this.touches.clear();
      try {
        if (active?.kind === 'twist') this.endTwist(active);
        else if (active?.kind === 'turn') this.endTurn(active);
        else if (active?.taken) this.endSlide(active);
      } finally {
        this.active = null;
        this.host.holdAway(false);
      }
    }
  }

  /**
   * Whether to suppress the context menu that is about to open. Never one during a gesture: the menu
   * would take the release of the button with it, and the gesture would not hear that it ended.
   * (Where the menu opens on press, macOS and Linux, that is every right-drag from its first
   * moment.) Where it opens on release, the one after a right-drag that turned Home.
   */
  shouldSuppressContextMenu(): boolean {
    const active = this.active;
    if (active) {
      if (active.kind === 'turn' && active.rightButton) active.menuAnswered = true;
      return true;
    }
    const turned = this.turnedWithRightButton;
    this.turnedWithRightButton = false;
    return turned;
  }

  /** Whether the click that just arrived ends a press that slid or turned Home. Asks once per click. */
  claimsClick(): boolean {
    const claimed = this.clickIsOurs;
    this.clickIsOurs = false;
    return claimed;
  }

  /** Acts now on a pointer move that was waiting for the next frame. */
  private catchUp(): void {
    if (!this.callOffFrame) return;
    this.callOffFrame();
    this.callOffFrame = null;
    this.follow();
  }

  /** Brings Home to where the pointers of the gesture in progress are now. */
  private follow(): void {
    const active = this.active;
    if (active?.kind === 'slide') this.slide(active);
    else if (active?.kind === 'turn') this.turn(active);
    else if (active) this.twist(active);
  }

  private pressMouse(input: PointerInput): void {
    // Ctrl+click is a context click on macOS, so it is left alone, with Alt or Shift as without.
    const plainLeft = input.button === LEFT_BUTTON && !input.ctrl;
    if (input.button === RIGHT_BUTTON || (plainLeft && input.alt)) {
      this.active = {
        kind: 'turn',
        id: input.id,
        origin: input.point,
        pointer: input.point,
        rightButton: input.button === RIGHT_BUTTON,
        menuAnswered: false,
        lastAngle: this.angleFromPin(input.point),
        wanted: this.host.getRegistration().rotation,
        started: false,
      };
      this.host.holdAway(true);
    } else if (plainLeft && (input.shift || this.host.isSlideMode())) {
      const slide = this.beginSlide(input);
      this.host.setRegistration(this.take(slide), false);
    }
  }

  private pressTouch(input: PointerInput): void {
    this.touches.set(input.id, input.point);
    if (!this.host.isSlideMode()) return;

    if (this.touches.size === 1) {
      if (!this.active) this.beginSlide(input);
      return;
    }
    const active = this.active;
    if (active?.kind === 'twist') {
      // A third finger: no longer a twist.
      this.endTwist(active);
      return;
    }
    if (this.touches.size !== 2) return;
    if (active) {
      if (active.kind !== 'slide' || !this.touches.has(active.id)) return;
      // The first finger of a pinch or of a twist: Home stays as it is, or where that finger had slid it.
      if (active.taken) this.endSlide(active);
      else this.dropSlide();
    }
    const [first, second] = [...this.touches.keys()] as [number, number];
    const spread = this.spreadBetweenFingers(first, second);
    this.active = {
      kind: 'twist',
      first,
      second,
      lastAngle: this.angleBetweenFingers(first, second),
      startSpread: spread,
      minSpread: spread,
      swept: 0,
      wanted: this.host.getRegistration().rotation,
      started: false,
      pinching: false,
    };
  }

  private beginSlide(input: PointerInput): Slide {
    const slide: Slide = {
      kind: 'slide',
      id: input.id,
      by: input.kind,
      origin: input.point,
      pointer: input.point,
      taken: false,
      moved: false,
    };
    this.active = slide;
    this.host.holdAway(true);
    return slide;
  }

  /** Takes hold of Home: announces the slide, and returns the registration with the pin moved to the spot that was pressed. */
  private take(slide: Slide): Registration {
    slide.taken = true;
    this.host.gesture('slide', 'start');
    return repin(this.host.getRegistration(), this.host.unprojectAway(slide.origin));
  }

  private slide(slide: Slide): void {
    if (!slide.moved && distance(slide.origin, slide.pointer) <= DRAG_SLOP_PX) return;
    slide.moved = true;
    const taken = slide.taken ? this.host.getRegistration() : this.take(slide);
    // The pin is the grabbed spot, so pinning it under the pointer keeps that spot under the pointer.
    this.host.setRegistration({ ...taken, baseAnchor: this.host.unprojectAway(slide.pointer) }, false);
  }

  private endSlide(slide: Slide): void {
    this.active = null;
    this.clickIsOurs = true;
    try {
      this.host.setRegistration(slide.taken ? this.host.getRegistration() : this.take(slide), true);
    } finally {
      this.letGo('slide');
    }
  }

  /** Unlocks Away and announces the end of a gesture; the one is done whatever the other throws. */
  private letGo(announced: 'slide' | 'turn' | null): void {
    try {
      this.host.holdAway(false);
    } finally {
      if (announced) this.host.gesture(announced, 'end');
    }
  }

  /** Lets go of a press that never took hold of Home, leaving no trace of it. */
  private dropSlide(): void {
    this.active = null;
    this.host.holdAway(false);
  }

  private turn(turn: Turn): void {
    if (!turn.started) {
      if (distance(turn.origin, turn.pointer) <= DRAG_SLOP_PX) return;
      turn.started = true;
      this.host.gesture('turn', 'start');
    }
    const angle = this.angleFromPin(turn.pointer);
    if (angle !== null && turn.lastAngle !== null) this.turnBy(turn, angle - turn.lastAngle);
    turn.lastAngle = angle;
  }

  private endTurn(turn: Turn): void {
    this.active = null;
    try {
      if (turn.started) {
        this.clickIsOurs = true;
        this.turnedWithRightButton = turn.rightButton && !turn.menuAnswered;
        this.host.setRegistration(this.host.getRegistration(), true);
      }
    } finally {
      this.letGo(turn.started ? 'turn' : null);
    }
  }

  private twist(twist: Twist): void {
    const angle = this.angleBetweenFingers(twist.first, twist.second);
    const last = twist.lastAngle;
    twist.lastAngle = angle;
    if (angle === null || last === null) return;
    const step = normalizeDegrees(angle - last);
    if (twist.started) {
      this.turnBy(twist, step);
      return;
    }
    if (twist.pinching) return;
    const spread = this.spreadBetweenFingers(twist.first, twist.second);
    if (Math.abs(spread - twist.startSpread) > PINCH_SPREAD_CHANGE * twist.startSpread) {
      twist.pinching = true;
      return;
    }
    twist.minSpread = Math.min(twist.minSpread, spread);
    twist.swept += step;
    const travelled = ((Math.abs(twist.swept) * Math.PI) / 180) * (twist.minSpread / 2);
    if (travelled <= TWIST_SLOP_PX) return;
    // The slop itself is not turned: Home starts from where it was, without a jump.
    twist.started = true;
    this.host.gesture('turn', 'start');
  }

  private endTwist(twist: Twist): void {
    this.active = null;
    if (!twist.started) return;
    try {
      this.host.setRegistration(this.host.getRegistration(), true);
    } finally {
      this.host.gesture('turn', 'end');
    }
  }

  private turnBy(turning: Turn | Twist, stepDegrees: number): void {
    turning.wanted = normalizeDegrees(turning.wanted + normalizeDegrees(stepDegrees));
    const registration = this.host.getRegistration();
    const delta = normalizeDegrees(snapRotation(turning.wanted) - registration.rotation);
    this.host.setRegistration(rotateOverlay(registration, delta), false);
  }

  /** Works with the pin off screen too: its stage position is simply outside the stage. */
  private angleFromPin(point: ScreenPoint): number | null {
    const pin = this.host.projectAway(this.host.getRegistration().baseAnchor);
    return distance(pin, point) < STEADY_RADIUS_PX ? null : screenAngle(pin, point);
  }

  private angleBetweenFingers(first: number, second: number): number | null {
    const a = this.touches.get(first);
    const b = this.touches.get(second);
    if (!a || !b || distance(a, b) < STEADY_RADIUS_PX) return null;
    return screenAngle(a, b);
  }

  private spreadBetweenFingers(first: number, second: number): number {
    const a = this.touches.get(first);
    const b = this.touches.get(second);
    return a && b ? distance(a, b) : 0;
  }
}

/**
 * Feeds pointer events on `element` (Away's canvas container) to the gestures. Presses are read in
 * the capture phase, ahead of MapLibre's own mouse and touch listeners, so Away's drag-pan is
 * already switched off by the time MapLibre sees the press. `win` is the window the element is in.
 * Returns a function that unbinds.
 */
export function bindHomeGestures(element: HTMLElement, gestures: HomeGestures, win: Window = window): () => void {
  // Measured once per press: a layout read on every pointer move would be wasted work.
  let origin = { left: 0, top: 0 };

  const read = (event: PointerEvent): PointerInput => ({
    id: event.pointerId,
    kind: event.pointerType === 'mouse' ? 'mouse' : event.pointerType === 'pen' ? 'pen' : 'touch',
    primary: event.isPrimary,
    button: event.button,
    buttons: event.buttons,
    point: { x: event.clientX - origin.left, y: event.clientY - origin.top },
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
  });

  const onDown = (event: PointerEvent): void => {
    const rect = element.getBoundingClientRect();
    origin = { left: rect.left, top: rect.top };
    try {
      gestures.press(read(event));
    } finally {
      // Capture keeps the moves coming when the pointer leaves the stage or crosses a control. Asked
      // of the gestures and not taken from what `press` returned: a press that threw on its way may
      // have taken hold of Home all the same.
      if (gestures.holds(event.pointerId)) element.setPointerCapture(event.pointerId);
    }
  };
  const onMove = (event: PointerEvent): void => gestures.move(read(event));
  const onUp = (event: PointerEvent): void => gestures.release(event.pointerId, event.type === 'pointercancel');
  // Capture that is taken away without a release (a menu or another window swallowed it) is one all
  // the same. Capture a new press has taken since is not this news.
  const onLostCapture = (event: PointerEvent): void => {
    if (event.target === element && !element.hasPointerCapture(event.pointerId)) gestures.release(event.pointerId, true);
  };
  const onContextMenu = (event: MouseEvent): void => {
    if (gestures.shouldSuppressContextMenu()) event.preventDefault();
  };
  // A button released while another window has the focus never reports back.
  const onBlur = (): void => gestures.finish();

  const listeners = new AbortController();
  const { signal } = listeners;
  element.addEventListener('pointerdown', onDown, { capture: true, signal });
  element.addEventListener('lostpointercapture', onLostCapture, { signal });
  // The rest is heard on the window, before anything on the page, because a slide keeps the pin (a
  // handle of its own) right under the pointer, and without capture that is where events would go.
  // A release then ends the gesture whichever element it is delivered to; so does a mouse or pen seen
  // with nothing down, should the release never come; and the menu is answered wherever it would open.
  win.addEventListener('pointermove', onMove, { capture: true, signal });
  win.addEventListener('pointerup', onUp, { capture: true, signal });
  win.addEventListener('pointercancel', onUp, { capture: true, signal });
  win.addEventListener('contextmenu', onContextMenu, { capture: true, signal });
  win.addEventListener('blur', onBlur, { signal });
  return () => listeners.abort();
}
