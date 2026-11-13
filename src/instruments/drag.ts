import type { ScreenPoint } from '../map/contracts';
import { distanceBetween } from './geometry';

/** Movement below which a press is still a press: a click on a handle must not nudge what it holds. */
const DRAG_SLOP_PX = 3;
/** The bit of a pointer event's `buttons` that says the left mouse button is down. */
const LEFT_HELD = 1;

export interface DragOptions {
  /** The slop for a mouse, where a handle that is also clicked needs more of it than one that is only dragged. */
  readonly mouseSlopPx?: number;
  /** The slop for a finger or a pen. A handle that is also tapped needs more: a fingertip rolls as it lifts. */
  readonly touchSlopPx?: number;
  /** The window to listen on. */
  readonly win?: Window;
}

/** How a press on a handle came to an end. */
export interface DragEnd {
  /** False when the press never left the spot, so nothing was moved. */
  readonly moved: boolean;
  /** Escape was pressed: what was moved goes back to where it was grabbed. */
  readonly cancelled: boolean;
}

export interface DragHandlers<Grab> {
  /** A press on the handle, at a stage position. Returns what the drag needs to remember, or null to ignore the press. */
  start(point: ScreenPoint): Grab | null;
  move(point: ScreenPoint, grab: Grab): void;
  /**
   * Called exactly once for every press that `start` took, however it ends: the pointer is lifted or
   * taken away by the browser, its release goes missing, the window loses focus, Escape is pressed,
   * another press arrives, or the handle is unbound.
   */
  end?(grab: Grab, how: DragEnd): void;
}

interface ActiveDrag<Grab> {
  readonly pointerId: number;
  readonly pointerType: string;
  /** The stage's top-left corner on the page. */
  readonly origin: ScreenPoint;
  readonly from: ScreenPoint;
  /** Movement from there below which nothing is moved yet. */
  readonly slop: number;
  readonly grab: Grab;
  /** Listeners that live only as long as the press. */
  readonly watch: AbortController;
  moved: boolean;
}

/**
 * Whether a move shows that the press behind a drag is over though no release was heard. A mouse
 * reports its left button up. A pen in the air reports no button at all; one that is down may report
 * any of them (its tip, its barrel button, its eraser). A finger has nothing to go by.
 */
function showsReleased(event: PointerEvent): boolean {
  if (event.pointerType === 'mouse') return (event.buttons & LEFT_HELD) === 0;
  return event.pointerType === 'pen' && event.buttons === 0;
}

/**
 * Makes `handle` draggable with mouse, pen or finger. Positions are reported in the pixels of `stage`.
 * The press is not cancelled, so where the browser focuses a control on a press it still does, and
 * the arrow keys carry on where the pointer left off. (Focusing from script instead would light the
 * keyboard focus ring under a mouse.)
 *
 * A drag that could not end would leave the handle dead to the next press, or following a pointer
 * with no button down, so its end never depends on the release being delivered to the handle. While
 * a press lasts, moves and releases are heard on the window, before anything on the page; a mouse
 * or pen seen with nothing down ends the drag where it is; so does the loss of the capture; and a new
 * press, on the handle or anywhere else, ends a drag still on record.
 */
export function bindDrag<Grab>(
  handle: HTMLElement,
  stage: HTMLElement,
  handlers: DragHandlers<Grab>,
  { mouseSlopPx = DRAG_SLOP_PX, touchSlopPx = DRAG_SLOP_PX, win = window }: DragOptions = {},
): () => void {
  // A finger on a handle drags the handle. Set on the element itself, where no rule about buttons
  // elsewhere on the page can outrank it and let the browser take the drag for a scroll.
  handle.style.touchAction = 'none';

  let active: ActiveDrag<Grab> | null = null;

  const finish = (cancelled: boolean): void => {
    if (!active) return;
    const { pointerId, grab, moved, watch } = active;
    active = null;
    try {
      watch.abort();
      handle.classList.remove('is-held');
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    } finally {
      // Last, with the drag already over: whatever this throws, nothing is left held.
      handlers.end?.(grab, { moved, cancelled });
    }
  };

  const onMove = (event: PointerEvent): void => {
    if (!active || event.pointerId !== active.pointerId) return;
    if (showsReleased(event)) {
      // The button is up and no release was heard: a menu or another window took it. The drag ends
      // where the pointer last was with the button down.
      finish(false);
      return;
    }
    const point = { x: event.clientX - active.origin.x, y: event.clientY - active.origin.y };
    if (!active.moved && distanceBetween(active.from, point) < active.slop) return;
    active.moved = true;
    handlers.move(point, active.grab);
  };

  const onEnd = (event: PointerEvent): void => {
    if (active && event.pointerId === active.pointerId) finish(false);
  };

  // Capture can be taken away without a release. Capture a new press has taken since is not this news.
  const onLostCapture = (event: PointerEvent): void => {
    if (!handle.hasPointerCapture(event.pointerId)) onEnd(event);
  };

  // A mouse press means no button was down before it, and a first finger means no finger was. A
  // drag by the same kind of pointer still on record then never heard its release.
  const onPressElsewhere = (event: PointerEvent): void => {
    if (active && event.isPrimary && event.pointerType === active.pointerType) finish(false);
  };

  const onDown = (event: PointerEvent): void => {
    // A drag still on record never heard its release, or this press could not have reached the
    // handle. It ends here, and the press is taken like any other.
    finish(false);
    // Ctrl+click is a context click on macOS, so it is left alone, like any press but the left button's.
    if (event.pointerType === 'mouse' && (event.button !== 0 || event.ctrlKey)) return;
    // Measured once per press: the stage does not move under a drag.
    const rect = stage.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    const from = { x: event.clientX - origin.x, y: event.clientY - origin.y };
    const grab = handlers.start(from);
    if (grab === null) return;

    const watch = new AbortController();
    const { signal } = watch;
    win.addEventListener(
      'keydown',
      (key) => {
        if (key.key === 'Escape') finish(true);
      },
      { capture: true, signal },
    );
    // A window that loses focus mid-drag may never hear the pointer come up.
    win.addEventListener('blur', () => finish(false), { signal });
    win.addEventListener('pointermove', onMove, { capture: true, signal });
    win.addEventListener('pointerup', onEnd, { capture: true, signal });
    win.addEventListener('pointercancel', onEnd, { capture: true, signal });
    win.addEventListener('pointerdown', onPressElsewhere, { capture: true, signal });
    // A menu that opened mid-drag would take the release of the button with it.
    win.addEventListener('contextmenu', (menu) => menu.preventDefault(), { capture: true, signal });

    const slop = event.pointerType === 'mouse' ? mouseSlopPx : touchSlopPx;
    active = { pointerId: event.pointerId, pointerType: event.pointerType, origin, from, slop, grab, watch, moved: false };
    handle.classList.add('is-held');
    try {
      // Capture keeps the moves coming when the pointer leaves the window, and keeps other controls
      // from reacting to a pointer that is only passing over them.
      handle.setPointerCapture(event.pointerId);
    } catch (error) {
      // Refused: the pointer is already gone. A drag without one would have nothing to end it.
      finish(false);
      throw error;
    }
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  handle.addEventListener('pointerdown', onDown, { signal });
  handle.addEventListener('lostpointercapture', onLostCapture, { signal });
  return () => {
    finish(false);
    listeners.abort();
  };
}
