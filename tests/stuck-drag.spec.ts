import type { Page } from '@playwright/test';
import type { ScreenPoint } from '../src/map/contracts';
import { expect, test } from './fixtures';
import { expectPinInAddress } from './support/address';
import { tripOf, type MapzApp, type Snapshot } from './support/app';
import type { Fingers } from './support/fingers';
import { letReleasesBeLostIn, loseNext, moveMouseWithNoButtonDown, releasesStillToLose } from './support/lost-release';
import { Pen } from './support/pen';
import { dragFromHere, dragWithMouse, expectPointNear, middleOf } from './support/pointer';

/**
 * The report these tests answer: "If you hold Shift to move the Home map around, sometimes it seems
 * to get stuck, and even when I release Shift the map is locked to my mouse and it won't stop until I
 * reload the page."
 *
 * Two things could make that happen. The first needs nothing to go wrong: a slide made on the map
 * ends with the pin, a handle that slides Home, right under the pointer, so every drag begun from
 * where the pointer rests slid Home again. A spot picked from a list lying over the pin, a key that
 * puts the pin where the mouse is and the click that ends a measurement (whose end is a handle too)
 * did the same. The second needs a release that never arrives, after which Home went on following a
 * mouse, or a pen in the air, with no button down.
 */

const HOME_BEING_MOVED = /mapz-stage--(sliding|turning)/;
/**
 * The opening pair with the stage kept clear of a trip: a trip's ends are handles too, and a press
 * that happened to land on one would be a different test.
 */
const NO_TRIP = 'home=san-jose&away=london&trip=none';
/** Every step of a drag is drawn before the next is sent, so drags are kept to the few steps they need. */
const FEW_STEPS = { steps: 3 } as const;
const FINGER_STEPS = 4;

/** The maps act on a move of the pointer once per frame: this resolves in the frame after the last move. */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

/** Both maps moved together: the view is elsewhere, and the pin holds the same two spots as before. */
function expectPanned(after: Snapshot, before: Snapshot): void {
  expect(after.camera.center).not.toEqual(before.camera.center);
  expect(after.reg).toEqual(before.reg);
}

/** Home moved alone, without re-pinning: the same spot of Home is pinned, somewhere else on Away. */
function expectSlidByThePin(after: Snapshot, before: Snapshot): void {
  expect(after.camera).toEqual(before.camera);
  expect(after.reg.baseAnchor).not.toEqual(before.reg.baseAnchor);
  expect(after.reg.overlayAnchor).toEqual(before.reg.overlayAnchor);
}

/** No slide or turn of Home is in progress, no handle is held, and Away is not left locked against drags. */
async function expectNothingHeld(app: MapzApp): Promise<void> {
  await expect(app.mapStage).not.toHaveClass(HOME_BEING_MOVED);
  await expect(app.page.locator('.mapz-handle.is-held')).toHaveCount(0);
  const { awayAnswersDrags, mode } = await app.page.evaluate(() => {
    const { dual, store } = window.__mapzWatch.app();
    return { awayAnswersDrags: dual.base.dragPan.isEnabled(), mode: store.get().mode };
  });
  // With Slide Home on every drag is Home's, so Away is kept from panning for as long as the mode lasts.
  expect(awayAnswersDrags).toBe(mode !== 'slide');
}

/** A spot of the stage well clear of the pin, with room to drag from it, on the page. */
async function spotClearOfPin(app: MapzApp): Promise<ScreenPoint> {
  const { pin, stage } = await app.state();
  return app.onPage({
    x: Math.round(stage.width * (pin.x > stage.width / 2 ? 0.25 : 0.75)),
    y: Math.round(stage.height * (pin.y > stage.height / 2 ? 0.25 : 0.75)),
  });
}

/** With no button down the mouse wanders across the map, and Home stays where it is. */
async function expectHomeStaysWhileMouseWanders(app: MapzApp, from: ScreenPoint): Promise<void> {
  const before = await app.state();
  for (let step = 1; step <= 3; step++) await app.page.mouse.move(from.x + step * 40, from.y - step * 25);
  const after = await app.state();
  expect(after.reg).toEqual(before.reg);
  expect(after.camera).toEqual(before.camera);
}

/** An ordinary drag on open map moves both maps, and Shift+drag slides Home and lets go of it again. */
async function expectDragsWorkAsEver(app: MapzApp): Promise<void> {
  const { page } = app;
  const beforePan = await app.state();
  const panFrom = await spotClearOfPin(app);
  await page.mouse.move(panFrom.x, panFrom.y);
  await dragFromHere(page, panFrom, { x: -90, y: -60 });
  expectPanned(await app.state(), beforePan);

  const beforeSlide = await app.state();
  const slideFrom = await spotClearOfPin(app);
  const slideTo = { x: slideFrom.x + 80, y: slideFrom.y + 50 };
  await dragWithMouse(page, slideFrom, slideTo, { holding: 'Shift', ...FEW_STEPS });
  const afterSlide = await app.state();
  expect(afterSlide.camera).toEqual(beforeSlide.camera);
  expectPointNear(await app.onPage(afterSlide.pin), slideTo);
  await expectNothingHeld(app);
}

/**
 * Drags from where the mouse rests, one after another: each moves both maps, and the handle that
 * lies there (the pin, unless `carried` says where another is) goes with them. Returns where the
 * mouse is left.
 */
async function expectDragsFromHerePan(
  app: MapzApp,
  here: ScreenPoint,
  drags: readonly ScreenPoint[],
  carried: () => Promise<ScreenPoint> = () => app.pinOnPage(),
): Promise<ScreenPoint> {
  let mouse = here;
  for (const by of drags) {
    const before = await app.state();
    mouse = await dragFromHere(app.page, mouse, by);
    expectPanned(await app.state(), before);
    // So the handle is under the mouse again for the next drag.
    expectPointNear(await carried(), mouse, 3);
  }
  return mouse;
}

/** Shift goes down, and the mouse is pressed and let go without moving: the pin is put where the mouse is. Shift stays down. */
async function shiftClickHere(page: Page): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('a slide on the map leaves the pin under the mouse', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('after Shift+drag, drags from where the mouse rests move both maps, as often as tried', async ({ app, page }) => {
    const from = await app.stageSpot(0.35, 0.4);
    const to = { x: from.x + 120, y: from.y + 40 };
    await dragWithMouse(page, from, to, { holding: 'Shift', ...FEW_STEPS });
    expectPointNear(await app.pinOnPage(), to);

    await expectDragsFromHerePan(app, to, [
      { x: 150, y: 70 },
      { x: -120, y: 160 },
      { x: 90, y: -140 },
    ]);
  });

  test('after Shift+click, drags from the same spot move both maps', async ({ app, page }) => {
    const spot = await app.stageSpot(0.6, 0.6);
    await page.mouse.move(spot.x, spot.y);
    await shiftClickHere(page);
    await page.keyboard.up('Shift');
    expectPointNear(await app.pinOnPage(), spot);

    await expectDragsFromHerePan(app, spot, [
      { x: -130, y: -80 },
      { x: 110, y: 60 },
    ]);
  });

  test('after a drag with Slide Home on, and Escape, drags from the same spot move both maps', async ({ app, page }) => {
    await app.tool('Slide Home').click();
    const from = await app.stageSpot(0.3, 0.3);
    const to = { x: from.x + 120, y: from.y + 80 };
    await dragWithMouse(page, from, to, FEW_STEPS);
    await page.keyboard.press('Escape');
    expect((await app.state()).mode).toBe('browse');

    await expectDragsFromHerePan(app, to, [
      { x: 140, y: 90 },
      { x: -60, y: 120 },
    ]);
  });

  test('once the mouse has been well clear of the pin and come back, dragging the pin slides Home, time after time', async ({ app, page }) => {
    const from = await app.stageSpot(0.35, 0.4);
    const to = { x: from.x + 120, y: from.y + 40 };
    await dragWithMouse(page, from, to, { holding: 'Shift', ...FEW_STEPS });
    // Left under the mouse by the slide, the pin lets presses through to the map.
    await expect(app.pinHandle).toHaveCSS('pointer-events', 'none');

    await page.mouse.move(to.x + 80, to.y);
    await page.mouse.move(to.x, to.y, FEW_STEPS);
    await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');
    // Not the cursor of the map around it: this drag moves Home alone.
    await expect(app.pinHandle).toHaveCSS('cursor', 'move');

    let mouse = to;
    for (const by of [
      { x: 100, y: -60 },
      { x: -70, y: 90 },
    ]) {
      const before = await app.state();
      mouse = await dragFromHere(page, mouse, by);
      const after = await app.state();
      expectSlidByThePin(after, before);
      expectPointNear(await app.onPage(after.pin), mouse);
    }
    await expectNothingHeld(app);
  });

  test('a click on the pin where a slide left it opens the pin menu; the Shift+click that put it there does not', async ({ app, page }) => {
    const spot = await app.stageSpot(0.6, 0.6);
    await page.mouse.move(spot.x, spot.y);
    await shiftClickHere(page);
    expectPointNear(await app.pinOnPage(), spot);
    // A second Shift+click lands on the pin itself. It puts the pin there again, and that is all.
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const put = await app.state();
    await expect(app.pinMenu).toHaveCount(0);

    await page.mouse.down();
    await page.mouse.up();

    await expect(app.pinMenu).toBeVisible();
    await expect(app.pinHandle).toHaveAttribute('aria-expanded', 'true');
    await app.drawn();
    const after = await app.state();
    expect(after.reg).toEqual(put.reg);
    expect(after.camera).toEqual(put.camera);
  });
});

test.describe('whatever else puts a handle under the mouse leaves it resting', { tag: '@desktop' }, () => {
  /** The pin held on Infinite Loop 1 and 10 Downing Street, which is in the middle of the view. */
  const PIN_MID_VIEW = 'home=san-jose&away=london&pin=37.33167,-122.0301~51.50349,-0.1277&view=51.50349,-0.1277,11&trip=none';

  test.beforeEach(async ({ app }) => {
    await app.open(NO_TRIP);
  });

  test('a spot picked by a click on the row lying over the middle of the stage: drags from there move both maps, and the spot keeps its name', async ({ app, page }) => {
    const middle = await app.pinOnPage();
    await app.sentenceSpot('away').click();
    await app.picker.getByRole('combobox').fill('10 downing');
    await expect(app.pickerOption('10 Downing Street')).toBeVisible();
    // The list rises over the middle of the stage, which is where the pin is shown once a spot is picked.
    const name = await app.pickerNameAt(middle);
    if (name === null) throw new Error('No row of the list lies over the middle of the stage.');

    await page.mouse.click(middle.x, middle.y);

    const sentence = `Downtown San Jose sits on ${name}.`;
    await expect(app.pinSentence).toHaveText(sentence);
    await app.drawn();
    expectPointNear(await app.pinOnPage(), middle);

    await expectDragsFromHerePan(app, middle, [
      { x: 150, y: 70 },
      { x: -120, y: 110 },
      { x: 90, y: -140 },
    ]);
    // A slide would have taken the pin off the spot, and the spot's name with it.
    await expect(app.pinSentence).toHaveText(sentence);
    await expectPinInAddress(app);
    expect(await app.hash()).toContain(`&as=${name.replaceAll(' ', '+')}`);
  });

  test('a list closed without a pick leaves the pin resting under the mouse that lay on the row over it', async ({ app, page }) => {
    const pin = await app.pinOnPage();
    // The mouse goes to the sentence, clear of the pin, and from there onto the list.
    await app.sentenceSpot('away').click();
    await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');
    await app.picker.getByRole('combobox').fill('10 downing');
    await expect(app.pickerOption('10 Downing Street')).toBeVisible();
    await page.mouse.move(pin.x, pin.y, FEW_STEPS);
    expect(await app.pickerNameAt(pin), 'a row of the list lies over the pin').not.toBeNull();

    await page.keyboard.press('Escape');

    await expect(app.picker).toHaveCount(0);
    await expectDragsFromHerePan(app, pin, [
      { x: 150, y: 70 },
      { x: -120, y: 110 },
    ]);
  });

  test('on first load, and after P, Swap, Line up again, a followed link and a pan from the keyboard, the pin rests where the mouse lies', async ({ app, page }) => {
    const middle = await app.pinOnPage();
    /** The pin is under the mouse, which did not go to it: a drag from there moves both maps. Returns where the mouse is left. */
    const expectPinRestsUnder = async (mouse: ScreenPoint, dragBy: ScreenPoint): Promise<ScreenPoint> => {
      await app.drawn();
      expectPointNear(await app.pinOnPage(), mouse, 3);
      await expect(app.pinHandle).toHaveCSS('pointer-events', 'none');
      return expectDragsFromHerePan(app, mouse, [dragBy]);
    };
    /** The mouse goes to the middle of the stage, clear of the pin, which takes presses again for that. */
    const backToMiddle = async (): Promise<void> => {
      await page.mouse.move(middle.x, middle.y, FEW_STEPS);
      await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');
    };

    await test.step('on first load, the mouse lying where the pin is drawn', async () => {
      // It stirs where it lay.
      await page.mouse.move(middle.x, middle.y);
      await expectPinRestsUnder(middle, { x: 110, y: 60 });
    });

    await test.step('P, which puts the pin at the middle of the view', async () => {
      await backToMiddle();
      await page.keyboard.press('p');
      await expectPinRestsUnder(middle, { x: 110, y: 60 });
    });

    await test.step('Swap, with the mouse on a pin it went to', async () => {
      const pin = await goToPin(app);
      await page.keyboard.press('x');
      await expect(app.legendName('home')).toHaveText('London');
      await expectPinRestsUnder(pin, { x: -60, y: 90 });
    });

    await test.step('Line up again, which brings the pin to the middle of the view', async () => {
      await backToMiddle();
      await page.keyboard.press('r');
      await expectPinRestsUnder(middle, { x: 110, y: 60 });
    });

    await test.step('a link that is followed', async () => {
      await backToMiddle();
      await page.evaluate((link) => {
        window.location.hash = link;
      }, PIN_MID_VIEW);
      await expect(app.legendName('home')).toHaveText('San Jose');
      await expectPinRestsUnder(middle, { x: 110, y: 60 });
    });

    await test.step('an arrow key, which moves the maps and brings the pin under the mouse', async () => {
      const pin = await app.pinOnPage();
      const oneStepLeft = { x: pin.x - 100, y: pin.y };
      await page.mouse.move(oneStepLeft.x, oneStepLeft.y, FEW_STEPS);
      await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');
      await page.keyboard.press('ArrowRight');
      await expectPinRestsUnder(oneStepLeft, { x: 110, y: 60 });
    });
  });

  test('the click that ends a measurement leaves the trip end under the mouse: drags from there move both maps, until the mouse has been clear of it', async ({ app, page }) => {
    const start = await app.stageSpot(0.28, 0.33);
    const end = await app.stageSpot(0.39, 0.43);
    const endHandle = page.getByRole('button', { name: 'Trip end', exact: true });
    const endOnPage = async (): Promise<ScreenPoint> => app.onPage(tripOf(await app.state()).ends[1]);

    await page.keyboard.press('m');
    await page.mouse.click(start.x, start.y);
    await page.mouse.click(end.x, end.y);
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');
    await expect(endHandle).toHaveCSS('pointer-events', 'none');
    const measured = tripOf(await app.state()).trip;

    const mouse = await expectDragsFromHerePan(
      app,
      end,
      [
        { x: 150, y: 70 },
        { x: -120, y: 110 },
        { x: 90, y: -140 },
      ],
      endOnPage,
    );
    expect(tripOf(await app.state()).trip).toEqual(measured);

    await page.mouse.move(mouse.x + 80, mouse.y);
    await page.mouse.move(mouse.x, mouse.y, FEW_STEPS);
    await expect(endHandle).toHaveCSS('pointer-events', 'auto');
    const before = await app.state();
    const dropped = await dragFromHere(page, mouse, { x: 70, y: -50 });

    const after = await app.state();
    expect(after.camera).toEqual(before.camera);
    expect(tripOf(after).trip.from).toEqual(measured.from);
    expectPointNear(await endOnPage(), dropped);
    await expectNothingHeld(app);
  });
});

test.describe('with Slide Home on', () => {
  test('a press on the pin slides Home through the map, like a press anywhere else', async ({ app, fingers, page }) => {
    await app.open();
    await app.press(app.tool('Slide Home'));
    // The pin steps aside for as long as the mode is on.
    await expect(app.pinHandle).toHaveCSS('pointer-events', 'none');
    const slides = await page.evaluateHandle(() => {
      const heard: string[] = [];
      window.__mapzWatch.app().dual.on('gesture', ({ kind, phase, onMap }) => heard.push(`${kind} ${phase} ${onMap ? 'on the map' : 'by a handle'}`));
      return heard;
    });
    const before = await app.state();
    const pin = await app.onPage(before.pin);
    // A little off the pin's centre, inside its target: the handle would keep that offset, the map does not.
    const from = { x: pin.x + 6, y: pin.y - 5 };
    const to = { x: pin.x + 76, y: pin.y + 55 };
    const grabbed = await app.homeUnder(from);

    if (app.touch) await fingers.drag(from, to, FINGER_STEPS);
    else await dragWithMouse(page, from, to, FEW_STEPS);

    expect(await slides.jsonValue()).toEqual(['slide start on the map', 'slide end on the map']);
    const after = await app.state();
    expect(after.camera).toEqual(before.camera);
    expectPointNear(await app.onPage(after.pin), to);
    // The pin jumped to the spot of Home that was pressed.
    expect(after.reg.overlayAnchor).toEqual(grabbed);
  });
});

test.describe('a slide with a finger leaves the pin where the finger lifted', { tag: '@phone' }, () => {
  /** Finger drags from where the slide ended, one after another: each moves both maps. */
  async function expectDragsFromThePinPan(app: MapzApp, fingers: Fingers): Promise<void> {
    let finger = await app.pinOnPage();
    for (const by of [
      { x: 60, y: -80 },
      { x: -40, y: 90 },
    ]) {
      const before = await app.state();
      const to = { x: finger.x + by.x, y: finger.y + by.y };
      await fingers.dragToRest(finger, to, FINGER_STEPS);
      expectPanned(await app.state(), before);
      finger = to;
    }
  }

  test.beforeEach(async ({ app, fingers }) => {
    await app.open();
    await app.tool('Slide Home').tap();
    await expect(app.slideTool('Done')).toBeVisible();
    const from = await app.stageSpot(0.3, 0.35);
    const to = { x: from.x + 70, y: from.y + 90 };
    await fingers.dragToRest(from, to, FINGER_STEPS);
    expectPointNear(await app.pinOnPage(), to);
  });

  test('with slide mode left from a keyboard, drags from that spot move both maps', async ({ app, fingers, page }) => {
    await page.keyboard.press('Escape');
    await expect(app.tool('Measure')).toBeVisible();

    await expectDragsFromThePinPan(app, fingers);
  });

  test('with slide mode left by its Done button, drags from that spot move both maps, until a finger has touched the map elsewhere', async ({ app, fingers }) => {
    await app.slideTool('Done').tap();
    await expect(app.tool('Measure')).toBeVisible();
    // Done was a tap on a control, and so is this: neither says where on the map the finger comes down next.
    await app.tool('Rings').tap();

    await expectDragsFromThePinPan(app, fingers);

    const before = await app.state();
    const pin = await app.onPage(before.pin);
    const to = { x: pin.x - 60, y: pin.y + 70 };
    await app.comeTo(pin);
    await fingers.drag(pin, to, FINGER_STEPS);
    const after = await app.state();
    expectSlidByThePin(after, before);
    expectPointNear(await app.onPage(after.pin), to);
  });
});

interface DragPath {
  readonly name: string;
  /** Presses and drags, and leaves the button down. Returns where the mouse is. */
  begin(app: MapzApp): Promise<ScreenPoint>;
  /** Puts the app back in browse mode, where the path was walked in another. */
  leave?(app: MapzApp): Promise<void>;
}

/**
 * Brings the mouse to the pin from well clear of it, as someone who means to use the pin does. (A pin
 * that came to the mouse lets presses through to the map until then.) Returns where the pin is.
 */
async function goToPin(app: MapzApp): Promise<ScreenPoint> {
  const pin = await app.pinOnPage();
  await app.comeTo(pin);
  await app.page.mouse.move(pin.x, pin.y, FEW_STEPS);
  await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');
  return pin;
}

const SHIFT_DRAG: DragPath = {
  name: 'Shift+drag on the map',
  async begin(app) {
    const from = await spotClearOfPin(app);
    const mouse = { x: from.x + 110, y: from.y + 40 };
    await app.page.mouse.move(from.x, from.y);
    await app.page.keyboard.down('Shift');
    await app.page.mouse.down();
    await app.page.mouse.move(mouse.x, mouse.y, FEW_STEPS);
    // As in the report: Shift is let go before the mouse is.
    await app.page.keyboard.up('Shift');
    return mouse;
  },
};

const SLIDE_MODE_DRAG: DragPath = {
  name: 'a drag with Slide Home on',
  async begin(app) {
    await app.page.keyboard.press('s');
    await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'true');
    const from = await spotClearOfPin(app);
    const mouse = { x: from.x + 110, y: from.y + 40 };
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    await app.page.mouse.move(mouse.x, mouse.y, FEW_STEPS);
    return mouse;
  },
  async leave(app) {
    await app.page.keyboard.press('Escape');
    await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'false');
  },
};

const ALT_DRAG: DragPath = {
  name: 'Alt+drag on the map, which turns Home',
  async begin(app) {
    const pin = await app.pinOnPage();
    const along = (degrees: number): ScreenPoint => ({
      x: pin.x + 200 * Math.cos((degrees * Math.PI) / 180),
      y: pin.y + 200 * Math.sin((degrees * Math.PI) / 180),
    });
    await app.page.mouse.move(along(0).x, along(0).y);
    await app.page.keyboard.down('Alt');
    await app.page.mouse.down();
    for (const degrees of [15, 30]) await app.page.mouse.move(along(degrees).x, along(degrees).y);
    await app.page.keyboard.up('Alt');
    return along(30);
  },
};

const PIN_DRAG: DragPath = {
  name: 'a drag of the pin',
  async begin(app) {
    const pin = await goToPin(app);
    const mouse = { x: pin.x + 100, y: pin.y + 60 };
    await app.page.mouse.down();
    await app.page.mouse.move(mouse.x, mouse.y, FEW_STEPS);
    return mouse;
  },
};

const KNOB_DRAG: DragPath = {
  name: 'a drag of the turn knob',
  async begin(app) {
    // The knob comes up when the mouse is on the pin.
    await goToPin(app);
    const grip = app.page.locator('.mapz-knob__grip');
    await expect(grip).toBeVisible();
    const knob = await middleOf(grip);
    const mouse = { x: knob.x + 50, y: knob.y + 30 };
    await app.page.mouse.move(knob.x, knob.y);
    await app.page.mouse.down();
    await app.page.mouse.move(mouse.x, mouse.y, FEW_STEPS);
    return mouse;
  },
};

interface LostRelease {
  readonly name: string;
  /** Lets the button go, or fails to, so that the app does not hear a release. */
  happen(page: Page, mouse: ScreenPoint): Promise<void>;
  /** The drag is still on record until the mouse is seen to move with no button down. */
  readonly leavesDragHeld: boolean;
}

const RELEASE_STOPPED: LostRelease = {
  name: 'the release is stopped before the app hears it',
  async happen(page) {
    await loseNext(page, 'pointerup');
    await page.mouse.up();
  },
  leavesDragHeld: false,
};

const RELEASE_AND_CAPTURE_STOPPED: LostRelease = {
  name: 'the release and the end of the capture are both stopped',
  async happen(page) {
    await loseNext(page, 'pointerup', 'lostpointercapture');
    await page.mouse.up();
  },
  leavesDragHeld: true,
};

const RELEASE_NEVER_SENT: LostRelease = {
  name: 'no release is sent at all: the mouse just moves on with no button down',
  async happen(page, mouse) {
    await moveMouseWithNoButtonDown(page, { x: mouse.x + 2, y: mouse.y + 1 });
    // Playwright and the browser still take the button for down. Its release, late, must change nothing.
    await page.mouse.up();
  },
  leavesDragHeld: false,
};

/**
 * The map ends every drag made on it in one place, and the handles end theirs in another. So one drag
 * of each kind goes through every way of losing a release, and the rest through the one that leaves
 * the app the least to go by.
 */
const LOST_RELEASES: readonly { readonly path: DragPath; readonly lost: readonly LostRelease[] }[] = [
  { path: SHIFT_DRAG, lost: [RELEASE_STOPPED, RELEASE_AND_CAPTURE_STOPPED, RELEASE_NEVER_SENT] },
  { path: PIN_DRAG, lost: [RELEASE_STOPPED, RELEASE_AND_CAPTURE_STOPPED, RELEASE_NEVER_SENT] },
  { path: SLIDE_MODE_DRAG, lost: [RELEASE_AND_CAPTURE_STOPPED] },
  { path: ALT_DRAG, lost: [RELEASE_AND_CAPTURE_STOPPED] },
  { path: KNOB_DRAG, lost: [RELEASE_AND_CAPTURE_STOPPED] },
];

test.describe('a drag whose release never arrives', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app, context }) => {
    await letReleasesBeLostIn(context);
    await app.open(NO_TRIP);
  });

  for (const { path, lost } of LOST_RELEASES) {
    test(`${path.name}: Home stops with the first move that shows no button down`, async ({ app, page }) => {
      for (const release of lost) {
        await test.step(release.name, async () => {
          const start = await app.state();
          const mouse = await path.begin(app);
          await expect(app.mapStage).toHaveClass(HOME_BEING_MOVED);
          await nextFrame(page);
          const dragged = await app.state();
          expect(dragged.reg).not.toEqual(start.reg);

          await release.happen(page, mouse);
          expect(await releasesStillToLose(page)).toEqual([]);
          if (release.leavesDragHeld) await expect(app.mapStage).toHaveClass(HOME_BEING_MOVED);

          // The first move with no button down ends the drag where the button was last seen down.
          await page.mouse.move(mouse.x + 4, mouse.y + 3);
          await expectNothingHeld(app);
          expect((await app.state()).reg).toEqual(dragged.reg);
          await expectHomeStaysWhileMouseWanders(app, mouse);
          await path.leave?.(app);
        });
      }
      await expectDragsWorkAsEver(app);
    });
  }
});

test.describe('a pen whose lift never arrives', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app, context }) => {
    await letReleasesBeLostIn(context);
    await app.open(NO_TRIP);
  });

  test('on the map with Slide Home on, and on the pin: Home stops with the first move of the pen in the air', async ({ app, page }) => {
    const pen = new Pen(page);
    /** The pen is lifted unheard, and moves on in the air: what it was dragging stays where the tip left the screen. */
    const expectLetGoOnceInTheAir = async (lifted: ScreenPoint): Promise<void> => {
      await nextFrame(page);
      const dragged = await app.state();
      expectPointNear(await app.onPage(dragged.pin), lifted);
      await loseNext(page, 'pointerup', 'lostpointercapture');
      await pen.lift();
      expect(await releasesStillToLose(page)).toEqual([]);
      await expect(app.mapStage).toHaveClass(HOME_BEING_MOVED);

      await pen.moveTo({ x: lifted.x + 4, y: lifted.y + 3 });
      await expectNothingHeld(app);
      await pen.moveTo({ x: lifted.x + 160, y: lifted.y - 90 }, FEW_STEPS.steps);
      const after = await app.state();
      expect(after.reg).toEqual(dragged.reg);
      expect(after.camera).toEqual(dragged.camera);
    };

    await test.step('on the map with Slide Home on', async () => {
      await page.keyboard.press('s');
      await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'true');
      const from = await spotClearOfPin(app);
      const to = { x: from.x + 90, y: from.y + 40 };
      await pen.moveTo(from);
      await pen.down();
      await pen.moveTo(to, FEW_STEPS.steps);
      await expect(app.mapStage).toHaveClass(HOME_BEING_MOVED);

      await expectLetGoOnceInTheAir(to);
      await page.keyboard.press('Escape');
      await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'false');
    });

    await test.step('on the pin', async () => {
      const pin = await app.pinOnPage();
      const to = { x: pin.x + 90, y: pin.y + 40 };
      // The pen goes to the pin from clear of it, as a mouse does.
      await pen.moveTo({ x: pin.x + 90, y: pin.y + 10 });
      await pen.moveTo(pin, FEW_STEPS.steps);
      await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');
      await pen.down();
      await pen.moveTo(to, FEW_STEPS.steps);
      await expect(page.locator('.mapz-handle.is-held')).toHaveCount(1);

      await expectLetGoOnceInTheAir(to);
    });
  });
});

test.describe('the sequence in the report', { tag: '@desktop' }, () => {
  /**
   * The press that starts the drag, as the mouse reports it: on its own, or straight after a click on
   * the same spot. Each is made on a spot of the stage that is clear of the pin and of the trip's
   * ends, wherever the one before it left them.
   */
  const PRESSES = [
    { clickCount: 1, as: 'a single press', across: 0.6, down: 0.25 },
    { clickCount: 2, as: 'the second press of a double click', across: 0.3, down: 0.7 },
  ] as const;

  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  /**
   * Once the button is up: Away has not moved or zoomed, a drag from where the mouse rests moves both
   * maps, and nothing follows the mouse when it moves on with no button down.
   */
  async function expectNotStuck(app: MapzApp, start: Snapshot, released: ScreenPoint): Promise<void> {
    await expectNothingHeld(app);
    await app.drawn();
    const slid = await app.state();
    expect(slid.camera).toEqual(start.camera);
    expectPointNear(await app.onPage(slid.pin), released);

    const mouse = await expectDragsFromHerePan(app, released, [{ x: 130, y: 60 }]);
    await expectHomeStaysWhileMouseWanders(app, mouse);
    await expectNothingHeld(app);
  }

  test('Shift down, press off the pin, drag, Shift up, drag on, release, move', async ({ app, page }) => {
    for (const press of PRESSES) {
      await test.step(`the press being ${press.as}`, async () => {
        const start = await app.state();
        const spot = await app.stageSpot(press.across, press.down);
        const released = { x: spot.x + 110, y: spot.y + 50 };
        await page.mouse.move(spot.x, spot.y);
        if (press.clickCount === 2) {
          await page.mouse.down();
          await page.mouse.up();
        }

        await page.keyboard.down('Shift');
        await page.mouse.down({ clickCount: press.clickCount });
        await page.mouse.move(spot.x + 60, spot.y + 20, { steps: 2 });
        await page.keyboard.up('Shift');
        await page.mouse.move(released.x, released.y, { steps: 2 });
        await page.mouse.up({ clickCount: press.clickCount });

        await expectNotStuck(app, start, released);
      });
    }
  });

  test('Shift+click to move the pin, press again on the pin, drag, Shift up, release, move', async ({ app, page }) => {
    for (const press of PRESSES) {
      await test.step(`the second press being ${press.as}`, async () => {
        const start = await app.state();
        const spot = await app.stageSpot(press.across, press.down);
        const released = { x: spot.x + 110, y: spot.y + 50 };
        await page.mouse.move(spot.x, spot.y);
        await shiftClickHere(page);
        expectPointNear(await app.pinOnPage(), spot);

        await page.mouse.down({ clickCount: press.clickCount });
        await page.mouse.move(released.x, released.y, FEW_STEPS);
        await page.keyboard.up('Shift');
        await page.mouse.up({ clickCount: press.clickCount });

        await expectNotStuck(app, start, released);
      });
    }
  });
});

/** The points of a drag at which a listener of the map pair can be made to throw. */
type ThrowsAt = 'the start of the slide' | 'the first change' | 'the last change' | 'every change';

test.describe('what else could keep hold of Home', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open(NO_TRIP);
  });

  test('a listener that throws while a drag begins, goes on or ends does not leave Home attached', async ({ app, page, consoleWatch }) => {
    consoleWatch.allow(/a listener gave up/);
    /** A listener of the map pair that throws at the point of a drag it is told to. */
    const listener = await page.evaluateHandle(() => {
      const told: { when: ThrowsAt | null; thrown: number } = { when: null, thrown: 0 };
      const giveUp = (): never => {
        told.thrown++;
        throw new Error('a listener gave up');
      };
      const { dual } = window.__mapzWatch.app();
      dual.on('gesture', ({ phase }) => {
        if (told.when === 'the start of the slide' && phase === 'start') giveUp();
      });
      dual.on('registrationchange', ({ final }) => {
        if (told.when === 'every change' || (told.when === 'the last change' && final)) giveUp();
        if (told.when !== 'the first change') return;
        told.when = null;
        giveUp();
      });
      return told;
    });
    const throwAt = (when: ThrowsAt | null): Promise<void> =>
      listener.evaluate((told, wanted) => {
        told.when = wanted;
      }, when);
    const timesThrown = async (): Promise<number> => (await listener.jsonValue()).thrown;

    for (const [path, when] of [
      [SHIFT_DRAG, 'the start of the slide'],
      [SHIFT_DRAG, 'the first change'],
      [SHIFT_DRAG, 'the last change'],
      [SHIFT_DRAG, 'every change'],
      [PIN_DRAG, 'the last change'],
    ] as const) {
      await test.step(`${path.name}, the listener throwing at ${when}`, async () => {
        const thrownBefore = await timesThrown();
        await throwAt(when);
        const mouse = await path.begin(app);
        await page.mouse.up();
        await throwAt(null);
        expect(await timesThrown()).toBeGreaterThan(thrownBefore);

        await expectNothingHeld(app);
        await expectHomeStaysWhileMouseWanders(app, mouse);
      });
    }
    await expectDragsWorkAsEver(app);
  });

  test('no context menu can open during a drag and take the release with it', async ({ app, page }) => {
    const menus = await page.evaluateHandle(() => {
      const stopped: boolean[] = [];
      window.addEventListener('contextmenu', (event) => stopped.push(event.defaultPrevented));
      return stopped;
    });

    for (const path of [SHIFT_DRAG, ALT_DRAG, PIN_DRAG]) {
      await test.step(path.name, async () => {
        const asked = (await menus.jsonValue()).length;
        const mouse = await path.begin(app);

        // A context click in the middle of the drag: on a Mac, a second finger on the trackpad.
        await page.mouse.down({ button: 'right' });
        await page.mouse.up({ button: 'right' });

        expect((await menus.jsonValue()).slice(asked)).toEqual([true]);
        await expect(app.mapStage).toHaveClass(HOME_BEING_MOVED);
        await page.mouse.up();
        await expectNothingHeld(app);
        await expectHomeStaysWhileMouseWanders(app, mouse);
      });
    }
  });

  test('S pressed while Shift+dragging does not switch Slide Home on behind the drag', async ({ app, page }) => {
    const mouse = await SHIFT_DRAG.begin(app);
    await page.keyboard.down('Shift');

    await page.keyboard.press('S');
    await page.keyboard.up('Shift');
    await page.mouse.up();

    expect((await app.state()).mode).toBe('browse');
    await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'false');
    await expectHomeStaysWhileMouseWanders(app, mouse);
    // With the drag over, the key is the shortcut it always was.
    await page.keyboard.press('s');
    await expect(app.tool('Slide Home')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('a finger whose lift never arrives', { tag: '@phone' }, () => {
  test.beforeEach(async ({ app, context }) => {
    await letReleasesBeLostIn(context);
    await app.open(NO_TRIP);
  });

  /** A finger drag on open map, clear of the pin, moves both maps. */
  async function expectFingerPans(app: MapzApp, fingers: Fingers): Promise<void> {
    const before = await app.state();
    const from = await spotClearOfPin(app);
    await fingers.dragToRest(from, { x: from.x - 50, y: from.y - 40 }, FINGER_STEPS);
    expectPanned(await app.state(), before);
  }

  test('on the pin: Away still moves, and the pin can be dragged again', async ({ app, fingers, page }) => {
    const pin = await app.pinOnPage();
    await app.comeTo(pin);
    await fingers.dragAndHold(pin, { x: pin.x + 60, y: pin.y + 50 }, FINGER_STEPS);
    await expect(page.locator('.mapz-handle.is-held')).toHaveCount(1);
    await loseNext(page, 'pointerup', 'lostpointercapture');
    await fingers.lift();
    expect(await releasesStillToLose(page)).toEqual([]);

    await expectFingerPans(app, fingers);

    const before = await app.state();
    const from = await app.onPage(before.pin);
    const to = { x: from.x - 70, y: from.y + 60 };
    await fingers.drag(from, to, FINGER_STEPS);
    const after = await app.state();
    expectSlidByThePin(after, before);
    expectPointNear(await app.onPage(after.pin), to);
    await expectNothingHeld(app);
  });

  test('on the map with Slide Home on: leaving the mode lets go of Home', async ({ app, fingers, page }) => {
    await app.tool('Slide Home').tap();
    await expect(app.slideTool('Done')).toBeVisible();
    const from = await spotClearOfPin(app);
    await fingers.dragAndHold(from, { x: from.x + 60, y: from.y + 50 }, FINGER_STEPS);
    await expect(app.mapStage).toHaveClass(HOME_BEING_MOVED);
    await loseNext(page, 'pointerup', 'lostpointercapture');
    await fingers.liftAtRest();
    expect(await releasesStillToLose(page)).toEqual([]);

    await app.slideTool('Done').tap();
    await expect(app.tool('Measure')).toBeVisible();

    await expectNothingHeld(app);
    await expectFingerPans(app, fingers);
  });
});
