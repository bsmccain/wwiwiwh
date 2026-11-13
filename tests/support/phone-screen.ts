import { expect, type Locator, type Page } from '@playwright/test';

/** The smallest a control may be in either direction where it is worked with a finger. */
export const TOUCH_TARGET_PX = 48;

export interface Target {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/**
 * How large each control is to a finger: its own box, widened by what its ::before and ::after add
 * around it (the way small-looking buttons are given a full-size target).
 */
export async function touchTargets(controls: Locator): Promise<Target[]> {
  return controls.evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        let { left, top, right, bottom } = box;
        for (const pseudo of ['::before', '::after']) {
          const added = getComputedStyle(element, pseudo);
          if (added.content === 'none' || added.position !== 'absolute') continue;
          // An absolutely placed pseudo-element is laid out against its owner's padding box.
          left = Math.min(left, box.left + parseFloat(style.borderLeftWidth) + parseFloat(added.left));
          top = Math.min(top, box.top + parseFloat(style.borderTopWidth) + parseFloat(added.top));
          right = Math.max(right, box.right - parseFloat(style.borderRightWidth) - parseFloat(added.right));
          bottom = Math.max(bottom, box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(added.bottom));
        }
        const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
        // Hundredths of a pixel: finer than that is the browser's arithmetic, not the layout.
        return { name, width: Math.round((right - left) * 100) / 100, height: Math.round((bottom - top) * 100) / 100 };
      }),
  );
}

export function tooSmall(targets: readonly Target[]): Target[] {
  return targets.filter((target) => target.width < TOUCH_TARGET_PX || target.height < TOUCH_TARGET_PX);
}

/** How far the page reaches, and what on it lies partly or wholly outside the screen. */
export interface Reach {
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  /** The buttons, links, paragraphs and place names that reach outside, by what they say. */
  readonly outside: string[];
}

export async function reachOfPage(page: Page): Promise<Reach> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const outside = [...document.querySelectorAll('#app button, #app a[href], #app p, #app .legend__name')]
      .filter((element) => element.getClientRects().length > 0 && !element.closest('.visually-hidden, .skip-link'))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight;
      })
      .map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim());
    return { scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, outside };
  });
}

/**
 * A bottom sheet is modal, spans the screen from side to side and stands on its bottom edge without
 * reaching above its top. `panel` is the sheet's dialog.
 */
export async function expectSheetOnScreen(panel: Locator, screen: { readonly width: number; readonly height: number }): Promise<void> {
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  // The sheet slides up; it has arrived when its bottom edge is the screen's.
  await expect.poll(async () => (await panel.boundingBox())?.y).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? box.y + box.height : NaN;
    })
    .toBeCloseTo(screen.height, 0);
  const box = await panel.boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(screen.width);
}
