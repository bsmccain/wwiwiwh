import { expect, test } from './fixtures';

test.describe('the one-time hint about sliding Home', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('comes up on a first visit, worded for the device', async ({ app, page }) => {
    await expect(page.locator('.hint')).toBeVisible();
    await expect(page.locator('.hint__text')).toHaveText(
      app.touch ? 'Tap Slide Home to move San Jose on its own.' : 'Hold Shift and drag to slide San Jose on its own.',
    );
  });

  test('names the new Home after Swap', async ({ app, page }) => {
    await app.press(app.swapButton);
    await expect(page.locator('.hint__text')).toContainText('London on its own.');
  });

  test('steps aside while the place picker is open', async ({ app, page }) => {
    await app.press(app.legendRow('home'));
    await expect(app.picker).toBeVisible();
    await expect(page.locator('.hint')).toBeHidden();
  });

  test('goes for good once Slide Home has been used', async ({ app, page }) => {
    await app.press(app.tool('Slide Home'));
    await expect(page.locator('.hint')).toHaveCount(0);

    await app.reload();

    expect((await app.state()).slideHintDone).toBe(true);
    await expect(page.locator('.hint')).toHaveCount(0);
  });

  test('goes for good when it is closed', async ({ app, page }) => {
    await app.press(page.locator('.hint').getByRole('button', { name: 'Close' }));
    await expect(page.locator('.hint')).toHaveCount(0);

    await app.reload();

    await expect(page.locator('.hint')).toHaveCount(0);
  });
});
