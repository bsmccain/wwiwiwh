import type { ScreenPoint } from '../src/map/contracts';
import { expect, test } from './fixtures';
import { tripOf, type Snapshot } from './support/app';
import type { Fingers } from './support/fingers';
import { middleOf } from './support/pointer';

/** Which way the trip's far end lies from the pin on screen, in degrees clockwise from east. */
function tripBearingOnScreen(snapshot: Snapshot): number {
  const [farEnd] = tripOf(snapshot).ends;
  return (Math.atan2(farEnd.y - snapshot.pin.y, farEnd.x - snapshot.pin.x) * 180) / Math.PI;
}

/** Two fingers either side of `centre`, turned clockwise about it by `degrees`, a few degrees at a time. */
async function twist(fingers: Fingers, centre: ScreenPoint, degrees: number): Promise<void> {
  const reach = 90;
  const fingersAt = (turned: number): [ScreenPoint, ScreenPoint] => {
    const angle = (turned * Math.PI) / 180;
    const across = reach * Math.cos(angle);
    const down = reach * Math.sin(angle);
    return [
      { x: centre.x - across, y: centre.y - down },
      { x: centre.x + across, y: centre.y + down },
    ];
  };
  await fingers.down(...fingersAt(0));
  for (let turned = 4; turned <= degrees; turned += 4) await fingers.moveTo(...fingersAt(turned));
  await fingers.lift();
}

test.describe('turning Home from the collar and the keyboard', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('the turn buttons turn Home 5 degrees at a time about the pin', async ({ app }) => {
    const before = await app.state();

    await app.turnButton('right').click();

    const after = await app.state();
    expect(after.reg.rotation).toBeCloseTo(5, 6);
    expect(after.camera).toEqual(before.camera);
    expect(after.pin).toEqual(before.pin);
    // What is drawn on Home swings round the pin by as much, clockwise.
    expect(tripBearingOnScreen(after) - tripBearingOnScreen(before)).toBeCloseTo(5, 1);

    await app.turnButton('left').click();
    await app.turnButton('left').click();
    expect((await app.state()).reg.rotation).toBeCloseTo(-5, 6);
  });

  test('a second click on the same spot turns Home further: the buttons do not move under the pointer', async ({ app, page }) => {
    const spot = await middleOf(app.turnButton('right'));

    await page.mouse.click(spot.x, spot.y);
    await page.mouse.click(spot.x, spot.y);

    expect((await app.state()).reg.rotation).toBeCloseTo(10, 6);
  });

  test('the turn readout follows, in words for the eye and for the ear', async ({ app }) => {
    const shown = app.turnReadout;
    const spoken = app.turnReadoutSpoken;
    await expect(shown).toHaveText('Home is not turned.');

    await app.turnButton('right').click();
    await expect(shown).toHaveText('Home is turned 5° right.');
    await expect(spoken).toHaveText('Home is turned 5 degrees clockwise.');

    await app.turnButton('left').click();
    await app.turnButton('left').click();
    await expect(shown).toHaveText('Home is turned 5° left.');
    await expect(spoken).toHaveText('Home is turned 5 degrees counterclockwise.');
  });

  test('the bracket keys turn Home, by single degrees with Shift', async ({ app, page }) => {
    await page.keyboard.press(']');
    expect((await app.state()).reg.rotation).toBeCloseTo(5, 6);

    await page.keyboard.press('[');
    await page.keyboard.press('[');
    expect((await app.state()).reg.rotation).toBeCloseTo(-5, 6);

    await page.keyboard.press('Shift+BracketRight');
    expect((await app.state()).reg.rotation).toBeCloseTo(-4, 6);
  });

  test('Square up puts Home back and then has nothing left to do', async ({ app, page }) => {
    const squareUp = app.squareUpButton;
    await expect(squareUp).toBeDisabled();
    await page.keyboard.press(']');
    await expect(squareUp).toBeEnabled();

    await squareUp.click();

    expect((await app.state()).reg.rotation).toBe(0);
    await expect(squareUp).toBeDisabled();
    await expect(app.turnReadout).toHaveText('Home is not turned.');
  });

  test('the 0 key squares Home up', async ({ app, page }) => {
    await page.keyboard.press(']');
    expect((await app.state()).reg.rotation).toBeCloseTo(5, 6);

    await page.keyboard.press('0');

    expect((await app.state()).reg.rotation).toBe(0);
  });

  test('a turn is written to the address once it has settled', async ({ page }) => {
    await page.keyboard.press(']');
    await page.keyboard.press(']');
    await expect(page).toHaveURL(/[#&]turn=10(&|$)/);
  });

  test('Line up again in More undoes a slide and a turn', async ({ app, page }) => {
    const before = await app.state();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press(']');
    expect((await app.state()).reg).not.toEqual(before.reg);

    await app.moreButton.click();
    await app.menu.getByRole('button', { name: /^Line up again/ }).click();
    await app.drawn();

    const after = await app.state();
    expect(after.reg).toEqual(before.reg);
    expect(after.pin.x).toBeCloseTo(after.stage.width / 2, 0);
    expect(after.pin.y).toBeCloseTo(after.stage.height / 2, 0);
    await expect(app.menu).toHaveCount(0);
  });

  test('Alt+drag turns Home about the pin and leaves Away where it is', async ({ app, page }) => {
    const before = await app.state();
    const pin = await app.onPage(before.pin);
    // A quarter turn clockwise round the pin, from due east of it to due south.
    await page.mouse.move(pin.x + 200, pin.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    for (let degrees = 10; degrees <= 90; degrees += 10) {
      const angle = (degrees * Math.PI) / 180;
      await page.mouse.move(pin.x + 200 * Math.cos(angle), pin.y + 200 * Math.sin(angle));
    }
    await page.mouse.up();
    await page.keyboard.up('Alt');

    const after = await app.state();
    expect(after.reg.rotation).toBeCloseTo(90, 0);
    expect(after.camera).toEqual(before.camera);
    expect(after.pin).toEqual(before.pin);
  });
});

test.describe('a turn of less than a degree, from a link', { tag: '@desktop' }, () => {
  test('reads as a turn and can be squared up', async ({ app }) => {
    await app.open('home=san-jose&away=london&turn=0.4');

    await expect(app.turnReadout).toHaveText('Home is turned 0.4° right.');
    await expect(app.squareUpButton).toBeEnabled();
  });
});

test.describe('turning Home on a phone', { tag: '@phone' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('slide mode offers turn buttons, and Square up once Home is turned', async ({ app }) => {
    await app.tool('Slide Home').tap();
    await expect(app.captionButton('Square up')).toBeHidden();

    await app.slideTool('Turn right').tap();
    await app.slideTool('Turn right').tap();
    expect((await app.state()).reg.rotation).toBeCloseTo(10, 6);

    await app.captionButton('Square up').tap();
    expect((await app.state()).reg.rotation).toBe(0);
    await expect(app.captionButton('Square up')).toBeHidden();
  });

  test('in slide mode a two-finger twist turns Home and leaves Away where it is', async ({ app, fingers }) => {
    await app.tool('Slide Home').tap();
    const before = await app.state();

    await twist(fingers, await app.stageSpot(0.5, 0.35), 60);

    const after = await app.state();
    // The first part of a twist is taken for an unsteady pinch and turns nothing.
    expect(after.reg.rotation).toBeGreaterThan(20);
    expect(after.reg.rotation).toBeLessThan(60);
    expect(after.camera.zoom).toBeCloseTo(before.camera.zoom, 1);
    expect(after.reg.overlayAnchor).toEqual(before.reg.overlayAnchor);
  });

  test('without Slide Home a twist turns nothing', async ({ app, fingers }) => {
    await twist(fingers, await app.stageSpot(0.5, 0.35), 60);
    await app.drawn();

    expect((await app.state()).reg.rotation).toBe(0);
  });
});
