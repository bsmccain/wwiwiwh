import { describe, expect, it } from 'vitest';
import { screenAngle, snapRotation } from './angles';

describe('snapRotation', () => {
  it('snaps onto square turns within two degrees', () => {
    expect(snapRotation(1.9)).toBe(0);
    expect(snapRotation(-1.2)).toBe(0);
    expect(snapRotation(88.5)).toBe(90);
    expect(snapRotation(-91)).toBe(-90);
    expect(snapRotation(179)).toBe(180);
    expect(snapRotation(-179)).toBe(180);
  });

  it('leaves other turns alone, normalised', () => {
    expect(snapRotation(2.5)).toBe(2.5);
    expect(snapRotation(45)).toBe(45);
    expect(snapRotation(370)).toBe(10);
    expect(snapRotation(1.9, 1)).toBeCloseTo(1.9, 9);
  });
});

describe('screenAngle', () => {
  it('measures clockwise from the right, with y pointing down', () => {
    const pivot = { x: 10, y: 10 };
    expect(screenAngle(pivot, { x: 20, y: 10 })).toBe(0);
    expect(screenAngle(pivot, { x: 10, y: 20 })).toBe(90);
    expect(screenAngle(pivot, { x: 0, y: 10 })).toBe(180);
    expect(screenAngle(pivot, { x: 10, y: 0 })).toBe(-90);
  });
});
