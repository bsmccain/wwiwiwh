import { expect, test } from './fixtures';

test.describe('in a browser that cannot draw the maps', () => {
  test.beforeEach(async ({ app, context }) => {
    // What a browser with WebGL switched off does: it has no such drawing context to give.
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        if (kind.startsWith('webgl')) return null;
        return Reflect.apply(getContext, this, [kind, ...rest]) as RenderingContext | null;
      } as typeof getContext;
    });
    await app.goto();
  });

  test('the page says why, in place of the maps', async ({ page }) => {
    await expect(page.getByRole('alert').filter({ hasText: 'WebGL' })).toHaveText(
      "This browser can't draw the maps because WebGL is off. Turn on hardware acceleration or try another browser.",
    );
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('the legend still names the pair, with the map tools switched off', async ({ app, page }) => {
    await expect(app.legendName('home')).toHaveText('San Jose');
    await expect(app.legendName('away')).toHaveText('London');
    await expect(page).toHaveTitle('San Jose over London at the same scale | wwiwiwh');
    for (const tool of ['Slide Home', 'Measure', 'Rings', 'Hide Home'] as const) await expect(app.tool(tool)).toBeDisabled();
    await expect(app.copyLinkButton).toBeDisabled();
  });

  test('the viewer can still set the appearance, and it is kept', async ({ app, page }) => {
    await app.press(app.moreButton);
    await app.press(app.menuChoice('Dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
