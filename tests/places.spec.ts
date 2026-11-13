import { distanceMeters } from '../src/geo/distance';
import { expect, test } from './fixtures';
import { tripOf, type WwiwiwhApp } from './support/app';
import { expectPointNear } from './support/pointer';

const LONDON = { lat: 51.5073, lng: -0.1276 };
const TOKYO = { lat: 35.6812, lng: 139.7671 };
const PALO_ALTO = { lat: 37.4443, lng: -122.1598 };

/** The view is on this place, and the pin is in the middle of it. */
async function expectViewOn(app: WwiwiwhApp, place: { lat: number; lng: number }): Promise<void> {
  await app.drawn();
  const { camera, pin, stage } = await app.state();
  expect(distanceMeters(camera.center, place)).toBeLessThan(3_000);
  expect(pin.x).toBeCloseTo(stage.width / 2, 0);
  expect(pin.y).toBeCloseTo(stage.height / 2, 0);
}

test.describe('choosing places', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('picking a new Away moves the map there', async ({ app, page }) => {
    await app.pickPlace('away', 'Tokyo');

    await expect(app.picker).toHaveCount(0);
    await expect(app.legendName('away')).toHaveText('Tokyo');
    await expect(page).toHaveTitle('San Jose over Tokyo at the same scale | wwiwiwh');
    await expectViewOn(app, TOKYO);
    const { reg } = await app.state();
    expect(distanceMeters(reg.baseAnchor, TOKYO)).toBeLessThan(50);
  });

  test('picking a new Away is written to the address at once', async ({ app, page }) => {
    await app.pickPlace('away', 'Tokyo');
    await expect(page).toHaveURL(/#home=san-jose&away=tokyo$/);
  });

  test('picking a new Home keeps the view on Away and brings that place with its own trip', async ({ app }) => {
    await app.pickPlace('home', 'Tokyo');

    await expect(app.legendName('home')).toHaveText('Tokyo');
    await expectViewOn(app, LONDON);
    await expect(app.caption).toContainText(/^Yokohama to Tokyo is /);
  });

  test('the place already held by the other role cannot be picked', async ({ app }) => {
    await app.press(app.legendRow('away'));
    await expect(app.pickerOption('San Jose')).toHaveAttribute('aria-disabled', 'true');
  });

  test('a place found by searching can be picked', async ({ app, page }) => {
    await app.press(app.legendRow('away'));
    await app.picker.getByRole('combobox').fill('palo al');
    await app.press(app.pickerOption('Palo Alto').first());

    await expect(app.legendName('away')).toHaveText('Palo Alto');
    await expectViewOn(app, PALO_ALTO);
    // A place that is not a preset travels in the link by position and name.
    await expect(page).toHaveURL(/&away=37\.\d+,-122\.\d+,Palo\+Alto$/);
  });
});

test.describe('choosing places from the keyboard', { tag: '@desktop' }, () => {
  test('a place can be searched for and picked without a pointer', async ({ app, page }) => {
    await app.open();

    await page.keyboard.press('2');
    await expect(app.picker.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('toky');
    await expect(app.pickerOption('Tokyo').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(app.picker).toHaveCount(0);
    await expect(app.legendName('away')).toHaveText('Tokyo');
    await expect(app.legendRow('away')).toBeFocused();
  });

  test('Escape closes the picker and changes nothing', async ({ app, page }) => {
    await app.open();
    await page.keyboard.press('1');
    await expect(app.picker).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(app.picker).toHaveCount(0);
    await expect(app.legendName('home')).toHaveText('San Jose');
    await expect(app.legendRow('home')).toBeFocused();
  });
});

test.describe('Swap', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('exchanges the names of the two places', async ({ app, page }) => {
    await app.press(app.swapButton);

    await expect(app.legendName('home')).toHaveText('London');
    await expect(app.legendName('away')).toHaveText('San Jose');
    await expect(page).toHaveTitle('London over San Jose at the same scale | wwiwiwh');
  });

  test('keeps the trip on the same ground', async ({ app }) => {
    const before = tripOf(await app.state());
    await app.press(app.swapButton);
    await expect(app.legendName('home')).toHaveText('London');
    await app.drawn();
    const after = tripOf(await app.state());

    // The picture is the same picture in exchanged inks: the trip is drawn where it was.
    expectPointNear(after.ends[0], before.ends[0], 1);
    expectPointNear(after.ends[1], before.ends[1], 1);
    // Its San Jose end lay on central London, so that is where it is now on the new Home.
    expect(distanceMeters(after.trip.to, LONDON)).toBeLessThan(50);
    expect(Math.abs(after.meters - before.meters) / before.meters).toBeLessThan(0.01);
  });

  test('twice brings back the names of both ends of the trip, and in between the link names where they land', async ({ app, page }) => {
    const named = (await app.caption.textContent()) ?? '';
    expect(named).toMatch(/^Palo Alto to San Jose is 16\.7 mi /);

    await app.press(app.swapButton);

    // On London the two ends have no names of their own; they land on the spots of San Jose they were named for.
    await expect(app.caption).toHaveText(/^This line is 16\.7 mi .* Palo Alto to San Jose\.$/);
    await expect(page).toHaveURL(/#home=london&away=san-jose&.*&trip=[^&]+&ts=Palo\+Alto&tl=San\+Jose$/);

    await app.press(app.swapButton);

    await expect(app.caption).toHaveText(named);
    expect(tripOf(await app.state()).trip).toMatchObject({ fromName: 'Palo Alto', toName: 'San Jose' });
    // The trip San Jose comes with, names and all, is what a link shows without being told.
    await expect(page).toHaveURL(/#home=san-jose&away=london&view=[^&]+$/);
  });

  test('is undone by Back', async ({ app, page }) => {
    const before = await app.state();
    await app.press(app.swapButton);
    await expect(app.legendName('home')).toHaveText('London');

    await page.goBack();

    await expect(app.legendName('home')).toHaveText('San Jose');
    await expect(app.legendName('away')).toHaveText('London');
    await app.drawn();
    const after = await app.state();
    expect(after.trip).toEqual(before.trip);
    expect(after.reg).toEqual(before.reg);
    expect(distanceMeters(after.camera.center, before.camera.center)).toBeLessThan(100);
    expect(after.camera.zoom).toBeCloseTo(before.camera.zoom, 2);
  });
});

test.describe('Swap straight after a slide', { tag: '@desktop' }, () => {
  test('Back restores the slide, though the address had not yet settled on it', async ({ app, page }) => {
    await app.open();
    await page.keyboard.press('Shift+ArrowRight');
    const slid = await app.state();

    await page.keyboard.press('x');
    await expect(app.legendName('home')).toHaveText('London');
    await page.goBack();

    await expect(app.legendName('home')).toHaveText('San Jose');
    await app.drawn();
    const { reg } = await app.state();
    expect(distanceMeters(reg.baseAnchor, slid.reg.baseAnchor)).toBeLessThan(2);
    expect(reg.baseAnchor).not.toEqual(LONDON);
  });
});

test.describe('Back and Forward', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('step through the pairs of places that were chosen', async ({ app, page }) => {
    const expectPair = async (home: string, away: string): Promise<void> => {
      await expect(app.legendName('home')).toHaveText(home);
      await expect(app.legendName('away')).toHaveText(away);
      await expect(page).toHaveTitle(`${home} over ${away} at the same scale | wwiwiwh`);
    };

    await app.pickPlace('away', 'Tokyo');
    await expectPair('San Jose', 'Tokyo');
    await app.pickPlace('home', 'Paris');
    await expectPair('Paris', 'Tokyo');

    await page.goBack();
    await expectPair('San Jose', 'Tokyo');
    await expectViewOn(app, TOKYO);

    await page.goBack();
    await expectPair('San Jose', 'London');
    await expectViewOn(app, LONDON);

    await page.goForward();
    await expectPair('San Jose', 'Tokyo');
    await expectViewOn(app, TOKYO);

    await page.goForward();
    await expectPair('Paris', 'Tokyo');
    await expect(app.caption).toContainText(/^Versailles to Paris is /);
  });

  test('Back closes an open picker', async ({ app, page }) => {
    await app.pickPlace('away', 'Tokyo');
    await expect(app.legendName('away')).toHaveText('Tokyo');
    await app.press(app.legendRow('home'));
    await expect(app.picker).toBeVisible();

    await page.goBack();

    await expect(app.picker).toHaveCount(0);
    await expect(app.legendName('away')).toHaveText('London');
  });

  test('Back closes an open More menu', async ({ app, page }) => {
    await app.pickPlace('away', 'Tokyo');
    await expect(app.legendName('away')).toHaveText('Tokyo');
    await app.press(app.moreButton);
    await expect(app.menu).toBeVisible();

    await page.goBack();

    await expect(app.menu).toHaveCount(0);
    await expect(app.legendName('away')).toHaveText('London');
  });
});
