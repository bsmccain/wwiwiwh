import { describe, expect, it } from 'vitest';
import { restsOnPanel, watchLastInput } from './last-input';

const pointerDown = (pointerType: string): Event => Object.assign(new Event('pointerdown'), { pointerType });

describe('watchLastInput', () => {
  it('assumes a pointer until told otherwise', () => {
    expect(watchLastInput(new EventTarget()).kind()).toBe('pointer');
  });

  it('reports the most recent kind of input', () => {
    const page = new EventTarget();
    const lastInput = watchLastInput(page);
    page.dispatchEvent(new Event('keydown'));
    expect(lastInput.kind()).toBe('keyboard');
    page.dispatchEvent(pointerDown('touch'));
    expect(lastInput.kind()).toBe('touch');
    page.dispatchEvent(pointerDown('mouse'));
    expect(lastInput.kind()).toBe('pointer');
    page.dispatchEvent(pointerDown('pen'));
    expect(lastInput.kind()).toBe('pointer');
    page.dispatchEvent(new Event('keydown'));
    expect(lastInput.kind()).toBe('keyboard');
  });
});

describe('restsOnPanel', () => {
  it('keeps the on-screen keyboard down after a touch, on any device', () => {
    expect(restsOnPanel('touch', true)).toBe(true);
    expect(restsOnPanel('touch', false)).toBe(true);
  });

  it('puts a keyboard user in the field, on any device', () => {
    expect(restsOnPanel('keyboard', false)).toBe(false);
    expect(restsOnPanel('keyboard', true)).toBe(false);
  });

  it('puts a mouse user in the field, unless the main pointer is a finger', () => {
    expect(restsOnPanel('pointer', false)).toBe(false);
    expect(restsOnPanel('pointer', true)).toBe(true);
  });
});
