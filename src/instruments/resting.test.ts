import { describe, expect, it } from 'vitest';
import type { ScreenPoint } from '../map/contracts';
import { Rest, restHandle, samePosition, watchPointers, type PointerWatch, type PointerWatcher, type Sighting } from './resting';
import type { Sizes } from './sizes';

/** A round target 40 px across. */
const REACH = 20;
const HERE: ScreenPoint = { x: 700, y: 400 };
/** Inside the target, and just inside and just outside the margin beyond it. */
const ON_IT: ScreenPoint = { x: 706, y: 396 };
const NEARLY_CLEAR: ScreenPoint = { x: 728, y: 400 };
const CLEAR: ScreenPoint = { x: 729, y: 400 };
const FAR: ScreenPoint = { x: 300, y: 200 };

type Over = Sighting['over'];

/** A mouse or a pen with no button down. */
function hover(point: ScreenPoint, pointer: 'mouse' | 'pen' = 'mouse', over: Over = 'stage'): Sighting {
  return { pointer, pressed: false, point, over };
}

function press(point: ScreenPoint, pointer: Sighting['pointer'] = 'mouse', over: Over = 'stage'): Sighting {
  return { pointer, pressed: true, point, over };
}

/** A handle drawn at `at`. */
function drawn(at: ScreenPoint = HERE): Rest {
  const rest = new Rest(() => REACH);
  rest.drawnAt(at);
  return rest;
}

/** A handle someone went to with the mouse, which now hovers on it. */
function wokenAndHoveredOn(): Rest {
  const rest = drawn();
  rest.sees(hover(FAR));
  rest.sees(hover(ON_IT));
  return rest;
}

/** A handle that a finger woke by touching the stage clear of it. */
function wokenByFinger(): Rest {
  const rest = drawn();
  rest.sees(press(FAR, 'touch'));
  return rest;
}

describe('a handle nobody has gone to yet', () => {
  it('rests from the start: the pointer may be lying on it when the page opens', () => {
    expect(drawn().isResting()).toBe(true);
  });

  it('wakes when a mouse is seen clear of it with no button down', () => {
    const rest = drawn();
    expect(rest.sees(hover(CLEAR))).toBe(true);
    expect(rest.isResting()).toBe(false);
  });

  it('stays at rest while the mouse is on it, or within 8 px of its edge', () => {
    const rest = drawn();
    expect(rest.sees(hover(ON_IT))).toBe(false);
    expect(rest.sees(hover(NEARLY_CLEAR))).toBe(false);
    expect(rest.isResting()).toBe(true);
  });

  it('says only once that it woke', () => {
    const rest = drawn();
    expect(rest.sees(hover(FAR))).toBe(true);
    expect(rest.sees(hover(FAR))).toBe(false);
  });

  it('wakes for a pen in the air as for a mouse', () => {
    const rest = drawn();
    expect(rest.sees(hover(CLEAR, 'pen'))).toBe(true);
  });

  it('wakes for a mouse seen clear of it over a control or a list, not only over the stage', () => {
    expect(drawn().sees(hover(FAR, 'mouse', 'cover'))).toBe(true);
    expect(drawn().sees(hover(FAR, 'mouse', 'page'))).toBe(true);
  });

  it('wakes when the keyboard goes to it', () => {
    const rest = drawn();
    expect(rest.reachedByKeyboard()).toBe(true);
    expect(rest.isResting()).toBe(false);
    expect(rest.reachedByKeyboard()).toBe(false);
  });

  it('cannot be woken while it is not drawn', () => {
    const rest = new Rest(() => REACH);
    expect(rest.sees(hover(FAR))).toBe(false);
    rest.drawnAt(HERE);
    rest.drawnAt(null);
    expect(rest.sees(hover(FAR))).toBe(false);
    expect(rest.isResting()).toBe(true);
  });
});

describe('a handle that is put somewhere', () => {
  it('rests, though it is drawn where it was: a spot picked while the pin is in the middle of the view', () => {
    const rest = wokenAndHoveredOn();
    rest.put();
    rest.drawnAt(HERE);
    expect(rest.isResting()).toBe(true);
    // The mouse stirs where it lies, on the handle: that is not going to it.
    expect(rest.sees(hover(ON_IT))).toBe(false);
  });

  it('wakes once the mouse has been seen clear of where it is drawn now', () => {
    const rest = wokenAndHoveredOn();
    rest.put();
    rest.drawnAt(FAR);
    expect(rest.sees(hover({ x: FAR.x + 10, y: FAR.y }))).toBe(false);
    // Where it used to be is clear of it now.
    expect(rest.sees(hover(HERE))).toBe(true);
  });

  it('rests after a press that woke it, when that press goes on to put it under the pointer: a slide on the map', () => {
    const rest = drawn();
    expect(rest.sees(press(FAR))).toBe(true);
    rest.put();
    rest.drawnAt(FAR);
    expect(rest.isResting()).toBe(true);
    // The button comes up where the handle now is, and the next drag begins there.
    expect(rest.sees(hover(FAR))).toBe(false);
    expect(rest.sees(press(FAR))).toBe(false);
  });
});

describe('a handle that the maps move', () => {
  it('rests when they carry it under a mouse that has not stirred', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.drawnAt({ x: FAR.x + 12, y: FAR.y - 9 });
    expect(rest.isResting()).toBe(true);
    // The mouse stirs where it lies: that is not going to the handle.
    expect(rest.sees(hover({ x: FAR.x + 2, y: FAR.y }))).toBe(false);
  });

  it('stays awake when they move it about clear of the mouse: whoever goes to it next finds it awake', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.drawnAt({ x: HERE.x + 60, y: HERE.y - 40 });
    rest.drawnAt({ x: HERE.x + 90, y: HERE.y - 70 });
    expect(rest.isResting()).toBe(false);
  });

  it('stays awake while it is still gliding as the mouse arrives on it', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    // The mouse comes up to it, just outside its target, while a glide still moves it a little.
    rest.sees(hover({ x: HERE.x + 24, y: HERE.y }));
    rest.drawnAt({ x: HERE.x - 1, y: HERE.y });
    expect(rest.isResting()).toBe(false);
    rest.sees(hover({ x: HERE.x + 9, y: HERE.y }));
    rest.drawnAt({ x: HERE.x - 2, y: HERE.y });
    expect(rest.isResting()).toBe(false);
  });

  it('is not moved by a frame that draws it where it was', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.sees(hover({ x: HERE.x + 20.2, y: HERE.y }));
    rest.drawnAt({ x: HERE.x + 0.3, y: HERE.y });
    expect(rest.isResting()).toBe(false);
  });

  it('adds up a drift too slow to show in any one frame', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.sees(hover({ x: HERE.x + 20.2, y: HERE.y }));
    for (let step = 1; step <= 3; step++) rest.drawnAt({ x: HERE.x + 0.3 * step, y: HERE.y });
    expect(rest.isResting()).toBe(true);
  });

  it('rests when it comes to be drawn again after a while away: that is being put there', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.drawnAt(null);
    rest.drawnAt({ x: 900, y: 700 });
    expect(rest.isResting()).toBe(true);
  });
});

describe('a handle that the maps move while nobody knows where the mouse is', () => {
  it('rests at any move before a pointer has ever been seen', () => {
    const rest = drawn();
    rest.reachedByKeyboard();
    rest.drawnAt({ x: HERE.x + 60, y: HERE.y });
    expect(rest.isResting()).toBe(true);
  });

  it('rests at any move once the window has lost focus: the mouse may have moved unseen', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.losesSight();
    rest.drawnAt({ x: HERE.x + 60, y: HERE.y });
    expect(rest.isResting()).toBe(true);
    // It is found lying on the handle when it is next heard from.
    expect(rest.sees(hover({ x: HERE.x + 64, y: HERE.y }))).toBe(false);
    expect(rest.sees(hover(FAR))).toBe(true);
  });

  it('goes by where the mouse is again once it has been seen again', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.losesSight();
    rest.sees(hover(FAR));
    rest.drawnAt({ x: HERE.x + 60, y: HERE.y });
    expect(rest.isResting()).toBe(false);
  });
});

describe('a handle the mouse went to', () => {
  it('stays awake when the maps move it a little under the pointer: a turn of the wheel there', () => {
    const rest = wokenAndHoveredOn();
    rest.drawnAt({ x: HERE.x - 8, y: HERE.y + 5 });
    expect(rest.isResting()).toBe(false);
  });

  it('rests once the maps have carried it out from under the pointer and back', () => {
    const rest = wokenAndHoveredOn();
    rest.drawnAt({ x: HERE.x - 40, y: HERE.y + 25 });
    expect(rest.isResting()).toBe(false);
    rest.drawnAt(HERE);
    expect(rest.isResting()).toBe(true);
  });

  it('rests all the same when something puts it elsewhere', () => {
    const rest = wokenAndHoveredOn();
    rest.put();
    expect(rest.isResting()).toBe(true);
  });

  it('is not counted as gone to by a mouse on the page beside the stage, a few pixels from it', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    expect(rest.sees(hover(ON_IT, 'mouse', 'page'))).toBe(false);
    expect(rest.isResting()).toBe(false);
    rest.drawnAt({ x: HERE.x - 8, y: HERE.y + 5 });
    expect(rest.isResting()).toBe(true);
  });

  it('counts a mouse that pressed it and let it go where it was dragged to', () => {
    const rest = wokenAndHoveredOn();
    rest.sees(press(ON_IT));
    rest.takeHold();
    rest.drawnAt({ x: 900, y: 600 });
    rest.sees(hover({ x: 906, y: 596 }));
    rest.letGo();
    rest.drawnAt({ x: 897, y: 602 });
    expect(rest.isResting()).toBe(false);
  });
});

describe('a handle with something lying over it', () => {
  it('rests when the mouse is seen there, on a list or a menu: the mouse went to that, and lies on the handle once it is gone', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    expect(rest.sees(hover(ON_IT, 'mouse', 'cover'))).toBe(true);
    expect(rest.isResting()).toBe(true);
    // The list is gone, nothing was put anywhere, and the next drag begins right there.
    expect(rest.sees(hover(ON_IT))).toBe(false);
    expect(rest.sees(press(ON_IT))).toBe(false);
    expect(rest.isResting()).toBe(true);
  });

  it('rests when a finger taps there, on a row or a button', () => {
    const rest = wokenByFinger();
    expect(rest.sees(press(ON_IT, 'touch', 'cover'))).toBe(true);
    expect(rest.isResting()).toBe(true);
  });

  it('stays awake while the mouse is on a list or a menu beside it', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    expect(rest.sees(hover(NEARLY_CLEAR, 'mouse', 'cover'))).toBe(false);
    expect(rest.isResting()).toBe(false);
  });
});

describe('what a handle does itself', () => {
  it('does not put it to rest while a press has hold of it', () => {
    const rest = wokenAndHoveredOn();
    rest.takeHold();
    rest.put();
    rest.drawnAt(FAR);
    rest.put();
    rest.drawnAt({ x: 500, y: 500 });
    expect(rest.isResting()).toBe(false);
    rest.letGo();
    expect(rest.isResting()).toBe(false);
  });

  it('does not put it to rest when it moves with its own keys', () => {
    const rest = drawn();
    rest.reachedByKeyboard();
    rest.byItself(() => {
      rest.put();
      rest.drawnAt({ x: HERE.x + 16, y: HERE.y });
    });
    expect(rest.isResting()).toBe(false);
  });

  it('rests at the next move that is not its own', () => {
    const rest = drawn();
    rest.reachedByKeyboard();
    rest.byItself(() => rest.drawnAt({ x: HERE.x + 16, y: HERE.y }));
    rest.takeHold();
    rest.letGo();
    rest.put();
    expect(rest.isResting()).toBe(true);
  });

  it('is over even when the move throws', () => {
    const rest = drawn();
    rest.reachedByKeyboard();
    expect(() =>
      rest.byItself(() => {
        throw new Error('listener');
      }),
    ).toThrow('listener');
    rest.put();
    expect(rest.isResting()).toBe(true);
  });
});

describe('fingers', () => {
  it('wake it only by going down on the stage clear of it', () => {
    const rest = drawn();
    expect(rest.sees(press(ON_IT, 'touch'))).toBe(false);
    expect(rest.sees(press(NEARLY_CLEAR, 'touch'))).toBe(false);
    expect(rest.sees(press(CLEAR, 'touch'))).toBe(true);
  });

  it('do not wake it with a tap on a control, a menu or a list, however far from it', () => {
    const rest = drawn();
    expect(rest.sees(press(FAR, 'touch', 'cover'))).toBe(false);
    expect(rest.sees(press(FAR, 'touch', 'page'))).toBe(false);
    expect(rest.isResting()).toBe(true);
  });

  it('leave it awake however they move the maps: a finger rests nowhere for it to come under', () => {
    const rest = wokenByFinger();
    rest.drawnAt({ x: HERE.x + 60, y: HERE.y - 90 });
    rest.drawnAt(FAR);
    expect(rest.isResting()).toBe(false);
  });

  it('still find it at rest after it was put somewhere: a slide, or an address tapped in a list', () => {
    const rest = wokenByFinger();
    rest.put();
    rest.drawnAt(FAR);
    expect(rest.isResting()).toBe(true);
    // Drags from where the finger lifted, on the handle, move the maps and the handle with them.
    for (let drag = 1; drag <= 2; drag++) {
      const at = { x: FAR.x + 50 * (drag - 1), y: FAR.y };
      expect(rest.sees(press(at, 'touch'))).toBe(false);
      rest.drawnAt({ x: at.x + 50, y: at.y });
      expect(rest.isResting()).toBe(true);
    }
    // A tap on Done says nothing of the stage. A touch elsewhere on the stage does.
    expect(rest.sees(press({ x: 40, y: 800 }, 'touch', 'page'))).toBe(false);
    expect(rest.sees(press(HERE, 'touch'))).toBe(true);
  });

  it('do not hide a mouse lying where they carry the handle', () => {
    const rest = drawn();
    rest.sees(hover(FAR));
    rest.sees(press({ x: 500, y: 600 }, 'touch'));
    rest.drawnAt({ x: FAR.x + 5, y: FAR.y });
    expect(rest.isResting()).toBe(true);
  });
});

describe('a pen', () => {
  it('is a finger while it is down: it wakes the handle by a press on the stage, and moves the maps without resting it', () => {
    const rest = drawn();
    expect(rest.sees(press(FAR, 'pen', 'page'))).toBe(false);
    expect(rest.sees(press(FAR, 'pen'))).toBe(true);
    rest.drawnAt({ x: FAR.x + 4, y: FAR.y });
    expect(rest.isResting()).toBe(false);
  });

  it('is a mouse once it is seen in the air', () => {
    const rest = drawn();
    rest.sees(press(FAR, 'pen'));
    rest.sees(hover(FAR, 'pen'));
    rest.drawnAt({ x: FAR.x + 4, y: FAR.y });
    expect(rest.isResting()).toBe(true);
  });
});

describe('a press of the mouse', () => {
  it('wakes the handle when it lands on the stage clear of it', () => {
    const rest = drawn();
    expect(rest.sees(press(CLEAR))).toBe(true);
  });

  it('says where the mouse is, as its moves with nothing down do', () => {
    const rest = drawn();
    rest.sees(press(FAR, 'mouse', 'page'));
    rest.sees(hover({ x: 100, y: 100 }));
    rest.sees(press(FAR));
    rest.drawnAt({ x: FAR.x + 4, y: FAR.y });
    expect(rest.isResting()).toBe(true);
  });
});

describe('telling whether a handle was put elsewhere', () => {
  it('goes by the position, not by the object that carries it', () => {
    expect(samePosition({ lng: -0.1276, lat: 51.5073 }, { lng: -0.1276, lat: 51.5073 })).toBe(true);
    expect(samePosition({ lng: -0.1276, lat: 51.5073 }, { lng: -0.1276, lat: 51.5074 })).toBe(false);
    expect(samePosition(null, null)).toBe(true);
    expect(samePosition(null, { lng: 0, lat: 0 })).toBe(false);
  });
});

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  readonly type: string;
  readonly target: unknown;
  readonly pointerType: string;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly key?: string;
}

class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener, options?: { signal?: AbortSignal }): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
    options?.signal?.addEventListener('abort', () => set.delete(listener));
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(event: FakeEvent): void {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
  }
}

/** An element that contains the things it is given, and has a box on the page. */
class FakeElement extends FakeTarget {
  constructor(
    private readonly inside: readonly unknown[] = [],
    private readonly box = { left: 0, top: 0, width: 0, height: 0 },
  ) {
    super();
  }

  contains(other: unknown): boolean {
    return other === this || this.inside.includes(other);
  }

  getBoundingClientRect() {
    return this.box;
  }
}

describe('watching the page for pointers', () => {
  function setUp() {
    const handle = new FakeElement();
    const canvas = new FakeElement();
    const button = new FakeElement();
    const layer = new FakeElement([handle], { left: 100, top: 50, width: 800, height: 600 });
    const map = new FakeElement([canvas]);
    const win = new FakeTarget();
    const watch = watchPointers(layer as unknown as HTMLElement, map as unknown as HTMLElement, win as unknown as Window);
    const seen: Sighting[] = [];
    let losses = 0;
    const stop = watch.watch({ seen: (sighting) => void seen.push(sighting), lost: () => void losses++ });
    const send = (type: string, target: unknown, props: Partial<FakeEvent> = {}): void =>
      win.send({ type, target, pointerType: 'mouse', buttons: 0, clientX: 400, clientY: 250, ...props });
    return { handle, canvas, button, watch, seen, stop, send, losses: () => losses };
  }

  it('reports a press of any pointer, in stage pixels, and what it landed on', () => {
    const { canvas, handle, button, seen, send } = setUp();
    send('pointerdown', canvas, { buttons: 1 });
    send('pointerdown', handle, { pointerType: 'touch', buttons: 1 });
    send('pointerdown', button, { pointerType: 'pen', buttons: 1 });
    expect(seen).toEqual([
      { pointer: 'mouse', pressed: true, point: { x: 300, y: 200 }, over: 'stage' },
      { pointer: 'touch', pressed: true, point: { x: 300, y: 200 }, over: 'stage' },
      { pointer: 'pen', pressed: true, point: { x: 300, y: 200 }, over: 'cover' },
    ]);
  });

  it('tells a control that stands over the stage from one beside it', () => {
    const { button, seen, send } = setUp();
    send('pointermove', button, { clientX: 900, clientY: 650 });
    send('pointermove', button, { clientX: 901, clientY: 650 });
    send('pointermove', button, { clientX: 500, clientY: 49 });
    expect(seen.map(({ over }) => over)).toEqual(['cover', 'page', 'page']);
  });

  it('reports a mouse or a pen that moves, or is let go, with nothing down', () => {
    const { canvas, button, seen, send } = setUp();
    send('pointermove', button);
    send('pointermove', canvas, { pointerType: 'pen' });
    send('pointerup', canvas);
    expect(seen.map(({ pointer, pressed, over }) => [pointer, pressed, over])).toEqual([
      ['mouse', false, 'cover'],
      ['pen', false, 'stage'],
      ['mouse', false, 'stage'],
    ]);
  });

  it('says nothing of a pointer that moves with a button down, nor of a finger that moves or lifts', () => {
    const { canvas, seen, send } = setUp();
    send('pointermove', canvas, { buttons: 1 });
    send('pointerup', canvas, { buttons: 2 });
    send('pointermove', canvas, { pointerType: 'touch', buttons: 1 });
    send('pointerup', canvas, { pointerType: 'touch' });
    expect(seen).toEqual([]);
  });

  it('says when the window loses focus: from then on a mouse may move unseen', () => {
    const { send, seen, losses } = setUp();
    send('blur', null);
    expect(losses()).toBe(1);
    expect(seen).toEqual([]);
  });

  it('stops telling a watcher that asked it to, and everyone once destroyed', () => {
    const { canvas, watch, seen, stop, send, losses } = setUp();
    const others: Sighting[] = [];
    watch.watch({ seen: (sighting) => void others.push(sighting), lost: () => undefined });
    stop();
    send('pointermove', canvas);
    send('blur', null);
    expect(seen).toEqual([]);
    expect(losses()).toBe(0);
    expect(others).toHaveLength(1);
    watch.destroy();
    send('pointermove', canvas);
    expect(others).toHaveLength(1);
  });
});

describe('a handle that is let rest', () => {
  function setUp(laidOutWidth: number | null = null) {
    const handle = new FakeElement();
    const watched: unknown[] = [];
    const sizes: Sizes = {
      watch: (element) => void watched.push(element),
      of: () => (laidOutWidth === null ? null : { width: laidOutWidth, height: laidOutWidth }),
      destroy: () => undefined,
    };
    const watchers = new Set<PointerWatcher>();
    const pointers: PointerWatch = {
      watch(watcher) {
        watchers.add(watcher);
        return () => watchers.delete(watcher);
      },
      destroy: () => watchers.clear(),
    };
    let changes = 0;
    const { rest, unbind } = restHandle(handle as unknown as HTMLElement, sizes, pointers, () => changes++);
    rest.drawnAt(HERE);
    const see = (sighting: Sighting): void => {
      for (const watcher of [...watchers]) watcher.seen(sighting);
    };
    const loseSight = (): void => {
      for (const watcher of [...watchers]) watcher.lost();
    };
    const keyUp = (key: string): void => handle.send({ type: 'keyup', target: handle, pointerType: '', buttons: 0, clientX: 0, clientY: 0, key });
    return { handle, watched, rest, unbind, see, loseSight, keyUp, changes: () => changes };
  }

  it('reaches as far as its target was laid out: 40 px across until the browser has said, wider for fingers', () => {
    expect(setUp().rest.reach()).toBe(20);
    expect(setUp(48).rest.reach()).toBe(24);
    const { handle, watched } = setUp();
    expect(watched).toEqual([handle]);
  });

  it('says so when a pointer seen clear of it wakes it, once, and when one seen on a list over it puts it to rest', () => {
    const { rest, see, changes } = setUp();
    see(hover(ON_IT));
    expect(changes()).toBe(0);
    see(hover(FAR));
    see(hover(FAR));
    expect(rest.isResting()).toBe(false);
    expect(changes()).toBe(1);
    see(hover(ON_IT, 'mouse', 'cover'));
    expect(rest.isResting()).toBe(true);
    expect(changes()).toBe(2);
  });

  it('is told when the mouse is lost sight of', () => {
    const { rest, see, loseSight } = setUp();
    see(hover(FAR));
    loseSight();
    rest.drawnAt({ x: HERE.x + 60, y: HERE.y });
    expect(rest.isResting()).toBe(true);
  });

  it('wakes when the Tab key comes up on it, having brought the focus there, and for no other key', () => {
    const { rest, keyUp, changes } = setUp();
    keyUp('Escape');
    keyUp('Enter');
    expect(rest.isResting()).toBe(true);
    keyUp('Tab');
    expect(rest.isResting()).toBe(false);
    expect(changes()).toBe(1);
  });

  it('hears nothing once unbound', () => {
    const { rest, unbind, see, keyUp, changes } = setUp();
    unbind();
    see(hover(FAR));
    keyUp('Tab');
    expect(rest.isResting()).toBe(true);
    expect(changes()).toBe(0);
  });
});
