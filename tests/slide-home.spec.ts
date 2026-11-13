import { distanceMeters } from '../src/geo/distance';
import { expect, test } from './fixtures';
import { expectPinInAddress, expectViewInAddress } from './support/address';
import type { Snapshot } from './support/app';
import { dragWithMouse, expectPointNear } from './support/pointer';

/** One stage pixel is about 40 m of ground at the default view; positions that agree to a pixel or so are the same spot. */
const SAME_SPOT_METERS = 80;

function expectAwayUnmoved(after: Snapshot, before: Snapshot): void {
  expect(after.camera).toEqual(before.camera);
}

test.describe('sliding Home with a mouse', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('Shift+drag slides Home only, with the pin under the pointer', async ({ app, page }) => {
    const before = await app.state();
    const from = await app.stageSpot(0.35, 0.4);
    const to = { x: from.x + 120, y: from.y + 70 };
    const grabbedHome = await app.homeUnder(from);

    await dragWithMouse(page, from, to, { holding: 'Shift' });

    const after = await app.state();
    expectAwayUnmoved(after, before);
    // The pin jumped to the spot that was grabbed, and that spot of Home went with the pointer.
    expectPointNear(await app.onPage(after.pin), to);
    expect(distanceMeters(after.reg.overlayAnchor, grabbedHome)).toBeLessThan(SAME_SPOT_METERS);
    expect(after.mode).toBe('browse');
  });

  test('a slide is written to the address as the pin once it has settled', async ({ app, page }) => {
    const from = await app.stageSpot(0.35, 0.4);
    await dragWithMouse(page, from, { x: from.x + 120, y: from.y + 70 }, { holding: 'Shift' });

    await expectPinInAddress(app);
    // Sliding Home is not a choice of view: the view stays the app's to frame.
    expect(await app.hash()).not.toContain('view=');
  });

  test('a plain drag moves both maps together and leaves the pin on its ground', async ({ app, page }) => {
    const before = await app.state();
    const from = await app.stageSpot(0.35, 0.4);

    await dragWithMouse(page, from, { x: from.x + 120, y: from.y + 70 });
    await app.drawn();

    const after = await app.state();
    expect(after.reg).toEqual(before.reg);
    expect(after.pin.x - before.pin.x).toBeGreaterThan(100);
    expect(after.pin.y - before.pin.y).toBeGreaterThan(50);
    await expectViewInAddress(app);
    expect(await app.hash()).not.toContain('pin=');
  });

  test('with Slide Home on, a plain drag slides Home only', async ({ app, page }) => {
    await app.tool('Slide Home').click();
    await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.caption).toHaveText('Sliding Home. Drag to slide it; hold Alt and drag to turn it.');
    const before = await app.state();
    const from = await app.stageSpot(0.35, 0.4);
    const to = { x: from.x + 90, y: from.y - 60 };

    await dragWithMouse(page, from, to);

    const after = await app.state();
    expectAwayUnmoved(after, before);
    expectPointNear(await app.onPage(after.pin), to);
    expect(after.mode).toBe('slide');
  });

  test('Escape leaves slide mode', async ({ app, page }) => {
    await app.tool('Slide Home').click();
    expect((await app.state()).mode).toBe('slide');

    await page.keyboard.press('Escape');

    await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'false');
    expect((await app.state()).mode).toBe('browse');
  });

  test('Shift with an arrow key slides Home by a step', async ({ app, page }) => {
    const before = await app.state();

    await page.keyboard.press('Shift+ArrowRight');

    const after = await app.state();
    expectAwayUnmoved(after, before);
    expectPointNear(after.pin, { x: before.pin.x + 32, y: before.pin.y }, 0.5);
    expect(after.reg.overlayAnchor).toEqual(before.reg.overlayAnchor);
  });
});

test.describe('sliding Home with a finger', { tag: '@phone' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('with Slide Home on, a drag slides Home only, with the pin under the finger', async ({ app, fingers }) => {
    await app.tool('Slide Home').tap();
    await expect(app.caption).toHaveText('Sliding Home. Drag to slide it, twist with two fingers to turn it.');
    const before = await app.state();
    const from = await app.stageSpot(0.3, 0.35);
    const to = { x: from.x + 70, y: from.y + 90 };
    const grabbedHome = await app.homeUnder(from);

    await fingers.drag(from, to);

    const after = await app.state();
    expectAwayUnmoved(after, before);
    expectPointNear(await app.onPage(after.pin), to);
    expect(distanceMeters(after.reg.overlayAnchor, grabbedHome)).toBeLessThan(SAME_SPOT_METERS);
    await expectPinInAddress(app);
  });

  test('without Slide Home, a drag moves both maps together', async ({ app, fingers }) => {
    const before = await app.state();
    const from = await app.stageSpot(0.3, 0.35);

    await fingers.drag(from, { x: from.x + 70, y: from.y + 90 });
    await app.drawn();

    const after = await app.state();
    expect(after.reg).toEqual(before.reg);
    expect(after.pin.x - before.pin.x).toBeGreaterThan(60);
    expect(after.pin.y - before.pin.y).toBeGreaterThan(80);
    await expectViewInAddress(app);
  });

  test('slide mode swaps the tools for buttons that nudge Home, and Done brings them back', async ({ app }) => {
    await app.tool('Slide Home').tap();
    await expect(app.slideTool('Done')).toBeVisible();
    await expect(app.tool('Measure')).toBeHidden();
    const before = await app.state();

    await app.slideTool('Slide Home right').tap();

    const after = await app.state();
    expectAwayUnmoved(after, before);
    expectPointNear(after.pin, { x: before.pin.x + 16, y: before.pin.y }, 0.5);

    await app.slideTool('Done').tap();
    await expect(app.tool('Measure')).toBeVisible();
    expect((await app.state()).mode).toBe('browse');
  });
});

test.describe('the pin handle', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('can be dragged a long way, sliding Home under it without re-pinning', async ({ app, fingers, page }) => {
    const before = await app.state();
    const from = await app.onPage(before.pin);
    const to = { x: from.x + 80, y: from.y + 90 };

    await app.comeTo(from);
    if (app.touch) await fingers.drag(from, to, 12);
    else await dragWithMouse(page, from, to, { steps: 12 });

    const after = await app.state();
    expectAwayUnmoved(after, before);
    expectPointNear(await app.onPage(after.pin), to);
    // The same spot of Home is still the one that is pinned.
    expect(after.reg.overlayAnchor).toEqual(before.reg.overlayAnchor);
    await expectPinInAddress(app);
  });

  test('dragging the pin is announced as one slide, from its first move to the release', { tag: '@desktop' }, async ({ app, page }) => {
    const gestures = await page.evaluateHandle(() => {
      const heard: string[] = [];
      window.__mapzWatch.app().dual.on('gesture', ({ kind, phase }) => heard.push(`${kind} ${phase}`));
      return heard;
    });
    const from = await app.onPage((await app.state()).pin);

    await app.comeTo(from);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 8 });
    expect(await gestures.jsonValue()).toEqual(['slide start']);
    await expect(page.locator('.mapz-stage')).toHaveClass(/mapz-stage--sliding/);

    await page.mouse.up();
    expect(await gestures.jsonValue()).toEqual(['slide start', 'slide end']);
    await expect(page.locator('.mapz-stage')).not.toHaveClass(/mapz-stage--sliding/);
  });
});
