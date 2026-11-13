import { expect, type JSHandle, type Locator, type Page } from '@playwright/test';
import type { ScreenPoint } from '../../src/map/contracts';

/**
 * MapLibre throws the maps on with the speed of the last 160 ms of a drag. A pointer held still for
 * longer than that before it lets go leaves them exactly where they were let go.
 */
export const REST_BEFORE_RELEASE_MS = 250;

/**
 * Presses the mouse at `from`, drags it in a straight line to `to` and lets go there, with a
 * modifier key held throughout when one is named.
 */
export async function dragWithMouse(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  options: { readonly holding?: 'Shift' | 'Alt'; readonly steps?: number } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  if (options.holding) await page.keyboard.down(options.holding);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: options.steps ?? 6 });
  await page.mouse.up();
  if (options.holding) await page.keyboard.up(options.holding);
}

/**
 * An ordinary drag from where the mouse already is: pressed there, without a move first, dragged by
 * `by`, and let go at rest. Returns where the mouse is left.
 */
export async function dragFromHere(page: Page, here: ScreenPoint, by: ScreenPoint): Promise<ScreenPoint> {
  const to = { x: here.x + by.x, y: here.y + by.y };
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.waitForTimeout(REST_BEFORE_RELEASE_MS);
  await page.mouse.up();
  return to;
}

/** The middle of a control, on the page. */
export async function middleOf(control: Locator): Promise<ScreenPoint> {
  const box = await control.boundingBox();
  if (!box) throw new Error('The control is not on the page.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Two positions on screen are the same to within a pixel or so. */
export function expectPointNear(actual: ScreenPoint, expected: ScreenPoint, withinPx = 1.5): void {
  expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(withinPx);
}

/** What has the keyboard's focus now, to hold against what has it later. */
export async function focusedElement(page: Page): Promise<JSHandle<Element | null>> {
  return page.evaluateHandle(() => document.activeElement);
}

/**
 * Over how many pixels of height a control answers the pointer, down the line through its middle:
 * its own box, and whatever of it reaches further than that.
 */
export async function heightAnsweringPointer(control: Locator): Promise<number> {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    let height = 0;
    for (let y = 0; y < window.innerHeight; y++) {
      if (element.contains(document.elementFromPoint(middle, y))) height++;
    }
    return height;
  });
}
