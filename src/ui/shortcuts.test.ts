import { describe, expect, it } from 'vitest';
import { isHideHomeKey, resolveKey, SHORTCUT_GROUPS, type KeyContext, type KeyPress } from './shortcuts';

const nowhere: KeyContext = {
  typing: false,
  overlayOpen: false,
  onHandle: false,
  onMap: false,
  onControl: false,
  measuring: false,
  singleKeys: true,
  draggingHome: false,
};

function press(key: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { key, code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...extra };
}

describe('keyboard table', () => {
  it('pans both maps with the arrows', () => {
    expect(resolveKey(press('ArrowLeft'), nowhere)).toEqual({ do: 'pan', dx: -100, dy: 0 });
    expect(resolveKey(press('ArrowDown'), nowhere)).toEqual({ do: 'pan', dx: 0, dy: 100 });
    expect(resolveKey(press('ArrowUp', { repeat: true }), nowhere)).toEqual({ do: 'pan', dx: 0, dy: -100 });
  });

  it('leaves plain arrows to the map and to instrument handles when they have focus', () => {
    expect(resolveKey(press('ArrowLeft'), { ...nowhere, onMap: true })).toBeNull();
    expect(resolveKey(press('ArrowLeft'), { ...nowhere, onHandle: true, onControl: true })).toBeNull();
    expect(resolveKey(press('ArrowLeft', { altKey: true }), nowhere)).toBeNull();
  });

  it('slides Home with Shift and the arrows, finely with Alt, even when the map has focus', () => {
    expect(resolveKey(press('ArrowRight', { shiftKey: true }), nowhere)).toEqual({ do: 'slide', dx: 32, dy: 0 });
    expect(resolveKey(press('ArrowUp', { shiftKey: true, altKey: true }), nowhere)).toEqual({ do: 'slide', dx: 0, dy: -4 });
    expect(resolveKey(press('ArrowRight', { shiftKey: true }), { ...nowhere, onMap: true })).toEqual({ do: 'slide', dx: 32, dy: 0 });
    expect(resolveKey(press('ArrowRight', { shiftKey: true }), { ...nowhere, onHandle: true })).toBeNull();
  });

  it('zooms with plus and minus unless the map does it itself', () => {
    expect(resolveKey(press('+', { shiftKey: true }), nowhere)).toEqual({ do: 'zoom', delta: 1 });
    expect(resolveKey(press('='), nowhere)).toEqual({ do: 'zoom', delta: 1 });
    expect(resolveKey(press('-'), nowhere)).toEqual({ do: 'zoom', delta: -1 });
    expect(resolveKey(press('-'), { ...nowhere, onMap: true })).toBeNull();
  });

  it('turns Home with the bracket keys by position, 5 degrees or 1 with Shift', () => {
    expect(resolveKey(press('[', { code: 'BracketLeft' }), nowhere)).toEqual({ do: 'turn', degrees: -5 });
    expect(resolveKey(press(']', { code: 'BracketRight' }), nowhere)).toEqual({ do: 'turn', degrees: 5 });
    expect(resolveKey(press('{', { code: 'BracketLeft', shiftKey: true }), nowhere)).toEqual({ do: 'turn', degrees: -1 });
    expect(resolveKey(press('ü', { code: 'BracketLeft' }), nowhere)).toEqual({ do: 'turn', degrees: -5 });
    expect(resolveKey(press(']', { code: 'BracketRight', repeat: true }), nowhere)).toEqual({ do: 'turn', degrees: 5 });
  });

  it.each([
    ['0', 'squareUp'],
    ['s', 'toggleSlide'],
    ['m', 'toggleMeasure'],
    ['d', 'toggleDrive'],
    ['g', 'toggleRings'],
    ['h', 'holdHideHome'],
    ['x', 'swap'],
    ['r', 'lineUpAgain'],
    ['p', 'pinAtCenter'],
    ['a', 'openPinMenu'],
    ['u', 'toggleUnits'],
    ['c', 'copyLink'],
    ['1', 'pickHome'],
    ['2', 'pickAway'],
    ['?', 'showShortcuts'],
  ])('%s does %s, once per press', (key, command) => {
    expect(resolveKey(press(key), nowhere)).toEqual({ do: command });
    expect(resolveKey(press(key.toUpperCase(), { shiftKey: true }), nowhere)).toEqual({ do: command });
    expect(resolveKey(press(key, { repeat: true }), nowhere)).toBeNull();
    expect(resolveKey(press(key, { altKey: true }), nowhere)).toBeNull();
  });

  it('drops a trip end with Enter only while measuring and away from buttons and links', () => {
    const measuring = { ...nowhere, measuring: true };
    expect(resolveKey(press('Enter'), measuring)).toEqual({ do: 'placeTripEnd' });
    expect(resolveKey(press('Enter'), { ...measuring, onMap: true })).toEqual({ do: 'placeTripEnd' });
    expect(resolveKey(press('Enter'), { ...measuring, onControl: true })).toBeNull();
    expect(resolveKey(press('Enter'), nowhere)).toBeNull();
  });

  it('leaves a mode with Escape', () => {
    expect(resolveKey(press('Escape'), { ...nowhere, onControl: true })).toEqual({ do: 'cancel' });
  });

  it('stands aside while typing, while something is open, and for browser shortcuts', () => {
    for (const key of ['s', 'ArrowLeft', 'Escape', '+', '?']) {
      expect(resolveKey(press(key), { ...nowhere, typing: true })).toBeNull();
      expect(resolveKey(press(key), { ...nowhere, overlayOpen: true })).toBeNull();
      expect(resolveKey(press(key, { ctrlKey: true }), nowhere)).toBeNull();
      expect(resolveKey(press(key, { metaKey: true }), nowhere)).toBeNull();
    }
  });

  it('lets the letters and digits wait while Home is being dragged, and nothing else', () => {
    const dragging: KeyContext = { ...nowhere, draggingHome: true };
    for (const key of ['s', 'S', 'm', 'x', 'r', 'a', '0', '1', '?']) {
      expect(resolveKey(press(key, { shiftKey: true }), dragging)).toBeNull();
      expect(resolveKey(press(key), dragging)).toBeNull();
    }
    expect(resolveKey(press('Escape'), dragging)).toEqual({ do: 'cancel' });
    expect(resolveKey(press(']', { code: 'BracketRight' }), dragging)).toEqual({ do: 'turn', degrees: 5 });
    expect(resolveKey(press('ArrowRight', { shiftKey: true }), dragging)).toEqual({ do: 'slide', dx: 32, dy: 0 });
  });

  describe('with single-key shortcuts switched off', () => {
    const quiet: KeyContext = { ...nowhere, singleKeys: false };

    it.each(['0', 's', 'm', 'd', 'g', 'h', 'x', 'r', 'p', 'a', 'u', 'c', '1', '2', '?'])('%s on its own does nothing, with Shift or without', (key) => {
      expect(resolveKey(press(key), quiet)).toBeNull();
      expect(resolveKey(press(key.toUpperCase(), { shiftKey: true }), quiet)).toBeNull();
    });

    it('turns Home with a bracket key only together with Shift', () => {
      expect(resolveKey(press('[', { code: 'BracketLeft' }), quiet)).toBeNull();
      expect(resolveKey(press(']', { code: 'BracketRight' }), quiet)).toBeNull();
      expect(resolveKey(press('{', { code: 'BracketLeft', shiftKey: true }), quiet)).toEqual({ do: 'turn', degrees: -1 });
    });

    it('keeps the arrow keys, plus and minus, Enter and Escape', () => {
      expect(resolveKey(press('ArrowLeft'), quiet)).toEqual({ do: 'pan', dx: -100, dy: 0 });
      expect(resolveKey(press('ArrowRight', { shiftKey: true }), quiet)).toEqual({ do: 'slide', dx: 32, dy: 0 });
      expect(resolveKey(press('+', { shiftKey: true }), quiet)).toEqual({ do: 'zoom', delta: 1 });
      expect(resolveKey(press('-'), quiet)).toEqual({ do: 'zoom', delta: -1 });
      expect(resolveKey(press('Escape'), quiet)).toEqual({ do: 'cancel' });
      expect(resolveKey(press('Enter'), { ...quiet, measuring: true })).toEqual({ do: 'placeTripEnd' });
    });
  });

  it('ignores keys it does not know', () => {
    expect(resolveKey(press('q'), nowhere)).toBeNull();
    expect(resolveKey(press('Tab'), nowhere)).toBeNull();
    expect(resolveKey(press(' '), nowhere)).toBeNull();
  });

  it('knows the key that hides Home whatever the case', () => {
    expect(isHideHomeKey({ key: 'h' })).toBe(true);
    expect(isHideHomeKey({ key: 'H' })).toBe(true);
    expect(isHideHomeKey({ key: 'j' })).toBe(false);
  });

  it('lists every key once in the dialog', () => {
    const listed = SHORTCUT_GROUPS.flatMap((group) => group.entries.flatMap((entry) => entry.keys.map((chord) => chord.join('+'))));
    expect(new Set(listed).size).toBe(listed.length);
    for (const key of ['S', 'M', 'D', 'G', 'H', 'X', 'R', 'P', 'A', 'U', 'C', '0', '1', '2', '?', 'Esc', 'Enter', '[', ']']) {
      expect(listed).toContain(key);
    }
  });
});
