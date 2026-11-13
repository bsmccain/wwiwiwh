import type { LngLat } from '../geo/types';
import type { ScreenPoint } from '../map/contracts';
import { distanceBetween } from './geometry';
import type { Sizes } from './sizes';

/** How far past the edge of its target a pointer must be seen before a resting handle takes presses again. */
const WAKE_MARGIN_PX = 8;
/** A handle drawn closer than this to where it was has not moved: its place is worked out afresh on every frame. */
const SAME_PLACE_PX = 0.5;
/** How wide a handle's round target is until the browser has laid it out: what `--target` falls back to. */
const TARGET_FALLBACK_PX = 40;

/** A pointer seen somewhere on the page: one that was just pressed, or a mouse or pen with nothing down. */
export interface Sighting {
  readonly pointer: 'mouse' | 'pen' | 'touch';
  /** It was just pressed. Otherwise it is a mouse or a pen with no button down, moving or just let go. */
  readonly pressed: boolean;
  /** Where, in stage pixels. */
  readonly point: ScreenPoint;
  /**
   * What it was seen on: the stage itself (the map, or something drawn on it), something that lies
   * over the stage there (a list, a menu, a button standing on the map), or the page beside the stage.
   */
  readonly over: 'stage' | 'cover' | 'page';
}

/**
 * Whether a handle takes the presses that land on it.
 *
 * A handle is for someone who went to it. One that came to the pointer instead (the pin after a slide
 * on the map, a trip end just clicked into place, either of them after an address was picked from a
 * list lying over it) would take the next drag begun from where the pointer happens to be, and the
 * one after that: Home, or the trip, would seem stuck to the mouse. So such a handle rests, and
 * presses on it go through to the map.
 *
 * It rests from the start (nobody has gone to it yet), and again
 *  - when something other than itself puts it somewhere (`put`), wherever the pointer is: the list
 *    or the key that did it may have the pointer lying right there;
 *  - when a pointer is seen where it is but on something that lies over it: that pointer went to
 *    the list or the menu, and lies on the handle once that is gone;
 *  - when the maps carry it under a mouse or a pen in the air that did not go to it (`drawnAt`): a
 *    turn of the wheel, a glide, a pan from the keyboard. Moved about clear of the pointer it stays
 *    awake, or it would turn away whoever goes to it straight after moving the maps;
 *  - when the maps move it at all while nobody knows where a mouse may be: none has been seen yet,
 *    or the window lost focus since. Not so while fingers are what is in use, which rest nowhere on
 *    the screen for the handle to come under.
 * It wakes when
 *  - a mouse or a pen is seen clear of it with no button down,
 *  - a press lands on the stage itself clear of it, which is the one way a finger is seen clear of
 *    it (a tap on a control or in a list says nothing of where on the maps the finger comes down
 *    next), or
 *  - the Tab key brings the keyboard's focus to it.
 * What it does itself, dragged by its own handle or moved with its own keys, never puts it to rest.
 *
 * DOM-free: `restHandle` feeds it what happens on the page.
 */
export class Rest {
  private resting = true;
  private held = false;
  private movingItself = false;
  /** Where it was last drawn, as far as its moves have been taken note of; null while it is not drawn. */
  private place: ScreenPoint | null = null;
  /** Where a mouse, or a pen in the air, was last seen; null while nobody knows where one may be. */
  private hoverAt: ScreenPoint | null = null;
  /** That pointer went onto this handle while it was awake, and has not been off it since. */
  private hoverIsOnIt = false;
  /** The pointer last seen was a finger, or a pen that was down. */
  private lastSeenInContact = false;

  /** `reach` is how far from its centre the handle's round target reaches. */
  constructor(readonly reach: () => number) {}

  isResting(): boolean {
    return this.resting;
  }

  /** Something put it somewhere else, whether or not that is where it is drawn already. */
  put(): void {
    if (!this.movesItself()) this.rest();
  }

  /** Told at every layout where it is drawn; null while it is not. */
  drawnAt(place: ScreenPoint | null): void {
    const before = this.place;
    if (!place || !before) {
      this.place = place;
      // Coming to be drawn is being put there.
      if (place) this.put();
      return;
    }
    // Measured from where it was last found to have moved, so that a slow drift adds up.
    if (distanceBetween(before, place) < SAME_PLACE_PX) return;
    this.place = place;
    if (this.resting || this.movesItself()) return;
    if (!this.hoverAt) {
      if (!this.lastSeenInContact) this.rest();
    } else if (distanceBetween(this.hoverAt, place) > this.reach()) {
      this.hoverIsOnIt = false;
    } else if (!this.hoverIsOnIt) {
      this.rest();
    }
  }

  /** A press took hold of its handle. Until it lets go, every move is the handle's own. */
  takeHold(): void {
    this.held = true;
  }

  letGo(): void {
    this.held = false;
  }

  /** Runs a move it makes itself (its arrow keys). */
  byItself(move: () => void): void {
    this.movingItself = true;
    try {
      move();
    } finally {
      this.movingItself = false;
    }
  }

  /** A pointer was seen. Returns whether that woke it or put it to rest. */
  sees({ pointer, pressed, point, over }: Sighting): boolean {
    this.lastSeenInContact = pressed && pointer !== 'mouse';
    // Where a mouse is pressed is where it stays. A pen that is down is seen in the air once it lifts.
    const hovers = pointer === 'mouse' || (pointer === 'pen' && !pressed);
    if (hovers) this.hoverAt = point;
    const place = this.place;
    if (!place) return false;
    const away = distanceBetween(point, place);
    if (this.resting) {
      if (away <= this.reach() + WAKE_MARGIN_PX || (pressed && over !== 'stage')) return false;
      this.resting = false;
      return true;
    }
    if (away > this.reach() || over === 'page') {
      if (hovers) this.hoverIsOnIt = false;
      return false;
    }
    if (over === 'cover') {
      this.rest();
      return true;
    }
    if (hovers) this.hoverIsOnIt = true;
    return false;
  }

  /** The mouse may have moved unseen: where it was last seen no longer says where it is. */
  losesSight(): void {
    this.hoverAt = null;
    this.hoverIsOnIt = false;
  }

  /** The person went to it with the keyboard. Returns whether that woke it. */
  reachedByKeyboard(): boolean {
    if (!this.resting) return false;
    this.resting = false;
    return true;
  }

  private movesItself(): boolean {
    return this.held || this.movingItself;
  }

  private rest(): void {
    this.resting = true;
    this.hoverIsOnIt = false;
  }
}

/** Whether two positions are the very same: what holds the one has not been put anywhere else. */
export function samePosition(a: LngLat | null, b: LngLat | null): boolean {
  return a === b || (a !== null && b !== null && a.lng === b.lng && a.lat === b.lat);
}

/** Someone who is told of the pointers seen on the page. */
export interface PointerWatcher {
  seen(sighting: Sighting): void;
  /** The window lost focus: a mouse may move unseen until it is next seen. */
  lost(): void;
}

/** The pointers seen on the page, for the handles that rest. */
export interface PointerWatch {
  /** Returns a function that stops the calls. */
  watch(watcher: PointerWatcher): () => void;
  destroy(): void;
}

/**
 * Watches the page for pointers. `layer` is the instruments' layer, whose pixels are the stage's, and
 * `map` the element that takes the presses on the maps under it. The layer itself takes no pointer
 * input, so everything is heard on the window (`win`), before anything on the page can stop it.
 */
export function watchPointers(layer: HTMLElement, map: HTMLElement, win: Window = window): PointerWatch {
  const watchers = new Set<PointerWatcher>();

  const tell = (event: PointerEvent, pressed: boolean): void => {
    const rect = layer.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const target = event.target as Node | null;
    const onStage = target !== null && (layer.contains(target) || map.contains(target));
    const insideStage = point.x >= 0 && point.x <= rect.width && point.y >= 0 && point.y <= rect.height;
    const sighting: Sighting = {
      pointer: event.pointerType === 'touch' ? 'touch' : event.pointerType === 'pen' ? 'pen' : 'mouse',
      pressed,
      point,
      over: onStage ? 'stage' : insideStage ? 'cover' : 'page',
    };
    for (const watcher of [...watchers]) watcher.seen(sighting);
  };
  // With a button down a mouse is dragging something, and what it drags, drawn once per frame, trails
  // it for a moment. A finger that moves is down, and one that lifts is gone.
  const tellIfNothingDown = (event: PointerEvent): void => {
    if (event.buttons === 0 && event.pointerType !== 'touch') tell(event, false);
  };
  const tellLost = (): void => {
    for (const watcher of [...watchers]) watcher.lost();
  };

  const listening = new AbortController();
  const { signal } = listening;
  win.addEventListener('pointerdown', (event) => tell(event, true), { capture: true, signal });
  win.addEventListener('pointermove', tellIfNothingDown, { capture: true, signal });
  win.addEventListener('pointerup', tellIfNothingDown, { capture: true, signal });
  win.addEventListener('blur', tellLost, { signal });

  return {
    watch(watcher) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    destroy() {
      listening.abort();
      watchers.clear();
    },
  };
}

export interface RestingHandle {
  readonly rest: Rest;
  unbind(): void;
}

/**
 * Lets `handle`, a round target centred on what it holds, rest (see `Rest`). `onChange` is called
 * when something seen on the page wakes it or puts it to rest. That it went to rest for where it was
 * put or carried shows at the layout it is told of that in, with no call.
 */
export function restHandle(handle: HTMLElement, sizes: Sizes, pointers: PointerWatch, onChange: () => void): RestingHandle {
  sizes.watch(handle);
  const rest = new Rest(() => (sizes.of(handle)?.width ?? TARGET_FALLBACK_PX) / 2);
  const stopWatching = pointers.watch({
    seen(sighting) {
      if (rest.sees(sighting)) onChange();
    },
    lost: () => rest.losesSight(),
  });
  // The Tab key comes up on whatever it moved the focus to. Focus alone would not say that the person
  // went to the handle: a menu that closes hands focus back to where it was.
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Tab' && rest.reachedByKeyboard()) onChange();
  };
  handle.addEventListener('keyup', onKeyUp);
  return {
    rest,
    unbind() {
      stopWatching();
      handle.removeEventListener('keyup', onKeyUp);
    },
  };
}
