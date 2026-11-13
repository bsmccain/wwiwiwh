import { SPOT_ZOOM } from '../src/app/controller';
import { distanceMeters } from '../src/geo/distance';
import { expect, test } from './fixtures';
import { expectPinInAddress, expectViewInAddress } from './support/address';
import { MapzApp, type Snapshot } from './support/app';
import { expectSheetOnScreen, reachOfPage, tooSmall, touchTargets } from './support/phone-screen';
import { savedSpot } from './support/place-search';
import { dragWithMouse, expectPointNear, focusedElement, heightAnsweringPointer } from './support/pointer';
import { ANY_TOWN, tileOfTowns } from './support/towns';

/**
 * The pin holds a spot of Home on a spot of Away. Each of the two can be chosen by typing an address,
 * a landmark or a neighbourhood, from the pin menu or from the pin sentence itself.
 */

/** The centres of the two places the app opens with. */
const SAN_JOSE = { lat: 37.3322, lng: -121.8896 };
const LONDON = { lat: 51.5073, lng: -0.1276 };
/** Spots as the saved search answers have them. */
const INFINITE_LOOP = savedSpot('1 infinite loop', 'Infinite Loop 1');
const DOWNING_STREET = savedSpot('10 downing', '10 Downing Street');
const HEATHROW = savedSpot('heathrow', 'Heathrow Airport');
/** Two postcodes, each a spot of its own to the search. */
const PALACE_POSTCODE = savedSpot('SW1A 1AA', 'SW1A 1AA');
const CUPERTINO_POSTCODE = savedSpot('95014', '95014');
/** A pick puts the pin on the spot that was found, to within what the rounding of a coordinate allows. */
const SAME_SPOT_METERS = 2;
/** The smallest a control may be in either direction where it is worked with a mouse. */
const MOUSE_TARGET_PX = 40;

/** The opening pair with no trip drawn, so that the caption of a narrow screen carries the pin sentence. */
const NO_TRIP = 'home=san-jose&away=london&trip=none';
/** The same, with the pin holding Infinite Loop 1 on 10 Downing Street, as a link names them. */
const NAMED_PIN = 'home=san-jose&away=london&pin=37.33167,-122.0301~51.50349,-0.1277&hs=Infinite+Loop+1&as=10+Downing+Street&trip=none';

const MENU_ROWS = [
  'Home spot Downtown San Jose',
  'Away spot Central London',
  'Measure from the pin to an address',
  'Put the pin at the centre of the view',
];

/** Words that place a spot by one of the towns the tiles carry: "near Alderley", "3 mi north of Dunmere". */
const BY_A_TOWN = `.*(${ANY_TOWN})`;

function expectPinInMiddleOfStage({ pin, stage }: Snapshot): void {
  expectPointNear(pin, { x: stage.width / 2, y: stage.height / 2 });
}

test.describe('the pin menu', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('a click on the pin opens it beside the pin, and Escape gives the pin back its focus', { tag: '@desktop' }, async ({ app, page }) => {
    const pin = await app.pinOnPage();

    await app.pressPin();

    await expect(app.pinMenu).toBeVisible();
    await expect(app.menu).toHaveAttribute('data-layout', 'popover');
    await expect(app.menu).toHaveAttribute('data-place', 'beside');
    await expect(app.pinHandle).toHaveAttribute('aria-expanded', 'true');
    await expect(app.pinMenu.locator('.menu__item')).toHaveText(MENU_ROWS);
    // Beside the pin, not over it: the pin stays in sight and in reach.
    const box = await app.pinMenu.boundingBox();
    if (!box) throw new Error('The pin menu has no box.');
    const overPin = box.x < pin.x && pin.x < box.x + box.width && box.y < pin.y && pin.y < box.y + box.height;
    expect(overPin).toBe(false);

    await page.keyboard.press('Escape');
    await expect(app.pinMenu).toHaveCount(0);
    await expect(app.pinHandle).toHaveAttribute('aria-expanded', 'false');
    await expect(app.pinHandle).toBeFocused();
  });

  test('a double click on the pin leaves it open, and zooms nothing', { tag: '@desktop' }, async ({ app, page }) => {
    const before = await app.state();
    const pin = await app.onPage(before.pin);

    await page.mouse.dblclick(pin.x, pin.y);

    await expect(app.pinMenu).toBeVisible();
    await app.drawn();
    expect((await app.state()).camera).toEqual(before.camera);
    await expect(app.pinMenu).toBeVisible();
  });

  test('Enter or Space on the pin opens it, and so does the A key from anywhere', { tag: '@desktop' }, async ({ app, page }) => {
    await app.pinHandle.focus();
    await page.keyboard.press('Enter');
    await expect(app.pinMenuRow('Home spot')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(app.pinHandle).toBeFocused();

    await page.keyboard.press('Space');
    await expect(app.pinMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(app.pinMenu).toHaveCount(0);

    await app.swapButton.focus();
    await page.keyboard.press('a');
    await expect(app.pinMenuRow('Home spot')).toBeFocused();
    // Not opened from the pin, it rises from the More button like More's own menu.
    await expect(app.menu).toHaveAttribute('data-place', 'rising');
    await expect(app.moreButton).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(app.swapButton).toBeFocused();
  });

  test('Tab out of a picker opened from it closes it too, and the keyboard goes on from the pin', { tag: '@desktop' }, async ({ app, page }) => {
    for (const key of ['Tab', 'Shift+Tab'] as const) {
      // Where the key leads from the pin itself, with no menu in the way.
      await app.pinHandle.focus();
      await page.keyboard.press(key);
      const nextToPin = await focusedElement(page);

      await app.pinHandle.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(app.picker.getByRole('combobox')).toBeFocused();
      await page.keyboard.press(key);

      await expect(app.picker).toHaveCount(0);
      await expect(app.pinMenu).toHaveCount(0);
      await expect(app.pinHandle).toHaveAttribute('aria-expanded', 'false');
      expect(await nextToPin.evaluate((element) => element === document.activeElement)).toBe(true);
    }

    // Escape is a step back, not a way out: the menu is there again, on the row the picker was opened from.
    await app.pinHandle.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(app.picker.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(app.picker).toHaveCount(0);
    await expect(app.pinMenuRow('Home spot')).toBeFocused();
  });

  test('More offers "Set the pin by address", which opens it', async ({ app }) => {
    await app.press(app.moreButton);
    await app.press(app.menu.getByRole('button', { name: /^Set the pin by address/ }));

    await expect(app.pinMenu).toBeVisible();
    await expect(app.menu).toHaveAttribute('data-layout', app.touch ? 'sheet' : 'popover');
    await expect(app.pinMenu.locator('.menu__item')).toHaveText(MENU_ROWS);
  });

  test('"Put the pin at the centre of the view" does that, and moves neither map', { tag: '@desktop' }, async ({ app, page }) => {
    await page.keyboard.press('ArrowRight');
    await app.drawn();
    const moved = await app.state();
    expect(moved.pin.x).toBeLessThan(moved.stage.width / 2 - 50);

    await page.keyboard.press('a');
    await app.pinMenuRow('Put the pin at the centre of the view').click();

    await expect(app.pinMenu).toHaveCount(0);
    const after = await app.state();
    expectPinInMiddleOfStage(after);
    expect(after.camera).toEqual(moved.camera);
  });

  test('dragging the pin slides Home and opens nothing', async ({ app, fingers, page }) => {
    const before = await app.state();
    const from = await app.onPage(before.pin);
    const to = { x: from.x + 50, y: from.y + 40 };

    await app.comeTo(from);
    if (app.touch) await fingers.drag(from, to, 4);
    else await dragWithMouse(page, from, to, { steps: 3 });

    await expect(app.pinMenu).toHaveCount(0);
    const after = await app.state();
    expectPointNear(await app.onPage(after.pin), to);
    expect(after.reg.overlayAnchor).toEqual(before.reg.overlayAnchor);
    await expect(app.pinMenu).toHaveCount(0);
  });
});

test.describe('choosing the spots under the pin by address', () => {
  test('the Home spot goes under the pin, then the pin goes to the Away spot, and a link carries both', async ({ app, context, page, placeSearch }) => {
    await app.open(NO_TRIP);
    await expect(app.pinSentence).toHaveText('Downtown San Jose sits on central London.');

    await app.choosePinMenuRow('Home spot');
    await expect(app.pickerHeading).toHaveText('Pin which spot of San Jose?');
    await expect(app.pickerLine).toHaveText('It goes under the pin, on central London.');
    await expect(app.picker.getByRole('combobox')).toHaveAttribute('placeholder', 'Address, landmark or neighbourhood');
    await app.searchAndPick('1 infinite loop', 'Infinite Loop 1');

    await expect(app.picker).toHaveCount(0);
    await expect(app.menu).toHaveCount(0);
    await expect(app.pinSentence).toHaveText('Infinite Loop 1 sits on central London.');
    await app.drawn();
    const homeSet = await app.state();
    expect(distanceMeters(homeSet.reg.overlayAnchor, INFINITE_LOOP)).toBeLessThan(SAME_SPOT_METERS);
    // Only Home moved: the pin is where it was on Away, and Home is no more turned than it was.
    expect(homeSet.reg.baseAnchor).toEqual(LONDON);
    expect(homeSet.reg.rotation).toBe(0);
    expectPinInMiddleOfStage(homeSet);
    // An address is looked at from close up: the streets around it are what there is to compare.
    expect(homeSet.camera.zoom).toBeCloseTo(SPOT_ZOOM, 2);

    await app.choosePinMenuRow('Away spot');
    await expect(app.pickerHeading).toHaveText('Put the pin on which spot of London?');
    await expect(app.pickerLine).toHaveText('Infinite Loop 1 moves there with it.');
    await app.searchAndPick('10 downing', '10 Downing Street');

    await expect(app.pinSentence).toHaveText('Infinite Loop 1 sits on 10 Downing Street.');
    await app.drawn();
    const bothSet = await app.state();
    expect(distanceMeters(bothSet.reg.baseAnchor, DOWNING_STREET)).toBeLessThan(SAME_SPOT_METERS);
    expect(bothSet.reg.overlayAnchor).toEqual(homeSet.reg.overlayAnchor);
    expectPinInMiddleOfStage(bothSet);
    expect(bothSet.camera.zoom).toBeCloseTo(SPOT_ZOOM, 2);
    // The places themselves are the same two: the spots were looked for in and around them.
    expect(bothSet.home.name).toBe('San Jose');
    expect(bothSet.away.name).toBe('London');
    expect(placeSearch.requests).toEqual([
      { kind: 'spot', query: '1 infinite loop', near: SAN_JOSE },
      { kind: 'spot', query: '10 downing', near: LONDON },
    ]);

    await expectPinInAddress(app);
    await expectViewInAddress(app);
    await expect(page).toHaveURL(/[#&]pin=[^&]+&hs=Infinite\+Loop\+1&as=10\+Downing\+Street(&|$)/);

    const fresh = new MapzApp(await context.newPage(), app.touch);
    await fresh.page.goto(page.url());
    await fresh.drawn();
    await expect(fresh.pinSentence).toHaveText('Infinite Loop 1 sits on 10 Downing Street.');
    const reopened = await fresh.state();
    expect(distanceMeters(reopened.reg.overlayAnchor, INFINITE_LOOP)).toBeLessThan(SAME_SPOT_METERS);
    expect(distanceMeters(reopened.reg.baseAnchor, DOWNING_STREET)).toBeLessThan(SAME_SPOT_METERS);
    expectPinInMiddleOfStage(reopened);
  });

  test('each spot of the pin sentence opens the picker for that spot', async ({ app }) => {
    await app.open(NAMED_PIN);
    await expect(app.pinSentence).toHaveText('Infinite Loop 1 sits on 10 Downing Street.');

    await app.press(app.sentenceSpot('home'));
    await expect(app.pickerHeading).toHaveText('Pin which spot of San Jose?');
    await expect(app.pickerLine).toHaveText('It goes under the pin, on 10 Downing Street.');
    await expect(app.sentenceSpot('home')).toHaveAttribute('aria-expanded', 'true');

    await app.closePicker();
    await expect(app.picker).toHaveCount(0);
    await expect(app.sentenceSpot('home')).toHaveAttribute('aria-expanded', 'false');
    await expect(app.sentenceSpot('home')).toBeFocused();

    await app.press(app.sentenceSpot('away'));
    await expect(app.pickerHeading).toHaveText('Put the pin on which spot of London?');
    await expect(app.pickerLine).toHaveText('Infinite Loop 1 moves there with it.');
    await expect(app.sentenceSpot('away')).toHaveAttribute('aria-expanded', 'true');
  });

  test('in the collar, each spot of the pin sentence answers the mouse over the height of a full target', { tag: '@desktop' }, async ({ app }) => {
    await app.open(NAMED_PIN);

    for (const sheet of ['home', 'away'] as const) {
      expect(await heightAnsweringPointer(app.sentenceSpot(sheet)), `the ${sheet} spot`).toBeGreaterThanOrEqual(MOUSE_TARGET_PX);
    }
  });

  test('"The centre of" a place puts the pin on its centre and takes the name away', async ({ app, page }) => {
    await app.open(NAMED_PIN);
    const { zoom } = (await app.state()).camera;

    await app.press(app.sentenceSpot('away'));
    await app.press(app.pickerOption('The centre of London'));

    await expect(app.pinSentence).toHaveText('Infinite Loop 1 sits on central London.');
    await app.drawn();
    const awayCentred = await app.state();
    expect(awayCentred.reg.baseAnchor).toEqual(LONDON);
    expectPinInMiddleOfStage(awayCentred);
    // The centre of a place is no address: it is looked at from as far as before.
    expect(awayCentred.camera.zoom).toBeCloseTo(zoom, 2);
    await expectPinInAddress(app);
    expect(await app.hash()).toContain('&hs=Infinite+Loop+1');
    expect(await app.hash()).not.toContain('&as=');

    await app.press(app.sentenceSpot('home'));
    await app.press(app.pickerOption('The centre of San Jose'));

    await expect(app.pinSentence).toHaveText('Downtown San Jose sits on central London.');
    expect((await app.state()).reg.overlayAnchor).toEqual(SAN_JOSE);
    // Centre on centre is where the pin is unless a link says otherwise, so the link no longer says.
    await expect(page).toHaveURL(/#home=san-jose&away=london&view=[^&]+&trip=none$/);
  });

  test('a spot picked from closer in than street scale is looked at from where the view was', { tag: '@desktop' }, async ({ app }) => {
    const closeIn = SPOT_ZOOM + 2;
    await app.open(`${NAMED_PIN}&view=51.50349,-0.1277,${closeIn}`);

    await app.press(app.sentenceSpot('away'));
    await app.searchAndPick('heathrow', 'Heathrow Airport');

    await expect(app.pinSentence).toHaveText('Infinite Loop 1 sits on Heathrow Airport.');
    await app.drawn();
    const state = await app.state();
    expect(distanceMeters(state.reg.baseAnchor, HEATHROW)).toBeLessThan(SAME_SPOT_METERS);
    expectPinInMiddleOfStage(state);
    expect(state.camera.zoom).toBeCloseTo(closeIn, 2);
  });

  test('a click on the pin that slips a few pixels is still a click: its menu opens, and both names stay', { tag: '@desktop' }, async ({ app, page }) => {
    await app.open(NAMED_PIN);
    const before = await app.state();
    const pin = await app.onPage(before.pin);
    await app.comeTo(pin);
    await page.mouse.move(pin.x, pin.y);
    await expect(app.pinHandle).toHaveCSS('pointer-events', 'auto');

    // Five pixels: what a trackpad click slips by.
    await page.mouse.down();
    await page.mouse.move(pin.x + 4, pin.y + 3);
    await page.mouse.up();

    await expect(app.pinMenu).toBeVisible();
    expect((await app.state()).reg).toEqual(before.reg);
    await expect(app.pinSentence).toHaveText('Infinite Loop 1 sits on 10 Downing Street.');

    // A few pixels more is a drag, as short as it is: Home slides by that much, and no menu opens.
    await page.keyboard.press('Escape');
    await expect(app.pinMenu).toHaveCount(0);
    await page.mouse.down();
    await page.mouse.move(pin.x + 12, pin.y + 3);
    await page.mouse.up();

    const after = await app.state();
    expectPointNear(after.pin, { x: before.pin.x + 8, y: before.pin.y });
    expect(after.reg.overlayAnchor).toEqual(before.reg.overlayAnchor);
    await expect(app.pinMenu).toHaveCount(0);
  });

  test('a name lasts as long as its spot stays under the pin', async ({ app, fingers, mapService, page }) => {
    mapService.tile = tileOfTowns();
    await app.open(NAMED_PIN);
    const pin = await app.pinOnPage();
    const to = { x: pin.x + 70, y: pin.y + 60 };

    // Dragged by the pin, Home slides under it: the same spot of Home is pinned, on another spot of Away.
    await app.comeTo(pin);
    if (app.touch) await fingers.drag(pin, to, 4);
    else await dragWithMouse(page, pin, to, { steps: 3 });

    await expect(app.pinSentence).toHaveText(new RegExp(`^Infinite Loop 1 sits ${BY_A_TOWN}\\.$`));
    await expectPinInAddress(app);
    expect(await app.hash()).toContain('&hs=Infinite+Loop+1');
    expect(await app.hash()).not.toContain('&as=');

    // A slide on the map takes hold of Home by another spot, so the pin holds neither named spot now.
    await app.press(app.tool('Slide Home'));
    const from = { x: pin.x - 80, y: pin.y - 90 };
    const on = { x: from.x + 50, y: from.y + 30 };
    if (app.touch) await fingers.drag(from, on, 4);
    else await dragWithMouse(page, from, on, { steps: 3 });

    await expect(app.pinSentence).toHaveText(new RegExp(`^(?!Infinite Loop 1)${BY_A_TOWN} sits ${BY_A_TOWN}\\.$`));
    await expectPinInAddress(app);
    expect(await app.hash()).not.toMatch(/&(hs|as)=/);
  });

  test('Swap exchanges the two names with the places, and Line up again forgets them', async ({ app, page }) => {
    await app.open(NAMED_PIN);

    await app.press(app.swapButton);

    await expect(app.pinSentence).toHaveText('10 Downing Street sits on Infinite Loop 1.');
    await expect(page).toHaveURL(/#home=london&away=san-jose&pin=51\.50349,-0\.1277~37\.33167,-122\.0301&hs=10\+Downing\+Street&as=Infinite\+Loop\+1&/);

    await app.press(app.moreButton);
    await app.press(app.menu.getByRole('button', { name: /^Line up again/ }));

    await expect(app.pinSentence).toHaveText('Central London sits on downtown San Jose.');
    const { reg, spots } = await app.state();
    expect(spots).toEqual({ home: null, away: null });
    expect(reg).toEqual({ overlayAnchor: LONDON, baseAnchor: SAN_JOSE, rotation: 0 });
    await expect(page).toHaveURL(/#home=london&away=san-jose&trip=none$/);
  });
});

test.describe('what a spot picker lists', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open(NO_TRIP);
  });

  test('before anything is typed: the centre of the place, and spots picked before that are near it', async ({ app, page }) => {
    await app.press(app.sentenceSpot('away'));
    await expect(app.picker.getByRole('option')).toHaveText(['The centre of London']);
    await app.searchAndPick('10 downing', '10 Downing Street');
    await expect(app.pinSentence).toHaveText('Downtown San Jose sits on 10 Downing Street.');

    await app.press(app.sentenceSpot('away'));
    await expect(app.pickerGroup('Recent').locator('.picker__name')).toHaveText(['10 Downing Street']);
    await page.keyboard.press('Escape');

    // Downing Street is nowhere near San Jose.
    await app.press(app.sentenceSpot('home'));
    await expect(app.picker.getByRole('option')).toHaveText(['The centre of San Jose']);
  });

  test('it says when nothing matches, and when the search is not answering', async ({ app, placeSearch, consoleWatch }) => {
    consoleWatch.allow(/Failed to load resource|net::ERR_/);
    await app.press(app.sentenceSpot('away'));
    const field = app.picker.getByRole('combobox');

    await field.fill('zzyzx qq');
    await expect(app.picker.locator('.picker__status')).toHaveText(
      'No spot matches “zzyzx qq” in or near London. Check the spelling, or try a street or a landmark.',
    );

    placeSearch.down = true;
    await field.fill('heathrow');
    const notice = app.picker.locator('.picker__notice');
    await expect(notice).toBeVisible();
    await expect(notice.locator('p')).toHaveText("Search isn't answering right now. Try again.");

    placeSearch.down = false;
    await notice.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(app.pickerOption('Heathrow Airport')).toBeVisible();
  });

  test('a postcode on its own finds its spot, and the pin can be put on it', async ({ app }) => {
    await app.press(app.sentenceSpot('away'));
    await app.picker.getByRole('combobox').fill('SW1A 1AA');
    // The row says where the postcode is.
    await expect(app.picker.getByRole('option')).toHaveText(['SW1A 1AA Westminster, London']);
    await app.press(app.pickerOption('SW1A 1AA'));
    await expect(app.pinSentence).toHaveText('Downtown San Jose sits on SW1A 1AA.');

    await app.press(app.sentenceSpot('home'));
    await app.picker.getByRole('combobox').fill('95014');
    await expect(app.picker.getByRole('option')).toHaveText(['95014 Cupertino']);
    await app.press(app.pickerOption('95014'));
    await expect(app.pinSentence).toHaveText('95014 sits on SW1A 1AA.');

    const { reg } = await app.state();
    expect(distanceMeters(reg.baseAnchor, PALACE_POSTCODE)).toBeLessThan(SAME_SPOT_METERS);
    expect(distanceMeters(reg.overlayAnchor, CUPERTINO_POSTCODE)).toBeLessThan(SAME_SPOT_METERS);
  });
});

for (const phone of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
] as const) {
  test.describe(`on a phone ${phone.width} by ${phone.height}`, { tag: '@phone' }, () => {
    test.use({ viewport: phone });

    async function expectNothingOutsideScreen(app: MapzApp): Promise<void> {
      const reach = await reachOfPage(app.page);
      expect(reach.scrollWidth).toBeLessThanOrEqual(phone.width);
      expect(reach.scrollHeight).toBeLessThanOrEqual(phone.height);
      expect(reach.outside).toEqual([]);
    }

    test('a tap on the pin opens its menu as a sheet, the pickers are sheets, and nothing reaches outside the screen', async ({ app, page }) => {
      await app.open(NO_TRIP);

      await app.pressPin();
      await expect(app.menu).toHaveAttribute('data-layout', 'sheet');
      await expectSheetOnScreen(app.pinMenu, phone);
      await expect(app.pinMenu.locator('.menu__item')).toHaveText(MENU_ROWS);
      const rows = await touchTargets(app.pinMenu.getByRole('button'));
      expect(rows).toHaveLength(MENU_ROWS.length + 1);
      expect(tooSmall(rows)).toEqual([]);

      await app.pinMenuRow('Away spot').tap();
      await expect(app.picker).toHaveAttribute('data-layout', 'sheet');
      await expectSheetOnScreen(app.picker.getByRole('dialog'), phone);
      await app.searchAndPick('10 downing', '10 Downing Street');

      await expect(app.picker).toHaveCount(0);
      await expect(app.menu).toHaveCount(0);
      await expect(app.caption).toHaveText('Downtown San Jose sits on 10 Downing Street.');
      await app.drawn();
      expectPinInMiddleOfStage(await app.state());
      await expectNothingOutsideScreen(app);
      // The two spots of the pin sentence are pressed with a finger here.
      const spots = await touchTargets(page.locator('.caption [role="button"]'));
      expect(spots).toHaveLength(2);
      expect(tooSmall(spots)).toEqual([]);

      await app.tool('Measure').tap();
      await app.captionButton('To an address').tap();
      await expect(app.pickerHeading).toHaveText('Measure from the pin to where?');
      await expect(app.picker).toHaveAttribute('data-layout', 'sheet');
      await expectSheetOnScreen(app.picker.getByRole('dialog'), phone);
      await app.closePicker();
      await expect(app.picker).toHaveCount(0);
      await expectNothingOutsideScreen(app);
    });
  });
}
