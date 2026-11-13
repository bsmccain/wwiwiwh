import type { JSHandle, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Everything the page's polite live region says from now on. A message stays in the region for a
 * second only, so it is noted as it is written instead of being looked for afterwards.
 */
function listenToLiveRegion(page: Page): Promise<JSHandle<string[]>> {
  return page.evaluateHandle(() => {
    const region = document.querySelector('.stage > [aria-live="polite"]');
    if (!region) throw new Error('The stage has no live region.');
    const said: string[] = [];
    new MutationObserver(() => {
      const text = region.textContent ?? '';
      if (text !== '') said.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
    return said;
  });
}

test.describe('what a screen reader is told', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('switching the rings off is spoken', async ({ app, page }) => {
    const said = await listenToLiveRegion(page);

    await app.tool('Rings').click();

    await expect.poll(() => said.jsonValue()).toEqual(['Rings off.']);
  });

  test('a turn made in several steps is spoken once, as where it ended', async ({ page }) => {
    const said = await listenToLiveRegion(page);

    await page.keyboard.press(']');
    await page.keyboard.press(']');
    await page.keyboard.press(']');

    await expect.poll(() => said.jsonValue()).toEqual(['Home is turned 15 degrees clockwise.']);
  });

  test('a change of place is spoken once, when its view is drawn', async ({ app, page }) => {
    const said = await listenToLiveRegion(page);

    await app.pickPlace('home', 'Tokyo');
    await app.drawn();

    // Where the pin now sits, then the trip that came with the new Home, in one message.
    await expect
      .poll(() => said.jsonValue())
      .toEqual(['Central Tokyo sits on central London. Yokohama to Tokyo is 17.6 mi (28.3 km) in a straight line.']);
  });
});
