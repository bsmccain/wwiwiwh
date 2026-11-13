import { distanceMeters } from '../src/geo/distance';
import { expect, test } from './fixtures';
import { expectViewInAddress } from './support/address';

test.describe('zooming', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('the zoom buttons zoom both maps a level at a time about the middle', async ({ app }) => {
    const before = await app.state();

    await app.press(app.zoomButton('in'));
    await app.drawn();

    const zoomedIn = await app.state();
    expect(zoomedIn.camera.zoom).toBeCloseTo(before.camera.zoom + 1, 2);
    expect(distanceMeters(zoomedIn.camera.center, before.camera.center)).toBeLessThan(5);
    // Home stays registered: the pin has not left its ground.
    expect(zoomedIn.reg).toEqual(before.reg);

    await app.press(app.zoomButton('out'));
    await app.press(app.zoomButton('out'));
    await app.drawn();
    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom - 1, 2);
  });

  test('a zoom by button is written to the address once it has settled', async ({ app }) => {
    const before = await app.state();

    await app.press(app.zoomButton('in'));
    await app.drawn();

    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom + 1, 2);
    await expectViewInAddress(app);
  });

  test('a reload restores the zoomed view', async ({ app }) => {
    await app.press(app.zoomButton('in'));
    await app.drawn();
    await expectViewInAddress(app);
    const before = await app.state();

    await app.reload();

    const after = await app.state();
    expect(after.camera.zoom).toBeCloseTo(before.camera.zoom, 2);
    expect(distanceMeters(after.camera.center, before.camera.center)).toBeLessThan(5);
    expect(after.view).not.toBeNull();
  });
});

test.describe('zooming and moving from the keyboard', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('the + and - keys zoom both maps and the address follows', async ({ app, page }) => {
    const before = await app.state();

    await page.keyboard.press('+');
    await app.drawn();
    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom + 1, 2);
    await expectViewInAddress(app);

    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await app.drawn();
    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom - 1, 2);
    await expectViewInAddress(app);
  });

  test('the arrow keys move both maps and the address follows', async ({ app, page }) => {
    const before = await app.state();

    await page.keyboard.press('ArrowRight');
    await app.drawn();

    const after = await app.state();
    expect(after.pin.x).toBeCloseTo(before.pin.x - 100, 0);
    expect(after.pin.y).toBeCloseTo(before.pin.y, 0);
    expect(after.reg).toEqual(before.reg);
    await expectViewInAddress(app);
  });

  test('a view zoomed by key survives a reload', async ({ app, page }) => {
    await page.keyboard.press('+');
    await app.drawn();
    await expectViewInAddress(app);
    const before = await app.state();

    await app.reload();

    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom, 2);
  });
});

test.describe('zooming with two fingers', { tag: '@phone' }, () => {
  test('a pinch outwards zooms both maps in and the address follows', async ({ app, fingers }) => {
    await app.open();
    const before = await app.state();
    const centre = await app.stageSpot(0.5, 0.4);

    await fingers.down({ x: centre.x - 40, y: centre.y }, { x: centre.x + 40, y: centre.y });
    for (let reach = 50; reach <= 120; reach += 10) {
      await fingers.moveTo({ x: centre.x - reach, y: centre.y }, { x: centre.x + reach, y: centre.y });
    }
    await fingers.lift();
    await app.drawn();

    const after = await app.state();
    // Three times as far apart is a little over a level and a half.
    expect(after.camera.zoom - before.camera.zoom).toBeGreaterThan(1);
    expect(after.reg).toEqual(before.reg);
    await expectViewInAddress(app);
  });
});

test.describe('the ends of the zoom range', () => {
  test('Zoom in has nothing left to do at the closest zoom', async ({ app }) => {
    await app.open('home=san-jose&away=london&view=51.5073,-0.1276,18');
    await expect(app.zoomButton('in')).toBeDisabled();
    await expect(app.zoomButton('out')).toBeEnabled();
  });

  test('Zoom out has nothing left to do at the furthest zoom', async ({ app }) => {
    await app.open('home=san-jose&away=london&view=51.5073,-0.1276,4');
    await expect(app.zoomButton('out')).toBeDisabled();
    await expect(app.zoomButton('in')).toBeEnabled();
  });
});
