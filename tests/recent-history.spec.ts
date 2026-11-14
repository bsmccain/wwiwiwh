import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { WwiwiwhApp } from './support/app';

/**
 * The places and spots picked before are kept in the browser, where the next person to use it would
 * see them. Under More they can be cleared, and keeping them can be switched off.
 */

/** The opening pair with no trip drawn, so that the caption of a narrow screen carries the pin sentence. */
const NO_TRIP = 'home=san-jose&away=london&trip=none';
const HISTORY_KEYS = ['wwiwiwh.recent-places', 'wwiwiwh.recent-spots'];

function kept(page: Page): Promise<(string | null)[]> {
  return page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), HISTORY_KEYS);
}

function keepRecentChoice(app: WwiwiwhApp, word: 'On' | 'Off') {
  return app.menu.getByRole('group', { name: 'Recent places and spots', exact: true }).getByRole('radio', { name: word, exact: true });
}

function clearRecentButton(app: WwiwiwhApp) {
  return app.menu.getByRole('button', { name: /^Clear recent places and spots/ });
}

/** Picks Tokyo as Away and 10 Downing Street as the Away spot, so that both lists have something in them. */
async function pickAPlaceAndASpot(app: WwiwiwhApp): Promise<void> {
  await app.pickPlace('away', 'Tokyo');
  await app.pickPlace('away', 'London');
  await app.press(app.sentenceSpot('away'));
  await app.searchAndPick('10 downing', '10 Downing Street');
  await expect(app.pinSentence).toHaveText('Downtown San Jose sits on 10 Downing Street.');
}

async function expectRecentListed(app: WwiwiwhApp, listed: boolean): Promise<void> {
  await app.press(app.sentenceSpot('away'));
  const spots = app.pickerGroup('Recent');
  if (listed) await expect(spots.locator('.picker__name')).toHaveText(['10 Downing Street']);
  else await expect(app.picker.getByRole('option')).toHaveText(['The centre of London']);
  await app.closePicker();
  await app.press(app.legendRow('away'));
  if (listed) await expect(app.pickerGroup('Recent').locator('.picker__name')).toContainText(['Tokyo']);
  else await expect(app.pickerGroup('Recent')).toHaveCount(0);
  await app.closePicker();
}

test.describe('recent places and spots', () => {
  test.beforeEach(async ({ app }) => {
    await app.open(NO_TRIP);
  });

  test('are kept by default, and Clear forgets both lists for good', async ({ app, page }) => {
    await pickAPlaceAndASpot(app);
    const [places, spots] = await kept(page);
    expect(places).toContain('Tokyo');
    expect(spots).toContain('10 Downing Street');
    await expectRecentListed(app, true);

    await app.press(app.moreButton);
    await expect(keepRecentChoice(app, 'On')).toBeChecked();
    await app.press(clearRecentButton(app));
    await expect(app.menu).toBeHidden();
    await expect(app.toast).toHaveText('Recent places and spots cleared from this browser.');
    expect(await kept(page)).toEqual([null, null]);
    await expectRecentListed(app, false);

    // A fresh page at the bare address, as the next person to use this browser would open it.
    await app.open(NO_TRIP);
    await expectRecentListed(app, false);
    expect(await kept(page)).toEqual([null, null]);
  });

  test('switched off, are cleared, and a pick still works without being kept', async ({ app, page }) => {
    await pickAPlaceAndASpot(app);

    await app.press(app.moreButton);
    await app.press(keepRecentChoice(app, 'Off'));
    await expect(keepRecentChoice(app, 'Off')).toBeChecked();
    await expect(clearRecentButton(app)).toBeDisabled();
    expect(await kept(page)).toEqual([null, null]);
    await page.keyboard.press('Escape');
    await expect(app.menu).toBeHidden();

    await app.pickPlace('away', 'Tokyo');
    await app.pickPlace('away', 'London');
    await app.press(app.sentenceSpot('away'));
    await app.searchAndPick('heathrow', 'Heathrow Airport');
    await expect(app.pinSentence).toHaveText('Downtown San Jose sits on Heathrow Airport.');
    expect(await kept(page)).toEqual([null, null]);

    await app.reload();
    await expectRecentListed(app, false);
    await app.press(app.moreButton);
    await expect(keepRecentChoice(app, 'Off')).toBeChecked();

    // Switched back on, the next pick is kept again.
    await app.press(keepRecentChoice(app, 'On'));
    await expect(clearRecentButton(app)).toBeEnabled();
    await page.keyboard.press('Escape');
    await app.press(app.sentenceSpot('away'));
    await app.searchAndPick('10 downing', '10 Downing Street');
    expect((await kept(page))[1]).toContain('10 Downing Street');
  });

  test('if the browser will not save Off, the menu closes, says so, and stays On', async ({ app, page }) => {
    await pickAPlaceAndASpot(app);
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'wwiwiwh.keep-recent') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        setItem.call(this, key, value);
      };
    });

    await app.press(app.moreButton);
    await app.press(keepRecentChoice(app, 'Off'));
    // The menu closes, so that nothing covers the alert or makes it inert.
    await expect(app.menu).toBeHidden();
    const alert = app.page.locator('.toasts [role="alert"] .toast');
    await expect(alert).toHaveText("Recent places and spots cleared, but this browser wouldn't save Off, so new picks may be kept.");
    await expect(alert).toBeInViewport();
    expect(await kept(page)).toEqual([null, null]);
    await app.press(app.moreButton);
    await expect(keepRecentChoice(app, 'On')).toBeChecked();
    await expect(clearRecentButton(app)).toBeEnabled();
  });

  test('if the browser will not save On, the menu closes, says so, and stays Off', async ({ app, page }) => {
    await app.press(app.moreButton);
    await app.press(keepRecentChoice(app, 'Off'));
    await expect(keepRecentChoice(app, 'Off')).toBeChecked();
    await page.evaluate(() => {
      const removeItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key: string) {
        if (key === 'wwiwiwh.keep-recent') throw new DOMException('The operation is insecure.', 'SecurityError');
        removeItem.call(this, key);
      };
    });

    await app.press(keepRecentChoice(app, 'On'));
    await expect(app.menu).toBeHidden();
    await expect(app.page.locator('.toasts [role="alert"] .toast')).toHaveText(
      "This browser wouldn't save On, so places and spots you pick won't be kept.",
    );
    await app.press(app.moreButton);
    await expect(keepRecentChoice(app, 'Off')).toBeChecked();
    await expect(clearRecentButton(app)).toBeDisabled();
  });

  test('if the browser will not remove a list, Clear says so and stays offered', async ({ app, page }) => {
    await pickAPlaceAndASpot(app);
    await page.evaluate(() => {
      const removeItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key: string) {
        if (key === 'wwiwiwh.recent-spots') throw new DOMException('The operation is insecure.', 'SecurityError');
        removeItem.call(this, key);
      };
    });

    await app.press(app.moreButton);
    await app.press(clearRecentButton(app));
    await expect(app.page.locator('.toasts [role="alert"] .toast')).toHaveText(
      "This browser wouldn't clear recent places and spots, so they may still be kept.",
    );
    await expect(app.page.locator('.toasts [role="status"] .toast')).toHaveCount(0);
    const [places, spots] = await kept(page);
    expect(places).toBeNull();
    expect(spots).toContain('10 Downing Street');

    // Off then stops new picks, but does not claim the old list went, and Clear stays offered.
    await app.press(app.moreButton);
    await app.press(keepRecentChoice(app, 'Off'));
    await expect(app.menu).toBeHidden();
    await expect(app.page.locator('.toasts [role="alert"] .toast')).toHaveText(
      "Off is saved, but this browser wouldn't clear the places and spots kept before.",
    );
    await app.press(app.moreButton);
    await expect(keepRecentChoice(app, 'Off')).toBeChecked();
    await expect(clearRecentButton(app)).toBeEnabled();
  });

  test('cleared in one tab, go from a Recent list open in another', async ({ app, context }) => {
    await pickAPlaceAndASpot(app);
    const other = new WwiwiwhApp(await context.newPage(), app.touch);
    await other.open(NO_TRIP);
    await other.press(other.legendRow('away'));
    await expect(other.pickerGroup('Recent').locator('.picker__name')).toContainText(['Tokyo']);

    await app.page.bringToFront();
    await app.press(app.moreButton);
    await app.press(clearRecentButton(app));
    await expect(app.toast).toHaveText('Recent places and spots cleared from this browser.');

    await expect(other.pickerGroup('Recent')).toHaveCount(0);
    await expect(other.picker).toBeVisible();
  });

  test('switched off in one tab, go from a Recent list open in another, and its menu follows', async ({ app, context }) => {
    await pickAPlaceAndASpot(app);
    const other = new WwiwiwhApp(await context.newPage(), app.touch);
    await other.open(NO_TRIP);
    await other.press(other.sentenceSpot('away'));
    await expect(other.pickerGroup('Recent').locator('.picker__name')).toHaveText(['10 Downing Street']);

    await app.page.bringToFront();
    await app.press(app.moreButton);
    await app.press(keepRecentChoice(app, 'Off'));
    await expect(keepRecentChoice(app, 'Off')).toBeChecked();

    await expect(other.picker.getByRole('option')).toHaveText(['The centre of London']);

    // A More menu open in the other tab shows the change too.
    await other.page.bringToFront();
    await other.closePicker();
    await other.press(other.moreButton);
    await expect(keepRecentChoice(other, 'Off')).toBeChecked();
    await app.page.bringToFront();
    await app.press(keepRecentChoice(app, 'On'));
    await expect(keepRecentChoice(other, 'On')).toBeChecked();
    await expect(clearRecentButton(other)).toBeEnabled();
  });

  test('clearing them leaves the display settings as they were', async ({ app, page }) => {
    await app.press(app.moreButton);
    await app.press(app.menuChoice('Dark'));
    await app.press(app.menuChoice('Kilometres'));
    await app.press(clearRecentButton(app));
    await app.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await app.state()).units).toBe('km');
  });

  test('About says they are kept, and where to clear them', async ({ app }) => {
    await app.press(app.moreButton);
    await app.press(app.menu.getByRole('button', { name: 'About wwiwiwh', exact: true }));
    await expect(app.page.getByRole('dialog', { name: 'About wwiwiwh' })).toContainText(
      'Under More, Recent places and spots clears them or stops keeping them.',
    );
  });
});
