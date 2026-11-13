import { describe, expect, it } from 'vitest';
import { dragStart, releaseVerdict } from './sheet-drag';

describe('dragStart', () => {
  const free = { atTop: true, cancelable: true };

  it('waits while the finger has barely moved', () => {
    expect(dragStart({ dx: 0, dy: 0, ...free })).toBe('undecided');
    expect(dragStart({ dx: 3, dy: 3, ...free })).toBe('undecided');
    expect(dragStart({ dx: -3, dy: -3, ...free })).toBe('undecided');
  });

  it('claims a touch that heads down', () => {
    expect(dragStart({ dx: 0, dy: 4, ...free })).toBe('claim');
    expect(dragStart({ dx: 5, dy: 12, ...free })).toBe('claim');
  });

  it('claims before a browser would start a scroll of its own', () => {
    // Chrome on Android holds back moves of under 8px or so and scrolls on the first one it lets through.
    expect(dragStart({ dx: 0, dy: 8, ...free })).toBe('claim');
  });

  it('leaves a touch that heads up or sideways to the list', () => {
    expect(dragStart({ dx: 0, dy: -6, ...free })).toBe('leave');
    expect(dragStart({ dx: 9, dy: 6, ...free })).toBe('leave');
    expect(dragStart({ dx: -9, dy: 9, ...free })).toBe('leave');
  });

  it('leaves the touch alone while the list has rows above to scroll back to', () => {
    expect(dragStart({ dx: 0, dy: 20, atTop: false, cancelable: true })).toBe('leave');
  });

  it('leaves a touch the browser has already taken', () => {
    expect(dragStart({ dx: 0, dy: 20, atTop: true, cancelable: false })).toBe('leave');
  });
});

describe('releaseVerdict', () => {
  const sheetHeight = 717;

  it('settles back after a short, slow drag', () => {
    expect(releaseVerdict({ distance: 60, velocity: 0.1, sheetHeight })).toBe('settle');
    expect(releaseVerdict({ distance: 159, velocity: 0, sheetHeight })).toBe('settle');
  });

  it('dismisses once dragged far enough, however slowly', () => {
    expect(releaseVerdict({ distance: 160, velocity: 0, sheetHeight })).toBe('dismiss');
  });

  it('asks less of a short sheet', () => {
    expect(releaseVerdict({ distance: 48, velocity: 0, sheetHeight: 158 })).toBe('dismiss');
    expect(releaseVerdict({ distance: 47, velocity: 0, sheetHeight: 158 })).toBe('settle');
  });

  it('dismisses on a downward flick', () => {
    expect(releaseVerdict({ distance: 40, velocity: 0.5, sheetHeight })).toBe('dismiss');
    expect(releaseVerdict({ distance: 39, velocity: 2, sheetHeight })).toBe('settle');
  });

  it('settles when the finger was on its way back up', () => {
    expect(releaseVerdict({ distance: 120, velocity: -0.8, sheetHeight })).toBe('settle');
  });
});
