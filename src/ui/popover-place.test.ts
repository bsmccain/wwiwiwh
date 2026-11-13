import { describe, expect, it } from 'vitest';
import { placeBeside, type Edges } from './popover-place';

const screen = { width: 1440, height: 900 };
const panel = { width: 324, height: 220 };

/** A 40px target centred on a point, as the pin's handle is. */
function pinAt(x: number, y: number): Edges {
  return { left: x - 20, top: y - 20, right: x + 20, bottom: y + 20 };
}

describe('a popover beside its anchor', () => {
  it('stands to the right, rising from the foot of the anchor', () => {
    expect(placeBeside(pinAt(720, 400), panel, screen)).toEqual({ left: 748, top: 200, maxHeight: 876 });
  });

  it('stands to the left when the right has no room', () => {
    const placed = placeBeside(pinAt(1300, 400), panel, screen);
    expect(placed.left).toBe(1300 - 20 - 8 - 324);
    expect(placed.top).toBe(200);
  });

  it('hangs from the top margin when the anchor is too high to rise from', () => {
    expect(placeBeside(pinAt(720, 60), panel, screen).top).toBe(12);
  });

  it('never reaches below the screen, even for an anchor that is', () => {
    expect(placeBeside(pinAt(720, 1000), panel, screen).top).toBe(900 - 12 - 220);
  });

  it('goes above the anchor on a screen too narrow for either side', () => {
    const narrow = { width: 720, height: 900 };
    expect(placeBeside(pinAt(360, 400), panel, narrow)).toEqual({ left: 198, top: 400 - 20 - 8 - 220, maxHeight: 876 });
  });

  it('goes below the anchor when there is no room above either', () => {
    const narrow = { width: 720, height: 900 };
    expect(placeBeside(pinAt(360, 100), panel, narrow)).toEqual({ left: 198, top: 100 + 20 + 8, maxHeight: 876 });
  });

  it('stays on the screen sideways', () => {
    expect(placeBeside(pinAt(40, 400), panel, { width: 340, height: 900 }).left).toBe(12);
    expect(placeBeside(pinAt(340, 400), panel, { width: 500, height: 900 }).left).toBe(500 - 12 - 324);
  });

  it('is no taller than the screen allows', () => {
    const short = { width: 1440, height: 200 };
    const placed = placeBeside(pinAt(720, 100), { width: 324, height: 400 }, short);
    expect(placed.maxHeight).toBe(176);
    expect(placed.top).toBe(12);
  });
});
