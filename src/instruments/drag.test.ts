import { describe, expect, it } from 'vitest';
import type { ScreenPoint } from '../map/contracts';
import { bindDrag, type DragEnd } from './drag';

type Listener = (event: FakeEvent) => void;

/**
 * Something to listen on. Unlike the real thing it lets a listener's error reach whoever sent the
 * event, so a test can see it.
 */
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

/** As much of an element as a drag touches: listeners, the held class, pointer capture. */
class FakeHandle extends FakeTarget {
  readonly style = { touchAction: '' };
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
  };
  readonly captured = new Set<number>();
  refusesCapture = false;

  setPointerCapture(id: number): void {
    if (this.refusesCapture) throw new Error('no such pointer');
    this.captured.add(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
}

interface PointerProps {
  readonly pointerId?: number;
  readonly pointerType?: 'mouse' | 'pen' | 'touch';
  readonly isPrimary?: boolean;
  readonly button?: number;
  readonly buttons?: number;
  readonly ctrlKey?: boolean;
  readonly key?: string;
}

interface FakeEvent extends Required<Omit<PointerProps, 'key'>> {
  readonly type: string;
  readonly key?: string;
  readonly clientX: number;
  readonly clientY: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** A pointer or key event with only what a drag reads. The mouse is pointer 1, with its left button down. */
function event(type: string, at: ScreenPoint = { x: 0, y: 0 }, props: PointerProps = {}): FakeEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    ctrlKey: false,
    clientX: at.x,
    clientY: at.y,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...props,
  };
}

const STAGE_AT = { left: 100, top: 50 };

function setUp(options: { failOnEnd?: boolean; mouseSlopPx?: number } = {}) {
  const handle = new FakeHandle();
  const win = new FakeTarget();
  const stage = { getBoundingClientRect: () => STAGE_AT };
  const log: string[] = [];
  let grabs = 0;
  const unbind = bindDrag<number>(
    handle as unknown as HTMLElement,
    stage as unknown as HTMLElement,
    {
      start(point) {
        grabs++;
        log.push(`start ${grabs} at ${point.x},${point.y}`);
        return grabs;
      },
      move: (point, grab) => log.push(`move ${grab} to ${point.x},${point.y}`),
      end(grab, how: DragEnd) {
        log.push(`end ${grab}${how.moved ? ' moved' : ''}${how.cancelled ? ' cancelled' : ''}`);
        if (options.failOnEnd) throw new Error('listener');
      },
    },
    { win: win as unknown as Window, ...(options.mouseSlopPx === undefined ? {} : { mouseSlopPx: options.mouseSlopPx }) },
  );
  const press = (at: ScreenPoint, props?: PointerProps) => handle.send(event('pointerdown', at, props));
  /** Heard where every pointer event passes first: on the window. */
  const onWindow = (type: string, at?: ScreenPoint, props?: PointerProps) => win.send(event(type, at, props));
  const held = () => handle.classes.has('is-held');
  return { handle, win, log, unbind, press, onWindow, held };
}

describe('dragging a handle', () => {
  it('reports the drag in stage pixels, from the press to the release', () => {
    const { log, press, onWindow, held, handle } = setUp();
    press({ x: 300, y: 250 });
    expect(held()).toBe(true);
    expect(handle.captured.has(1)).toBe(true);
    onWindow('pointermove', { x: 340, y: 260 });
    onWindow('pointermove', { x: 400, y: 300 });
    onWindow('pointerup', { x: 400, y: 300 }, { buttons: 0 });
    expect(log).toEqual(['start 1 at 200,200', 'move 1 to 240,210', 'move 1 to 300,250', 'end 1 moved']);
    expect(held()).toBe(false);
    expect(handle.captured.size).toBe(0);
  });

  it('moves nothing for a press that stays within the slop', () => {
    const { log, press, onWindow } = setUp();
    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 302, y: 251 });
    onWindow('pointerup', { x: 302, y: 251 }, { buttons: 0 });
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
  });

  it('takes a wider slip of a mouse for a click where the handle asks for it, and no wider one of a finger or a pen', () => {
    const { log, press, onWindow } = setUp({ mouseSlopPx: 6 });
    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 304, y: 253 });
    onWindow('pointerup', { x: 304, y: 253 }, { buttons: 0 });
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);

    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 306, y: 250 });
    onWindow('pointerup', { x: 306, y: 250 }, { buttons: 0 });
    expect(log.slice(2)).toEqual(['start 2 at 200,200', 'move 2 to 206,200', 'end 2 moved']);

    for (const [grab, pointerType] of [
      [3, 'touch'],
      [4, 'pen'],
    ] as const) {
      const pointer = { pointerId: 7, pointerType };
      press({ x: 300, y: 250 }, pointer);
      onWindow('pointermove', { x: 304, y: 250 }, pointer);
      onWindow('pointerup', { x: 304, y: 250 }, { ...pointer, buttons: 0 });
      expect(log.slice(-3)).toEqual([`start ${grab} at 200,200`, `move ${grab} to 204,200`, `end ${grab} moved`]);
    }
  });

  it('leaves presses of other mouse buttons, and Ctrl+click, alone', () => {
    const { log, press, held } = setUp();
    press({ x: 300, y: 250 }, { button: 2, buttons: 2 });
    press({ x: 300, y: 250 }, { ctrlKey: true });
    expect(log).toEqual([]);
    expect(held()).toBe(false);
  });

  it('goes back on Escape', () => {
    const { log, press, onWindow, held } = setUp();
    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 400, y: 300 });
    onWindow('keydown', undefined, { key: 'Escape' });
    expect(log.at(-1)).toBe('end 1 moved cancelled');
    expect(held()).toBe(false);
    // The pointer is still down and still moving; the drag is over.
    onWindow('pointermove', { x: 500, y: 300 });
    onWindow('pointerup', { x: 500, y: 300 }, { buttons: 0 });
    expect(log).toHaveLength(3);
  });

  it('ends when the handle is unbound mid-drag', () => {
    const { log, press, unbind, held } = setUp();
    press({ x: 300, y: 250 });
    unbind();
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
  });
});

describe('a drag whose release goes missing', () => {
  it('ends at the first move that shows the mouse button up, without following it', () => {
    const { log, press, onWindow, held, handle } = setUp();
    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 400, y: 300 });
    onWindow('pointermove', { x: 600, y: 120 }, { buttons: 0 });
    expect(log).toEqual(['start 1 at 200,200', 'move 1 to 300,250', 'end 1 moved']);
    expect(held()).toBe(false);
    expect(handle.captured.size).toBe(0);
    onWindow('pointermove', { x: 700, y: 100 }, { buttons: 0 });
    expect(log).toHaveLength(3);
  });

  it('carries on while the left button is down along with another', () => {
    const { log, press, onWindow } = setUp();
    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 400, y: 300 }, { buttons: 3 });
    expect(log.at(-1)).toBe('move 1 to 300,250');
    // The left button comes up while the right one is still down: no release is sent for that.
    onWindow('pointermove', { x: 410, y: 300 }, { buttons: 2 });
    expect(log.at(-1)).toBe('end 1 moved');
  });

  it('ends at the first move that shows a pen in the air, which reports no button at all', () => {
    const { log, press, onWindow, held, handle } = setUp();
    const pen = { pointerId: 4, pointerType: 'pen' } as const;
    press({ x: 300, y: 250 }, pen);
    onWindow('pointermove', { x: 400, y: 300 }, pen);
    // Its lift went unheard. It hovers on.
    onWindow('pointermove', { x: 600, y: 120 }, { ...pen, buttons: 0 });
    expect(log).toEqual(['start 1 at 200,200', 'move 1 to 300,250', 'end 1 moved']);
    expect(held()).toBe(false);
    expect(handle.captured.size).toBe(0);
    onWindow('pointermove', { x: 700, y: 100 }, { ...pen, buttons: 0 });
    expect(log).toHaveLength(3);
  });

  it('carries on while a pen that is down reports another of its buttons: its barrel button, its eraser', () => {
    const { log, press, onWindow, held } = setUp();
    const pen = { pointerId: 4, pointerType: 'pen' } as const;
    press({ x: 300, y: 250 }, pen);
    onWindow('pointermove', { x: 400, y: 300 }, { ...pen, buttons: 2 });
    onWindow('pointermove', { x: 420, y: 300 }, { ...pen, buttons: 32 });
    expect(log.slice(1)).toEqual(['move 1 to 300,250', 'move 1 to 320,250']);
    expect(held()).toBe(true);
  });

  it('does not watch the buttons of a finger, which has none', () => {
    const { log, press, onWindow, held } = setUp();
    const finger = { pointerId: 7, pointerType: 'touch' } as const;
    press({ x: 300, y: 250 }, finger);
    onWindow('pointermove', { x: 400, y: 300 }, { ...finger, buttons: 0 });
    expect(log.at(-1)).toBe('move 1 to 300,250');
    expect(held()).toBe(true);
  });

  it('ends on a release that is delivered to another element', () => {
    const { log, press, onWindow, held } = setUp();
    press({ x: 300, y: 250 });
    // The window hears every release, whatever it was aimed at.
    onWindow('pointerup', { x: 300, y: 250 }, { buttons: 0 });
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
  });

  it('ends when the browser takes the pointer away', () => {
    const { log, press, onWindow } = setUp();
    press({ x: 300, y: 250 }, { pointerId: 7, pointerType: 'touch' });
    onWindow('pointercancel', undefined, { pointerId: 7, pointerType: 'touch' });
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
  });

  it('ends when the capture is lost without a release', () => {
    const { log, press, handle, held } = setUp();
    press({ x: 300, y: 250 });
    handle.captured.clear();
    handle.send(event('lostpointercapture'));
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
  });

  it('is not ended by news of a capture it has since taken again', () => {
    const { log, press, handle, held } = setUp();
    press({ x: 300, y: 250 });
    handle.send(event('lostpointercapture'));
    expect(log).toEqual(['start 1 at 200,200']);
    expect(held()).toBe(true);
  });

  it('ends when the window loses focus', () => {
    const { log, press, win, held } = setUp();
    press({ x: 300, y: 250 });
    win.send(event('blur'));
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
  });

  it('gives way to the next press: a finger whose lift was never heard does not leave the handle dead', () => {
    const { log, press, onWindow, handle } = setUp();
    press({ x: 300, y: 250 }, { pointerId: 7, pointerType: 'touch' });
    onWindow('pointermove', { x: 330, y: 250 }, { pointerId: 7, pointerType: 'touch' });
    // Finger 7 is gone and nothing said so. Another finger lands on the handle.
    press({ x: 320, y: 260 }, { pointerId: 8, pointerType: 'touch' });
    expect(log).toEqual(['start 1 at 200,200', 'move 1 to 230,200', 'end 1 moved', 'start 2 at 220,210']);
    expect(handle.captured).toEqual(new Set([8]));
    onWindow('pointermove', { x: 380, y: 260 }, { pointerId: 8, pointerType: 'touch' });
    onWindow('pointerup', { x: 380, y: 260 }, { pointerId: 8, pointerType: 'touch', buttons: 0 });
    expect(log.slice(4)).toEqual(['move 2 to 280,210', 'end 2 moved']);
  });

  it('ends at a first finger landing anywhere on the page, which says no finger was down', () => {
    const { log, press, onWindow, held } = setUp();
    press({ x: 300, y: 250 }, { pointerId: 7, pointerType: 'touch' });
    onWindow('pointerdown', { x: 900, y: 600 }, { pointerId: 8, pointerType: 'touch', isPrimary: true });
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
  });

  it('carries on when a second finger lands elsewhere, or a mouse is pressed', () => {
    const { log, press, onWindow, held } = setUp();
    press({ x: 300, y: 250 }, { pointerId: 7, pointerType: 'touch' });
    onWindow('pointerdown', { x: 900, y: 600 }, { pointerId: 8, pointerType: 'touch', isPrimary: false });
    onWindow('pointerdown', { x: 900, y: 600 }, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    expect(log).toEqual(['start 1 at 200,200']);
    expect(held()).toBe(true);
  });

  it('ends a drag still on record even for a press it does not take', () => {
    const { log, press, held } = setUp();
    press({ x: 300, y: 250 });
    // A right press reaches the handle: the left button cannot still be down.
    press({ x: 300, y: 250 }, { button: 2, buttons: 2 });
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
  });
});

describe('a drag that ends badly', () => {
  it('is over before its end is reported, whatever the report throws', () => {
    const { log, press, onWindow, held, handle } = setUp({ failOnEnd: true });
    press({ x: 300, y: 250 });
    onWindow('pointermove', { x: 400, y: 300 });
    expect(() => onWindow('pointerup', { x: 400, y: 300 }, { buttons: 0 })).toThrow('listener');
    expect(held()).toBe(false);
    expect(handle.captured.size).toBe(0);
    // Nothing follows the pointer, and the next press is a fresh drag.
    onWindow('pointermove', { x: 500, y: 300 });
    expect(log).toEqual(['start 1 at 200,200', 'move 1 to 300,250', 'end 1 moved']);
    expect(() => press({ x: 300, y: 250 })).not.toThrow();
    expect(log.at(-1)).toBe('start 2 at 200,200');
  });

  it('does not begin without the capture', () => {
    const { log, press, onWindow, held, handle } = setUp();
    handle.refusesCapture = true;
    expect(() => press({ x: 300, y: 250 })).toThrow('no such pointer');
    expect(log).toEqual(['start 1 at 200,200', 'end 1']);
    expect(held()).toBe(false);
    onWindow('pointermove', { x: 400, y: 300 });
    expect(log).toHaveLength(2);
  });
});

describe('the context menu during a drag', () => {
  it('is kept from opening, since it would take the release with it', () => {
    const { press, onWindow } = setUp();
    press({ x: 300, y: 250 });
    expect(onWindow('contextmenu').defaultPrevented).toBe(true);
  });

  it('opens as usual once the drag is over', () => {
    const { press, onWindow } = setUp();
    press({ x: 300, y: 250 });
    onWindow('pointerup', { x: 300, y: 250 }, { buttons: 0 });
    expect(onWindow('contextmenu').defaultPrevented).toBe(false);
  });
});
