import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { WwiwiwhApp } from './support/app';

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
    await expect(app.toast).toHaveText('Recent places and spots cleared, and no more will be kept.');
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
