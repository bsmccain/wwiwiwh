import { describe, expect, it, vi } from 'vitest';
import { createOverlays } from './overlays';

describe('overlays', () => {
  it('reports open from the first overlay until the last one has closed', () => {
    const overlays = createOverlays();
    const heard: boolean[] = [];
    overlays.onChange((open) => heard.push(open));

    const pickerClosed = overlays.opened(() => undefined);
    const dialogClosed = overlays.opened(() => undefined);
    expect(overlays.isOpen()).toBe(true);
    pickerClosed();
    expect(overlays.isOpen()).toBe(true);
    dialogClosed();
    expect(overlays.isOpen()).toBe(false);
    expect(heard).toEqual([true, false]);
  });

  it('ignores a second report that the same overlay closed', () => {
    const overlays = createOverlays();
    const heard: boolean[] = [];
    overlays.onChange((open) => heard.push(open));
    const closed = overlays.opened(() => undefined);
    closed();
    closed();
    expect(heard).toEqual([true, false]);
  });

  it('closes everything that is open, each through its own way out', () => {
    const overlays = createOverlays();
    const closeMenu = vi.fn();
    const closeDialog = vi.fn();
    const menuClosed = overlays.opened(() => {
      closeMenu();
      menuClosed();
    });
    overlays.opened(closeDialog);
    overlays.closeAll();
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(closeDialog).toHaveBeenCalledOnce();
  });
});
