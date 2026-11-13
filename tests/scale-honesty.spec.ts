import { expect, test } from './fixtures';

/**
 * San Jose over London, looked at from Edinburgh. The pin is some 530 km to the south, and this far
 * north of it the two maps differ in scale by about 4%.
 */
const FAR_FROM_THE_PIN = 'home=san-jose&away=london&view=55.95,-3.19,11';
/** The same pair from far out, where the two maps stretch differently across one screen. */
const FAR_OUT = 'home=san-jose&away=london&view=51.5073,-0.1276,5';

test.describe('where the two maps stop matching', () => {
  test('far from the pin the caption says by how much they differ', async ({ app }) => {
    await app.open(FAR_FROM_THE_PIN);

    await expect(app.caption).toHaveText(/^The two maps match at the pin\. This far from it they differ by about \d+%\.$/);
    await expect(app.captionBand).toHaveAttribute('data-tone', 'loud');
    await expect(app.captionButton('Pin here')).toBeVisible();
  });

  test('zooming in does not make a warning about distance go away', async ({ app }) => {
    await app.open(FAR_FROM_THE_PIN);
    await expect(app.caption).toContainText('This far from it they differ');

    await app.press(app.zoomButton('in'));
    await app.drawn();

    await expect(app.caption).toContainText('This far from it they differ');
  });

  test('Pin here puts the pin in the middle of the view and the maps match again', async ({ app }) => {
    await app.open(FAR_FROM_THE_PIN);
    const before = await app.state();

    await app.press(app.captionButton('Pin here'));

    await expect(app.caption).not.toContainText('differ');
    const after = await app.state();
    expect(after.camera).toEqual(before.camera);
    expect(after.pin.x).toBeCloseTo(after.stage.width / 2, 0);
    expect(after.pin.y).toBeCloseTo(after.stage.height / 2, 0);
  });

  test('with the pin off the stage a chip points to it, and brings it back', async ({ app, page }) => {
    await app.open(FAR_FROM_THE_PIN);
    const chip = page.locator('.wwiwiwh-pin-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAccessibleName(/^Pin \d+ mi away\. Bring it into view\.$/);
    await expect(app.pinHandle).not.toBeInViewport();

    await app.press(chip);
    await app.drawn();

    await expect(chip).toBeHidden();
    const { pin, stage } = await app.state();
    expect(pin.x).toBeCloseTo(stage.width / 2, 0);
    expect(pin.y).toBeCloseTo(stage.height / 2, 0);
    // Going to the pin is the person's own move: the address takes the new view.
    await expect(page).toHaveURL(/[#&]view=51\.50\d*,-0\.12\d*,11(&|$)/);
  });

  test('far out the caption says to zoom in', async ({ app }) => {
    await app.open(FAR_OUT);
    await expect(app.caption).toHaveText('Zoom in to compare. This far out the two maps stretch differently.');
  });

  test('picking a place in the other hemisphere raises no warning on the way', async ({ app, page }) => {
    await app.open();
    // Every wording the caption takes from here on, however briefly.
    const wordings = await page.evaluateHandle(() => {
      const caption = document.querySelector('.caption__text');
      if (!caption) throw new Error('There is no caption.');
      const seen: string[] = [];
      new MutationObserver(() => seen.push(caption.textContent ?? '')).observe(caption, { childList: true, characterData: true, subtree: true });
      return seen;
    });

    await app.pickPlace('away', 'Sydney');
    await expect(app.legendName('away')).toHaveText('Sydney');
    await app.drawn();

    await expect(app.caption).toContainText(/^Palo Alto to San Jose is /);
    expect((await wordings.jsonValue()).filter((wording) => /differ|stretch/.test(wording))).toEqual([]);
  });
});
