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

test.describe('after a drag that the page never saw released', { tag: '@desktop' }, () => {
  test('readouts are spoken again once the window has lost focus mid-drag', async ({ app, page }) => {
    await app.open();
    const end = page.getByRole('button', { name: 'Trip end' });
    const box = await end.boundingBox();
    if (!box) throw new Error('The trip end is not on the stage.');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 3 });
    // Another window is switched to and the button is let go there: the page hears the blur only.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('.wwiwiwh-handle.is-held')).toHaveCount(0);

    const said = await listenToLiveRegion(page);
    await page.keyboard.press(']');

    await expect.poll(() => said.jsonValue()).toEqual(['Home is turned 5 degrees clockwise.']);
  });
});
