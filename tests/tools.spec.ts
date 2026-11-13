import { HOLD_MS } from '../src/ui/hide-home';
import { expect, test } from './fixtures';
import { middleOf } from './support/pointer';

/** A press this long is a hold by a clear margin. The app tells a hold from a tap by the clock, so the test has to let it run. */
const HOLD_FOR_MS = HOLD_MS + 250;

test.describe('Hide Home', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('a quick press latches Home hidden until the next press', async ({ app, page }) => {
    const hide = app.tool('Hide Home');
    const homeSheet = page.locator('.wwiwiwh-sheet--home');
    await expect(homeSheet).toHaveCSS('opacity', '1');

    await app.press(hide);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(homeSheet).toHaveCSS('opacity', '0');
    expect((await app.state()).homeHidden).toBe(true);
    // The name stays the same; only the pressed state says it is on.
    await expect(hide).toHaveText('Hide Home');

    await app.press(hide);
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
    await expect(homeSheet).toHaveCSS('opacity', '1');
    expect((await app.state()).homeHidden).toBe(false);
  });

  test('a held press hides Home only while it lasts', async ({ app, page, fingers }) => {
    const hide = app.tool('Hide Home');
    const middle = await middleOf(hide);

    if (app.touch) {
      await fingers.down(middle);
    } else {
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.down();
    }
    await expect.poll(async () => (await app.state()).homeHidden).toBe(true);
    await page.waitForTimeout(HOLD_FOR_MS);
    expect((await app.state()).homeHidden).toBe(true);

    if (app.touch) await fingers.lift();
    else await page.mouse.up();
    await expect.poll(async () => (await app.state()).homeHidden).toBe(false);
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
  });

  test('a thumb that drifts during the hold does not end it', { tag: '@phone' }, async ({ app, fingers }) => {
    const middle = await middleOf(app.tool('Hide Home'));

    await fingers.down(middle);
    for (let step = 1; step <= 8; step++) await fingers.moveTo({ x: middle.x + 3 * step, y: middle.y - 2 * step });
    await app.page.waitForTimeout(HOLD_FOR_MS);
    expect((await app.state()).homeHidden).toBe(true);

    await fingers.lift();
    await expect.poll(async () => (await app.state()).homeHidden).toBe(false);
  });

  test('the H key hides Home for as long as it is down', { tag: '@desktop' }, async ({ app, page }) => {
    await page.keyboard.down('h');
    expect((await app.state()).homeHidden).toBe(true);
    await expect(page.locator('.wwiwiwh-sheet--home')).toHaveCSS('opacity', '0');

    await page.keyboard.up('h');
    expect((await app.state()).homeHidden).toBe(false);
    await expect(app.tool('Hide Home')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the pin, the rings and the trip stay up while Home is hidden', async ({ app }) => {
    await app.press(app.tool('Hide Home'));
    await expect(app.tool('Hide Home')).toHaveAttribute('aria-pressed', 'true');

    await expect(app.pinHandle).toBeVisible();
    await expect(app.plaque).toBeVisible();
    await expect(app.ringLabels.filter({ visible: true }).first()).toBeVisible();
  });
});

test.describe('Rings', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('the Rings tool takes the distance rings away and brings them back', async ({ app, page }) => {
    const rings = app.tool('Rings');
    const drawn = page.locator('.wwiwiwh-rings');
    await expect(rings).toHaveAttribute('aria-pressed', 'true');
    await expect(drawn).toBeVisible();

    await app.press(rings);
    await expect(rings).toHaveAttribute('aria-pressed', 'false');
    await expect(drawn).toBeHidden();
    await expect(app.ringLabels.filter({ visible: true })).toHaveCount(0);
    expect((await app.state()).rings).toBe(false);

    await app.press(rings);
    await expect(rings).toHaveAttribute('aria-pressed', 'true');
    await expect(drawn).toBeVisible();
    await expect(app.ringLabels.filter({ visible: true }).first()).toBeVisible();
  });

  test('rings switched off are written to the address and stay off after a reload', async ({ app, page }) => {
    await app.press(app.tool('Rings'));
    await expect(page).toHaveURL(/[#&]rings=0(&|$)/);

    await app.reload();

    await expect(app.tool('Rings')).toHaveAttribute('aria-pressed', 'false');
    expect((await app.state()).rings).toBe(false);
  });

  test('the G key switches the rings', { tag: '@desktop' }, async ({ app, page }) => {
    await page.keyboard.press('g');
    expect((await app.state()).rings).toBe(false);
    await page.keyboard.press('g');
    expect((await app.state()).rings).toBe(true);
  });
});

test.describe('units', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('switching to kilometres changes the figure on the trip', async ({ app }) => {
    await expect(app.plaque).toHaveText('16.7 mi');
    await expect(app.caption).toContainText('16.7 mi');

    await app.press(app.moreButton);
    await app.press(app.menuChoice('Kilometres'));

    await expect(app.plaque).toHaveText('26.9 km');
    await expect(app.caption).toContainText('26.9 km');
    await expect(app.ringLabels.filter({ visible: true }).first()).toHaveText(/ km$/);
    expect((await app.state()).units).toBe('km');
  });

  test('the choice of units is kept across a reload, out of the address', async ({ app }) => {
    await app.press(app.moreButton);
    await app.press(app.menuChoice('Kilometres'));
    await expect(app.plaque).toHaveText('26.9 km');
    expect(await app.hash()).toBe('');

    await app.reload();

    await expect(app.plaque).toHaveText('26.9 km');
    await app.press(app.moreButton);
    await expect(app.menuChoice('Kilometres')).toBeChecked();
  });

  test('the U key switches between miles and kilometres', { tag: '@desktop' }, async ({ app, page }) => {
    await page.keyboard.press('u');
    await expect(app.plaque).toHaveText('26.9 km');
    await page.keyboard.press('u');
    await expect(app.plaque).toHaveText('16.7 mi');
  });
});

test.describe('appearance', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('choosing Dark sets the theme on the page and the maps redraw', async ({ app, page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await app.press(app.moreButton);
    await app.press(app.menuChoice('Dark'));

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await app.state()).theme).toBe('dark');
    await app.drawn();
    const styleNames = await page.evaluate(() => {
      const { dual } = window.__wwiwiwhWatch.app();
      return [dual.base.getStyle().name, dual.overlay.getStyle().name];
    });
    expect(styleNames).toEqual(['wwiwiwh away, dark', 'wwiwiwh home, dark']);
  });

  test('the choice of theme is kept across a reload', async ({ app, page }) => {
    await app.press(app.moreButton);
    await app.press(app.menuChoice('Dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await app.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await app.state()).themeChoice).toBe('dark');
    await app.press(app.moreButton);
    await expect(app.menuChoice('Dark')).toBeChecked();
  });

  test('with no choice made the theme follows the system', async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await app.state()).themeChoice).toBe('auto');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
