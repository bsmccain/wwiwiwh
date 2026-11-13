import { expect, test } from './fixtures';

test.describe('About mapz', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('opens from More and gives the credits the map data asks for', async ({ app, page }) => {
    await app.press(app.moreButton);
    await app.press(app.menu.getByRole('button', { name: 'About mapz' }));

    const about = page.getByRole('dialog', { name: 'About mapz' });
    await expect(about).toBeVisible();
    await expect(about.getByRole('link', { name: /OpenStreetMap/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(about.getByRole('link', { name: /OpenFreeMap/ })).toHaveAttribute('href', 'https://openfreemap.org');
    await expect(about).toContainText('Both maps are drawn at the same ground scale');
  });

  test('closes again and hands focus back to More', { tag: '@desktop' }, async ({ app, page }) => {
    await app.moreButton.click();
    await app.menu.getByRole('button', { name: 'About mapz' }).click();
    const about = page.getByRole('dialog', { name: 'About mapz' });
    await expect(about).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(about).toBeHidden();
    await expect(app.moreButton).toBeFocused();
  });

  test('opens from the credit on the map', { tag: '@phone' }, async ({ page }) => {
    await page.getByRole('button', { name: /^Map credits/ }).tap();
    await expect(page.getByRole('dialog', { name: 'About mapz' })).toBeVisible();
  });
});
