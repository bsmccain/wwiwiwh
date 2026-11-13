import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectSheetOnScreen, reachOfPage, tooSmall, touchTargets } from './support/phone-screen';

const PHONES = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
] as const;

/** The collar's buttons, and the controls that stand on the map. */
function controlsOnThePage(page: Page): Locator {
  return page.locator('.collar button, .caption button, .zoom__button, .stage__credit, .hint__close, .wwiwiwh-handle');
}

for (const phone of PHONES) {
  test.describe(`on a phone ${phone.width} by ${phone.height}`, { tag: '@phone' }, () => {
    test.use({ viewport: phone });

    test.beforeEach(async ({ app }) => {
      await app.open();
    });

    test('the page fits the screen and nothing on it reaches outside', async ({ page }) => {
      const overflow = await reachOfPage(page);

      expect(overflow.scrollWidth).toBeLessThanOrEqual(phone.width);
      expect(overflow.scrollHeight).toBeLessThanOrEqual(phone.height);
      expect(overflow.outside).toEqual([]);
    });

    test('every control is a touch target of at least 48px', async ({ page }) => {
      const targets = await touchTargets(controlsOnThePage(page));
      expect(targets.length).toBeGreaterThanOrEqual(12);
      expect(tooSmall(targets)).toEqual([]);
    });

    test('the buttons of slide mode are touch targets of at least 48px', async ({ app, page }) => {
      await app.tool('Slide Home').tap();
      await expect(app.slideTool('Done')).toBeVisible();

      const targets = await touchTargets(page.locator('.slide-tools button'));
      expect(targets).toHaveLength(7);
      expect(tooSmall(targets)).toEqual([]);
    });

    test('the place picker opens as a sheet that stays on the screen', async ({ app }) => {
      await app.legendRow('away').tap();

      await expect(app.picker).toHaveAttribute('data-layout', 'sheet');
      await expectSheetOnScreen(app.picker.getByRole('dialog'), phone);
    });

    test('tapping outside the sheet closes it and touches nothing beneath', async ({ app, page }) => {
      const before = await app.state();
      await app.legendRow('away').tap();
      await expect(app.picker).toHaveAttribute('data-layout', 'sheet');
      await expect(app.pickerOption('Tokyo').first()).toBeVisible();

      // The map shows above the sheet; a tap there belongs to the sheet, not to the map.
      await page.touchscreen.tap(40, 60);

      await expect(app.picker).toHaveCount(0);
      await expect(app.legendRow('away')).toHaveAttribute('aria-expanded', 'false');
      const after = await app.state();
      expect(after.camera).toEqual(before.camera);
      expect(after.reg).toEqual(before.reg);
      expect(after.away).toEqual(before.away);
    });

    test('More opens as a sheet, without the keyboard settings', async ({ app }) => {
      await app.moreButton.tap();

      await expect(app.menu).toHaveAttribute('data-layout', 'sheet');
      await expect(app.menuChoice('Kilometres')).toBeVisible();
      await expect(app.menu.getByText('Single-key shortcuts')).toHaveCount(0);
      await expect(app.menu.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    });
  });
}
