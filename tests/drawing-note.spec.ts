import { expect, test } from './fixtures';

test.describe('while tiles are slow to arrive', () => {
  test('the first view is announced as being drawn until it is', async ({ app, mapService, page }) => {
    const letGo = mapService.holdTiles();
    await app.goto();

    const note = page.getByRole('status').filter({ hasText: 'Drawing London…' });
    await expect(note).toBeVisible();
    await expect(app.statusNote).toHaveAttribute('data-tone', 'loading');
    expect((await app.heard()).idles).toBe(0);

    letGo();
    await app.drawn();
    await expect(note).toHaveCount(0);
    await expect(app.statusNote).not.toHaveAttribute('data-tone');
  });

  test('a newly picked place is announced as being drawn until it is', async ({ app, mapService, page }) => {
    await app.open();
    const letGo = mapService.holdTiles();

    await app.pickPlace('away', 'Tokyo');

    const note = page.getByRole('status').filter({ hasText: 'Drawing Tokyo…' });
    await expect(note).toBeVisible();

    letGo();
    await app.drawn();
    await expect(note).toHaveCount(0);
  });

  test('a link that could not be understood is only spoken of once the view is drawn', async ({ app, mapService }) => {
    const letGo = mapService.holdTiles();
    await app.goto('home=atlantis&away=london');
    await expect(app.statusNote).toHaveAttribute('data-tone', 'loading');
    await expect(app.toast).toHaveCount(0);

    letGo();

    await expect(app.toast).toHaveText('That link was incomplete, so here is San Jose over London.');
  });
});
