import { expect, test } from './fixtures';
import { ANY_TOWN, tileOfTowns } from './support/towns';

test.describe('with tiles that carry place names', () => {
  test.beforeEach(async ({ app, mapService }) => {
    // The same tile everywhere, for both sheets.
    mapService.tile = tileOfTowns();
    await app.open();
  });

  test('the names are lettered on both sheets', async ({ page }) => {
    const anyTown = new RegExp(`^(${ANY_TOWN})$`);
    await expect(page.locator('.mapz-name--away.mapz-name--on', { hasText: anyTown }).first()).toBeVisible();
    await expect(page.locator('.mapz-name--home.mapz-name--on', { hasText: anyTown }).first()).toBeVisible();
  });

  test('the trip is described by where it lands on Away', async ({ app }) => {
    // In full on wide screens, in short on narrow ones.
    const onHome = 'Palo Alto to San Jose is 16\\.7 mi( \\(26\\.9 km\\))? in a straight line\\.';
    const onAway = `(Laid on London, that runs from|On London:) .*(${ANY_TOWN}) to central London\\.`;
    await expect(app.caption).toHaveText(new RegExp(`^${onHome} ${onAway}$`));
  });

  test('no name lies on the pin', async ({ app, page }) => {
    await expect(page.locator('.mapz-name--on').first()).toBeVisible();
    const pin = await app.onPage((await app.state()).pin);

    const namesOnThePin = await page.locator('.mapz-name--on').evaluateAll(
      (names, at) =>
        names
          .map((name) => name.getBoundingClientRect())
          // The pin's mark with its focus ring is 32px across.
          .filter((box) => box.left < at.x + 16 && box.right > at.x - 16 && box.top < at.y + 16 && box.bottom > at.y - 16).length,
      pin,
    );
    expect(namesOnThePin).toBe(0);
  });
});
