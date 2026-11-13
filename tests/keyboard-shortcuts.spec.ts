import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import type { WwiwiwhApp } from './support/app';

function singleKeysChoice(app: WwiwiwhApp, word: 'On' | 'Off'): Locator {
  return app.menu.getByRole('group', { name: 'Single-key shortcuts' }).getByRole('radio', { name: word, exact: true });
}

test.describe('single-key shortcuts', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('are on to begin with', async ({ app, page }) => {
    await page.keyboard.press('g');
    expect((await app.state()).rings).toBe(false);
    await page.keyboard.press('s');
    expect((await app.state()).mode).toBe('slide');
  });

  test('do nothing while the place picker has the keyboard', async ({ app, page }) => {
    await page.keyboard.press('2');
    await expect(app.picker).toBeVisible();

    await page.keyboard.type('g');

    await expect(app.picker.getByRole('combobox')).toHaveValue('g');
    expect((await app.state()).rings).toBe(true);
  });

  test('can be switched off in More, after which a letter on its own does nothing', async ({ app, page }) => {
    await app.moreButton.click();
    await singleKeysChoice(app, 'Off').click();
    expect((await app.state()).shortcutsOn).toBe(false);
    await page.keyboard.press('Escape');
    await expect(app.menu).toHaveCount(0);

    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await page.keyboard.press(']');

    const state = await app.state();
    expect(state.rings).toBe(true);
    expect(state.mode).toBe('browse');
    expect(state.reg.rotation).toBe(0);
  });

  test('switched off, the keys that are not letters still work', async ({ app, page }) => {
    await app.moreButton.click();
    await singleKeysChoice(app, 'Off').click();
    await page.keyboard.press('Escape');
    const before = await app.state();

    await page.keyboard.press('+');
    await app.drawn();
    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom + 1, 2);

    await page.keyboard.press('Shift+BracketRight');
    expect((await app.state()).reg.rotation).toBeCloseTo(1, 6);
  });

  test('stay off after a reload', async ({ app, page }) => {
    await app.moreButton.click();
    await singleKeysChoice(app, 'Off').click();

    await app.reload();

    expect((await app.state()).shortcutsOn).toBe(false);
    await page.keyboard.press('g');
    expect((await app.state()).rings).toBe(true);
    await app.moreButton.click();
    await expect(singleKeysChoice(app, 'Off')).toBeChecked();
  });

  test('the ? key opens the list of shortcuts', async ({ page }) => {
    await page.keyboard.press('?');

    const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(list).toBeVisible();
    await expect(list).toContainText('Swap Home and Away');
    await expect(list).toContainText('Keys pressed on their own can be switched off under More');
  });

  test('switched off, the list of shortcuts says so', async ({ app, page }) => {
    await app.moreButton.click();
    await singleKeysChoice(app, 'Off').click();

    await app.menu.getByRole('button', { name: 'Keyboard shortcuts' }).click();

    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Single-key shortcuts are off; switch them on under More.');
  });
});
