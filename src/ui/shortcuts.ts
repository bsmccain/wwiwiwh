/**
 * The keyboard table: which key does what, where it applies, and how it is listed in the shortcuts
 * dialog. `resolveKey` is free of the DOM so the table can be tested key by key.
 */

/** The parts of a keyboard event the table looks at. */
export interface KeyPress {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
}

/** Where the key was pressed. */
export interface KeyContext {
  /** Focus is in a text field or another control that takes typing. */
  readonly typing: boolean;
  /** A dialog, a picker, the More menu or the pin menu is open; it owns the keyboard. */
  readonly overlayOpen: boolean;
  /** Home is being slid or turned with a pointer right now. */
  readonly draggingHome: boolean;
  /** Focus is on the pin, the turn knob or a trip end, which use the arrow keys themselves. */
  readonly onHandle: boolean;
  /** Focus is on the map, where MapLibre pans and zooms on its own. */
  readonly onMap: boolean;
  /** Focus is on a button or a link, which Enter activates. */
  readonly onControl: boolean;
  readonly measuring: boolean;
  /**
   * Keys pressed on their own (a letter, a digit, a bracket, the question mark) are listened for.
   * People who dictate, or whose switch software types, turn this off; the arrow keys, + and -,
   * Enter, Escape and whatever is pressed together with Shift stay.
   */
  readonly singleKeys: boolean;
}

export type KeyCommand =
  | { readonly do: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly do: 'zoom'; readonly delta: number }
  | { readonly do: 'slide'; readonly dx: number; readonly dy: number }
  | { readonly do: 'turn'; readonly degrees: number }
  | {
      readonly do:
        | 'squareUp'
        | 'toggleSlide'
        | 'toggleMeasure'
        | 'placeTripEnd'
        | 'toggleRings'
        | 'holdHideHome'
        | 'swap'
        | 'lineUpAgain'
        | 'pinAtCenter'
        | 'openPinMenu'
        | 'toggleUnits'
        | 'copyLink'
        | 'pickHome'
        | 'pickAway'
        | 'showShortcuts'
        | 'cancel';
    };

/** One press of an arrow key moves both maps this far, the same step MapLibre takes when the map has focus. */
const PAN_STEP_PX = 100;
const SLIDE_STEP_PX = 32;
const SLIDE_FINE_STEP_PX = 4;
/** One press of an on-screen nudge button slides Home this far; holding the button repeats. */
export const NUDGE_STEP_PX = 16;
export const TURN_STEP_DEG = 5;
const TURN_FINE_STEP_DEG = 1;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Keys that act once per press: holding one down does not repeat it. */
const ONCE: Readonly<Record<string, KeyCommand['do']>> = {
  '0': 'squareUp',
  s: 'toggleSlide',
  m: 'toggleMeasure',
  g: 'toggleRings',
  h: 'holdHideHome',
  x: 'swap',
  r: 'lineUpAgain',
  p: 'pinAtCenter',
  a: 'openPinMenu',
  u: 'toggleUnits',
  c: 'copyLink',
  '1': 'pickHome',
  '2': 'pickAway',
  '?': 'showShortcuts',
};

/** What the shortcuts dialog and the More menu say is left when single-key shortcuts are off. */
export const KEYS_THAT_STAY = 'Arrow keys, + and −, Enter, Esc and keys held with Shift still work.';

/** The key that hides Home while it is down. Its release is watched separately from the table. */
export function isHideHomeKey(press: Pick<KeyPress, 'key'>): boolean {
  return press.key.toLowerCase() === 'h';
}

export function resolveKey(press: KeyPress, context: KeyContext): KeyCommand | null {
  if (press.ctrlKey || press.metaKey || context.typing || context.overlayOpen) return null;

  const arrow = ARROWS[press.key];
  if (arrow) {
    const [x, y] = arrow;
    // A handle moves itself with the arrow keys, Shift and Alt included.
    if (context.onHandle) return null;
    if (press.shiftKey) {
      const step = press.altKey ? SLIDE_FINE_STEP_PX : SLIDE_STEP_PX;
      return { do: 'slide', dx: x * step, dy: y * step };
    }
    // Alt with an arrow is the browser's Back and Forward.
    if (press.altKey || context.onMap) return null;
    return { do: 'pan', dx: x * PAN_STEP_PX, dy: y * PAN_STEP_PX };
  }

  if (press.altKey) return null;

  // By position on the keyboard: on many layouts the brackets are not where these keys print.
  if (press.code === 'BracketLeft' || press.code === 'BracketRight') {
    if (!context.singleKeys && !press.shiftKey) return null;
    const step = press.shiftKey ? TURN_FINE_STEP_DEG : TURN_STEP_DEG;
    return { do: 'turn', degrees: press.code === 'BracketLeft' ? -step : step };
  }

  switch (press.key) {
    case '+':
    case '=':
      return context.onMap ? null : { do: 'zoom', delta: 1 };
    case '-':
    case '_':
      return context.onMap ? null : { do: 'zoom', delta: -1 };
    case 'Escape':
      return { do: 'cancel' };
    case 'Enter':
      return context.measuring && !context.onControl && !press.repeat ? { do: 'placeTripEnd' } : null;
  }

  // A letter struck while Home is under the pointer is a slip of the hand that holds Shift: acting
  // on it would switch a mode or swap the places in the middle of the drag.
  if (!context.singleKeys || context.draggingHome) return null;
  const once = ONCE[press.key.toLowerCase()];
  return once && !press.repeat ? ({ do: once } as KeyCommand) : null;
}

export interface ShortcutEntry {
  /** Alternatives, each a chord of keys pressed together. */
  readonly keys: readonly (readonly string[])[];
  readonly does: string;
}

export interface ShortcutGroup {
  readonly title: string;
  readonly entries: readonly ShortcutEntry[];
}

/** The table as the shortcuts dialog lists it. Keep in step with `resolveKey`. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Both maps',
    entries: [
      { keys: [['←'], ['→'], ['↑'], ['↓']], does: 'Move both maps' },
      { keys: [['+'], ['−']], does: 'Zoom in and out' },
      { keys: [['X']], does: 'Swap Home and Away' },
      { keys: [['1']], does: 'Choose Home' },
      { keys: [['2']], does: 'Choose Away' },
    ],
  },
  {
    title: 'Distances',
    entries: [
      { keys: [['M']], does: 'Measure on or off' },
      { keys: [['Enter']], does: 'While measuring, drop a trip end at the centre' },
      { keys: [['G']], does: 'Rings on or off' },
      { keys: [['U']], does: 'Miles or kilometres' },
    ],
  },
  {
    title: 'Home on its own',
    entries: [
      { keys: [['Shift', 'arrow']], does: 'Slide Home. Add Alt for small steps' },
      { keys: [['['], [']']], does: 'Turn Home 5° left or right. Add Shift for 1°' },
      { keys: [['0']], does: 'Square Home up' },
      { keys: [['S']], does: 'Slide Home on or off' },
      { keys: [['H']], does: 'Hide Home while held down' },
      { keys: [['P']], does: 'Put the pin at the centre of the view' },
      { keys: [['A']], does: 'Set the pin by address' },
      { keys: [['R']], does: 'Line up again' },
    ],
  },
  {
    title: 'The rest',
    entries: [
      { keys: [['C']], does: 'Copy link to this view' },
      { keys: [['?']], does: 'Show this list' },
      { keys: [['Esc']], does: 'Leave Slide Home or Measure' },
    ],
  },
];
