import { expect, test } from './fixtures';

/** What the browser itself logs for a request the test made fail. */
const FAILED_REQUEST = /Failed to load resource|net::ERR_/;

test.describe('with the map service out of reach from the start', () => {
  test.beforeEach(async ({ app, mapService, consoleWatch }) => {
    consoleWatch.allow(FAILED_REQUEST);
    mapService.down = true;
    await app.goto();
    await expect(app.statusNote).toHaveAttribute('data-tone', 'down');
  });

  test('a standing note says so and offers to try again', async ({ app, page }) => {
    await expect(page.getByRole('alert').filter({ hasText: "Can't reach the map service. Trying again…" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    // Not a toast that goes away, and no word of a view being drawn.
    await expect(app.toast).toHaveCount(0);
    await expect(app.statusNote).not.toContainText('Drawing');
    expect((await app.state()).health).toBe('down');
    expect((await app.heard()).idles).toBe(0);
  });

  test('the legend and the tools are still there to use', async ({ app }) => {
    await expect(app.legendName('away')).toHaveText('London');
    await app.press(app.tool('Rings'));
    expect((await app.state()).rings).toBe(false);
  });

  test('Try again asks at once, and the maps are drawn once the service is back', async ({ app, mapService, page }) => {
    // The app tries again by itself after three seconds, and then not for another eight. Waiting for
    // that first try leaves a stretch in which nothing but the button can ask.
    await expect.poll(() => mapService.requests.tileJson, { timeout: 10_000 }).toBe(4);
    await expect(app.statusNote).toHaveAttribute('data-tone', 'down');
    expect((await app.heard()).idles).toBe(0);

    mapService.down = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();

    await expect.poll(() => mapService.requests.tileJson, { timeout: 2_000 }).toBe(6);
    await app.drawn();
    await expect(app.statusNote).not.toHaveAttribute('data-tone');
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeHidden();
    expect((await app.heard()).health.at(-1)).toBe('ok');
    expect(mapService.requests.tiles).toBeGreaterThan(0);
  });

  test('the maps come back by themselves when the service does', async ({ app, mapService }) => {
    mapService.down = false;

    await app.drawn();

    await expect(app.statusNote).not.toHaveAttribute('data-tone');
    expect((await app.state()).health).toBe('ok');
  });
});

test.describe('with tiles failing to load', () => {
  test.beforeEach(async ({ app, mapService, consoleWatch }) => {
    consoleWatch.allow(FAILED_REQUEST);
    mapService.tilesFailing = true;
    await app.goto();
    await expect(app.statusNote).toHaveAttribute('data-tone', 'degraded');
  });

  test('a quiet standing note says that parts are missing', async ({ app, page }) => {
    await expect(page.getByRole('status').filter({ hasText: "Parts of the map didn't load. Trying again…" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    expect((await app.state()).health).toBe('degraded');
  });

  test('Try again asks at once, and the missing tiles load once they can be had', async ({ app, mapService, page }) => {
    await app.atRest();
    const askedAtFirst = mapService.requests.tiles;
    expect(askedAtFirst).toBeGreaterThan(0);
    // As above: past the app's own first try, so that only the button can ask.
    await expect.poll(() => mapService.requests.tiles, { timeout: 10_000 }).toBeGreaterThan(askedAtFirst);
    await app.atRest();
    const askedBefore = mapService.requests.tiles;
    await expect(app.statusNote).toHaveAttribute('data-tone', 'degraded');

    mapService.tilesFailing = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();

    await expect.poll(() => mapService.requests.tiles, { timeout: 2_000 }).toBeGreaterThan(askedBefore);
    await app.drawn();
    await expect(app.statusNote).not.toHaveAttribute('data-tone');
    expect((await app.state()).health).toBe('ok');
  });
});
