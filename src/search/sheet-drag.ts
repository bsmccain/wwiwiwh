/**
 * Dragging a bottom sheet down with a finger to put it away. The sheet follows the finger, and on
 * release it either goes or settles back.
 */

/**
 * The finger must go down this far before the drag takes the touch from the list. It has to be less
 * than any browser's own scroll threshold: once the browser has begun a scroll, the touch is its to keep.
 */
const CLAIM_PX = 4;
/** A touch that never strays further than this is still a tap, and its click goes through. */
const TAP_SLOP_PX = 10;
const DISMISS_SHARE_OF_HEIGHT = 0.3;
const DISMISS_PX = 160;
/** A quick flick dismisses from a shorter distance. */
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 40;
/** A finger that rested this long before letting go was not flicking, whatever its speed before. */
const FLICK_STALE_MS = 100;

export type DragStart = 'undecided' | 'claim' | 'leave';

/**
 * Whether a touch that has moved by (dx, dy) is the start of a downward drag on the sheet. `atTop`
 * says the list under the finger has nothing above to scroll to; `cancelable` that the browser has
 * not already taken the touch for a scroll of its own.
 */
export function dragStart(move: { dx: number; dy: number; atTop: boolean; cancelable: boolean }): DragStart {
  const { dx, dy, atTop, cancelable } = move;
  if (Math.abs(dx) < CLAIM_PX && Math.abs(dy) < CLAIM_PX) return 'undecided';
  return dy > Math.abs(dx) && atTop && cancelable ? 'claim' : 'leave';
}

/** What a sheet does when the finger lets go after dragging it `distance` px down at `velocity` px/ms. */
export function releaseVerdict(release: { distance: number; velocity: number; sheetHeight: number }): 'dismiss' | 'settle' {
  const { distance, velocity, sheetHeight } = release;
  if (distance >= Math.min(DISMISS_PX, sheetHeight * DISMISS_SHARE_OF_HEIGHT)) return 'dismiss';
  return velocity >= FLICK_PX_PER_MS && distance >= FLICK_MIN_PX ? 'dismiss' : 'settle';
}

export interface SheetDragOptions {
  /** The sheet. Its `--sheet-drag` property carries the offset and `data-dragging` marks a drag under way. */
  readonly panel: HTMLElement;
  /** The part of the sheet that scrolls by itself; a drag that begins in it counts only while it is at its top. */
  readonly scroller: HTMLElement;
  /** False while the panel is not laid out as a sheet. */
  enabled(): boolean;
  onDismiss(): void;
  readonly signal: AbortSignal;
}

interface Drag {
  readonly touchId: number;
  readonly startX: number;
  readonly startY: number;
  readonly atTop: boolean;
  claimed: boolean;
  furthest: number;
  distance: number;
  velocity: number;
  lastY: number;
  lastTime: number;
}

export function dismissByDragging(options: SheetDragOptions): void {
  const { panel, scroller, signal } = options;
  let drag: Drag | null = null;

  const settle = (): void => {
    drag = null;
    delete panel.dataset['dragging'];
    panel.style.removeProperty('--sheet-drag');
  };

  const fingerIn = (touches: TouchList, id: number): Touch | undefined => [...touches].find((touch) => touch.identifier === id);

  panel.addEventListener(
    'touchstart',
    (event) => {
      const first = event.touches[0];
      if (!first || event.touches.length > 1 || !options.enabled()) {
        settle();
        return;
      }
      const inScroller = event.target instanceof Node && scroller.contains(event.target);
      drag = {
        touchId: first.identifier,
        startX: first.clientX,
        startY: first.clientY,
        atTop: !inScroller || scroller.scrollTop <= 0,
        claimed: false,
        furthest: 0,
        distance: 0,
        velocity: 0,
        lastY: first.clientY,
        lastTime: event.timeStamp,
      };
    },
    { passive: true, signal },
  );

  panel.addEventListener(
    'touchmove',
    (event) => {
      const current = drag;
      const finger = current && fingerIn(event.touches, current.touchId);
      if (!current || !finger) return;
      const dy = finger.clientY - current.startY;
      if (!current.claimed) {
        const start = dragStart({ dx: finger.clientX - current.startX, dy, atTop: current.atTop, cancelable: event.cancelable });
        if (start === 'leave') drag = null;
        if (start !== 'claim') return;
        current.claimed = true;
        panel.dataset['dragging'] = '';
      }
      // Keeps the list, and the page, from taking the touch as a scroll.
      if (event.cancelable) event.preventDefault();
      const elapsed = event.timeStamp - current.lastTime;
      if (elapsed > 0) current.velocity = (finger.clientY - current.lastY) / elapsed;
      current.lastY = finger.clientY;
      current.lastTime = event.timeStamp;
      current.distance = Math.max(0, dy);
      current.furthest = Math.max(current.furthest, current.distance);
      panel.style.setProperty('--sheet-drag', `${current.distance}px`);
    },
    { passive: false, signal },
  );

  panel.addEventListener(
    'touchend',
    (event) => {
      const current = drag;
      if (!current || !fingerIn(event.changedTouches, current.touchId)) return;
      settle();
      if (!current.claimed) return;
      // The finger travelled: letting go is not a tap on whatever is under it.
      if (current.furthest > TAP_SLOP_PX && event.cancelable) event.preventDefault();
      const velocity = event.timeStamp - current.lastTime > FLICK_STALE_MS ? 0 : current.velocity;
      const verdict = releaseVerdict({ distance: current.distance, velocity, sheetHeight: panel.offsetHeight });
      if (verdict === 'dismiss') options.onDismiss();
    },
    { signal },
  );

  panel.addEventListener('touchcancel', settle, { signal });
}
