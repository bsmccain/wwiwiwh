import { describe, expect, it } from 'vitest';
import { isModifierKey, pointerMoved } from './input-mode';

describe('telling keyboard use from pointer use', () => {
  it('does not take a modifier held for a drag as typing', () => {
    expect(isModifierKey('Shift')).toBe(true);
    expect(isModifierKey('Alt')).toBe(true);
    expect(isModifierKey('m')).toBe(false);
    expect(isModifierKey('Enter')).toBe(false);
    expect(isModifierKey('ArrowLeft')).toBe(false);
  });

  it('takes the first pointer report as a position, not a move', () => {
    expect(pointerMoved(null, { x: 10, y: 10 })).toBe(false);
  });

  it('ignores a pointer reported again at the same place', () => {
    expect(pointerMoved({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
    expect(pointerMoved({ x: 10, y: 10 }, { x: 11, y: 10 })).toBe(true);
  });
});
