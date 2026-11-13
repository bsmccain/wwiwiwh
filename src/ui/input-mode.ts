/**
 * Whether the person is working with the keyboard or with a pointer right now. The modes that ask
 * for something on the map (Slide Home, Measure) word their prompt for whichever is in use.
 */
export type InputMode = 'keyboard' | 'pointer';

export interface InputWatch {
  mode(): InputMode;
  onChange(listener: () => void): void;
}

/** Keys held down along with something else: pressing one is not yet using the keyboard. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

/** A place on the page where the pointer was heard from. */
interface Heard {
  readonly x: number;
  readonly y: number;
}

/**
 * Whether a pointer report means the person moved the pointer. A pointer is also reported as moving
 * when the page shifts under it, so the first report only says where it is, and a repeat of the same
 * place is no move at all.
 */
export function pointerMoved(before: Heard | null, now: Heard): boolean {
  return before !== null && (before.x !== now.x || before.y !== now.y);
}

export function watchInput(win: Window = window): InputWatch {
  let mode: InputMode = 'pointer';
  let lastHeard: Heard | null = null;
  const listeners: (() => void)[] = [];

  const set = (next: InputMode): void => {
    if (mode === next) return;
    mode = next;
    for (const listener of listeners) listener();
  };

  // In the capture phase: whatever else handles the key or the press, it still tells which is in use.
  win.addEventListener(
    'keydown',
    (event) => {
      if (!isModifierKey(event.key)) set('keyboard');
    },
    true,
  );
  win.addEventListener('pointerdown', () => set('pointer'), true);
  win.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      const now = { x: event.clientX, y: event.clientY };
      const moved = pointerMoved(lastHeard, now);
      lastHeard = now;
      if (moved) set('pointer');
    },
    true,
  );

  return {
    mode: () => mode,
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
