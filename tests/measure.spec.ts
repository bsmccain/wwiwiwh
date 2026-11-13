import { formatDistance } from '../src/geo/units';
import { expect, test } from './fixtures';
import { tripOf } from './support/app';
import { dragWithMouse, expectPointNear } from './support/pointer';

/** The caption's sentence about a trip drawn by hand: both units where there is room, the one on narrow screens. */
function captionFor(meters: number): RegExp {
  const literal = (text: string): string => text.replace(/[.()]/g, '\\$&');
  const miles = literal(formatDistance(meters, 'mi'));
  const kilometres = literal(`(${formatDistance(meters, 'km')})`);
  return new RegExp(`^This line is ${miles}( ${kilometres})? in a straight line\\.$`);
}

test.describe('measuring by pointing', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('two presses on the map draw a trip between them', async ({ app }) => {
    const press = app.touch ? 'tap' : 'click';
    const start = await app.stagePoint(0.3, 0.3);
    const end = await app.stagePoint(0.65, 0.55);

    await app.press(app.tool('Measure'));
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.caption).toHaveText(`${press === 'tap' ? 'Tap' : 'Click'} where the trip starts.`);

    await app.pressAt(await app.onPage(start));
    await expect(app.caption).toHaveText(`Now ${press} where it ends.`);
    expect((await app.state()).tripDraft).not.toBeNull();

    await app.pressAt(await app.onPage(end));
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');
    const state = await app.state();
    expect(state.mode).toBe('browse');
    expect(state.tripDraft).toBeNull();
    const { ends } = tripOf(state);
    expectPointNear(ends[0], start);
    expectPointNear(ends[1], end);
  });

  test('the caption and the plaque give the length of the trip that was drawn', async ({ app }) => {
    await app.press(app.tool('Measure'));
    await app.pressAt(await app.stageSpot(0.3, 0.3));
    await app.pressAt(await app.stageSpot(0.65, 0.55));
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');

    const { meters } = tripOf(await app.state());
    expect(meters).toBeGreaterThan(1_000);
    await expect(app.caption).toHaveText(captionFor(meters));
    await expect(app.plaque).toHaveText(formatDistance(meters, 'mi'));
  });

  test('a new trip is written to the address once it has settled', async ({ app, page }) => {
    await app.press(app.tool('Measure'));
    await app.pressAt(await app.stageSpot(0.3, 0.3));
    await app.pressAt(await app.stageSpot(0.65, 0.55));

    await expect(page).toHaveURL(/[#&]trip=-?\d+(\.\d+)?,-?\d+(\.\d+)?~-?\d+(\.\d+)?,-?\d+(\.\d+)?/);
  });

  test('Cancel on the caption leaves the trip that was there', async ({ app }) => {
    const before = await app.state();
    await app.press(app.tool('Measure'));
    await app.pressAt(await app.stageSpot(0.3, 0.3));

    await app.press(app.captionButton('Cancel'));

    const after = await app.state();
    expect(after.mode).toBe('browse');
    expect(after.tripDraft).toBeNull();
    expect(after.trip).toEqual(before.trip);
  });

  test('Clear line removes the trip, in the address too', async ({ app, page }) => {
    await app.press(app.captionButton('Clear line'));

    expect((await app.state()).trip).toBeNull();
    await expect(app.plaque).toBeHidden();
    await expect(page).toHaveURL(/[#&]trip=none(&|$)/);
  });
});

test.describe('the ends of a trip', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('an end can be dragged to a new spot, and the trip is measured again', async ({ app, fingers, page }) => {
    const before = await app.state();
    const [start] = tripOf(before).ends;
    const from = await app.onPage(start);
    // Towards the middle of the stage, a good deal further than a finger drifts.
    const to = { x: from.x + 70, y: from.y + 80 };

    await app.comeTo(from);
    if (app.touch) await fingers.drag(from, to, 12);
    else await dragWithMouse(page, from, to, { steps: 12 });

    const after = await app.state();
    const moved = tripOf(after);
    expectPointNear(await app.onPage(moved.ends[0]), to);
    // Only that end moved: the other one, Home and Away are where they were.
    expect(moved.trip.to).toEqual(tripOf(before).trip.to);
    expect(after.reg).toEqual(before.reg);
    expect(after.camera).toEqual(before.camera);
    await expect(app.plaque).toHaveText(formatDistance(moved.meters, 'mi'));
    await expect(page).toHaveURL(/[#&]trip=/);
  });

  test('an end can be moved with the arrow keys', { tag: '@desktop' }, async ({ app, page }) => {
    const before = await app.state();

    await page.getByRole('button', { name: 'Trip start', exact: true }).focus();
    await page.keyboard.press('ArrowRight');

    const after = await app.state();
    expect(tripOf(after).ends[0].x).toBeGreaterThan(tripOf(before).ends[0].x);
    expect(tripOf(after).ends[0].y).toBeCloseTo(tripOf(before).ends[0].y, 0);
    // The arrow went to the handle: neither map moved.
    expect(after.camera).toEqual(before.camera);
    expect(after.reg).toEqual(before.reg);
  });
});

test.describe('measuring with a mouse and a keyboard', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('M, Enter, a move of the map and Enter draw a trip from the keyboard', async ({ app, page }) => {
    const centreMark = page.locator('.mapz-measure-center');

    await page.keyboard.press('m');
    await expect(app.caption).toHaveText('Press Enter to set the start at the centre mark.');
    await expect(centreMark).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(app.caption).toHaveText('Move the map, then press Enter to set the end.');
    expect((await app.state()).tripDraft).not.toBeNull();

    await page.keyboard.press('ArrowRight');
    await app.drawn();
    await page.keyboard.press('Enter');

    const state = await app.state();
    expect(state.mode).toBe('browse');
    const centre = { x: state.stage.width / 2, y: state.stage.height / 2 };
    // The start has moved off with the map by one step of the arrow key; the end is at the centre.
    const { ends, meters } = tripOf(state);
    expectPointNear(ends[0], { x: centre.x - 100, y: centre.y }, 2);
    expectPointNear(ends[1], centre, 2);
    await expect(app.caption).toHaveText(captionFor(meters));
    await expect(centreMark).toBeHidden();
  });

  test('Enter drops a trip end whatever had focus when measuring began', async ({ app, page }) => {
    await app.swapButton.focus();

    await page.keyboard.press('m');
    await page.keyboard.press('Enter');

    const state = await app.state();
    expect(state.tripDraft).not.toBeNull();
    // Enter went to measuring, not to the button that had focus.
    expect(state.home.name).toBe('San Jose');
  });

  test('Measure started from its own button with Enter takes the next Enter as a trip end', async ({ app, page }) => {
    await app.tool('Measure').focus();

    await page.keyboard.press('Enter');
    expect((await app.state()).mode).toBe('measure');
    await page.keyboard.press('Enter');

    const state = await app.state();
    expect(state.mode).toBe('measure');
    expect(state.tripDraft).not.toBeNull();
  });

  test('Escape cancels measuring and keeps the trip that was there', async ({ app, page }) => {
    const before = await app.state();
    await page.keyboard.press('m');
    await page.keyboard.press('Enter');
    expect((await app.state()).tripDraft).not.toBeNull();

    await page.keyboard.press('Escape');

    const after = await app.state();
    expect(after.mode).toBe('browse');
    expect(after.tripDraft).toBeNull();
    expect(after.trip).toEqual(before.trip);
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a double-click zooms in when not measuring', async ({ app, page }) => {
    const before = await app.state();
    const spot = await app.stageSpot(0.3, 0.3);

    await page.mouse.dblclick(spot.x, spot.y);
    await app.drawn();

    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom + 1, 2);
  });

  test('a double-click while measuring does not zoom, and counts as one end', async ({ app, page }) => {
    const before = await app.state();
    const spot = await app.stageSpot(0.3, 0.3);
    await app.tool('Measure').click();

    await page.mouse.dblclick(spot.x, spot.y);
    await app.drawn();

    const after = await app.state();
    expect(after.camera).toEqual(before.camera);
    expect(after.mode).toBe('measure');
    expect(after.tripDraft).not.toBeNull();
    expect(after.trip).toEqual(before.trip);
  });
});

test.describe('measuring with fingers', { tag: '@phone' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('a double tap zooms in when not measuring', async ({ app, page }) => {
    const before = await app.state();
    const spot = await app.stageSpot(0.3, 0.3);

    await page.touchscreen.tap(spot.x, spot.y);
    await page.touchscreen.tap(spot.x, spot.y);
    await app.drawn();

    expect((await app.state()).camera.zoom).toBeCloseTo(before.camera.zoom + 1, 2);
  });

  test('a double tap while measuring does not zoom, and counts as one end', async ({ app, page }) => {
    const before = await app.state();
    const spot = await app.stageSpot(0.3, 0.3);
    await app.tool('Measure').tap();

    await page.touchscreen.tap(spot.x, spot.y);
    await page.touchscreen.tap(spot.x, spot.y);
    await app.drawn();

    const after = await app.state();
    expect(after.camera).toEqual(before.camera);
    expect(after.mode).toBe('measure');
    expect(after.tripDraft).not.toBeNull();
  });
});
