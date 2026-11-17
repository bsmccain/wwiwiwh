import { expect, test } from './fixtures';

test.describe('About wwiwiwh', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('opens from More and gives the credits the map data asks for', async ({ app, page }) => {
    await app.press(app.moreButton);
    await app.press(app.menu.getByRole('button', { name: 'About wwiwiwh' }));

    const about = page.getByRole('dialog', { name: 'About wwiwiwh' });
    await expect(about).toBeVisible();
    await expect(about.getByRole('link', { name: /OpenStreetMap/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(about.getByRole('link', { name: /OpenFreeMap/ })).toHaveAttribute('href', 'https://openfreemap.org');
    await expect(about.getByRole('link', { name: /^GitHub/ })).toHaveAttribute('href', 'https://github.com/bsmccain/wwiwiwh');
    await expect(about.getByRole('link', { name: /^Open an issue/ })).toHaveAttribute('href', 'https://github.com/bsmccain/wwiwiwh/issues');
    await expect(about.getByRole('link', { name: /^release notes/ })).toHaveAttribute('href', 'https://github.com/bsmccain/wwiwiwh/releases');
    await expect(about).toContainText('Both maps are drawn at the same ground scale');
  });

  test('closes again and hands focus back to More', { tag: '@desktop' }, async ({ app, page }) => {
    await app.moreButton.click();
    await app.menu.getByRole('button', { name: 'About wwiwiwh' }).click();
    const about = page.getByRole('dialog', { name: 'About wwiwiwh' });
    await expect(about).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(about).toBeHidden();
    await expect(app.moreButton).toBeFocused();
  });

  test('opens from the credit on the map', { tag: '@phone' }, async ({ page }) => {
    await page.getByRole('button', { name: /^Map credits/ }).tap();
    await expect(page.getByRole('dialog', { name: 'About wwiwiwh' })).toBeVisible();
  });
});
