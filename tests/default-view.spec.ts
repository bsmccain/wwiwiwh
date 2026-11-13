import { expect, test } from './fixtures';

test.describe('the default view', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('is drawn from the stand-in tile service alone', async ({ app, mapService }) => {
    const heard = await app.heard();
    expect(heard.idles).toBeGreaterThan(0);
    expect(heard.health).toEqual([]);
    expect((await app.state()).health).toBe('ok');
    // One description of the tile source for each of the two sheets, and tiles for both.
    expect(mapService.requests.tileJson).toBe(2);
    expect(mapService.requests.tiles).toBeGreaterThan(0);
  });

  test('names the pair in the title and the legend', async ({ app, page }) => {
    await expect(page).toHaveTitle('San Jose over London at the same scale | wwiwiwh');
    await expect(app.legendName('home')).toHaveText('San Jose');
    await expect(app.legendName('away')).toHaveText('London');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('San Jose over London at the same scale');
  });

  test('describes the trip from Palo Alto to San Jose', async ({ app }) => {
    await expect(app.caption).toContainText(/^Palo Alto to San Jose is 16\.7 mi/);
    const { trip } = await app.state();
    expect(trip).toMatchObject({ fromName: 'Palo Alto', toName: 'San Jose' });
  });

  test('puts the pin in the middle of the stage', async ({ app }) => {
    const { pin, stage } = await app.state();
    expect(pin.x).toBeCloseTo(stage.width / 2, 0);
    expect(pin.y).toBeCloseTo(stage.height / 2, 0);
    await expect(app.pinHandle).toBeVisible();
  });

  test('draws the bar scale: in the collar where there is room, on the map on narrow screens', async ({ app, page }) => {
    const bar = page.locator('.wwiwiwh-scale-bar').filter({ visible: true });
    await expect(bar).toHaveCount(1);
    await expect(page.locator(app.touch ? '.stage__scale' : '.scale__bar').locator('.wwiwiwh-scale-bar')).toBeVisible();
    await expect(bar).toContainText('mi');
    await expect(bar).toContainText('km');
  });

  test('fits the window without scrolling', async ({ page }) => {
    const sizes = await page.evaluate(() => {
      const root = document.documentElement;
      return { scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, width: window.innerWidth, height: window.innerHeight };
    });
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width);
    expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.height);
  });

  test('leaves the address bare until something changes', async ({ app }) => {
    expect(await app.hash()).toBe('');
  });

  test('logs no errors or warnings on the way', async ({ consoleWatch }) => {
    // Every test ends with this check; here it is the whole of the test.
    expect(consoleWatch.problems()).toEqual([]);
  });
});
