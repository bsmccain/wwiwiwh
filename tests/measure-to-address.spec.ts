import { LINE_ZOOM } from '../src/app/controller';
import { distanceMeters } from '../src/geo/distance';
import { baseToOverlay, overlayToBase } from '../src/geo/registration';
import type { LngLat } from '../src/geo/types';
import { formatDistance } from '../src/geo/units';
import { expect, test } from './fixtures';
import { tripOf, type MapzApp } from './support/app';
import { savedSpot, savedSpots } from './support/place-search';
import { expectPointNear } from './support/pointer';
import { ANY_TOWN, tileOfTowns } from './support/towns';

/**
 * A trip can be drawn to an address or a landmark on either place, from the pin menu and from the
 * caption while measuring. It starts at the pin, or where measuring has already put its start. On
 * Home the trip ends at the address. On Away it ends on the spot of Home that lies over the address,
 * so that it lands there.
 */

/** Spots as the saved search answers have them. */
const INFINITE_LOOP = savedSpot('1 infinite loop', 'Infinite Loop 1');
const DOWNING_STREET = savedSpot('10 downing', '10 Downing Street');
const HEATHROW = savedSpot('heathrow', 'Heathrow Airport');
const HOTEL = savedSpot('santana row', 'Hotel Valencia - Santana Row');
const KINGS_CROSS = savedSpot('kings cross station', "London King's Cross Railway Station");
const DOWNING_HOUSE = savedSpot('10 downing', 'Downing House');
/** A restaurant round the corner from Infinite Loop 1, which the search for that address finds as well. */
const ROUND_THE_CORNER = savedSpot('1 infinite loop', 'BJ’s');
/** A pick ends the trip on the spot that was found, to within what the rounding of a coordinate allows. */
const SAME_SPOT_METERS = 2;

/** The pin as every test here finds it: Infinite Loop 1 held on 10 Downing Street, as a link rounds them. */
const PIN = { overlayAnchor: { lat: 37.33167, lng: -122.0301 }, baseAnchor: { lat: 51.50349, lng: -0.1277 }, rotation: 0 };
const NAMED_PIN = 'home=san-jose&away=london&pin=37.33167,-122.0301~51.50349,-0.1277&hs=Infinite+Loop+1&as=10+Downing+Street';

const inLink = ({ lat, lng }: LngLat): string => `${lat.toFixed(5)},${lng.toFixed(5)}`;
/** The same pin with a trip from it that was aimed at Heathrow Airport, as a link carries it. */
const AIMED_AT_HEATHROW = `${NAMED_PIN}&trip=${inLink(PIN.overlayAnchor)}~${inLink(baseToOverlay(PIN, HEATHROW))}&tf=Infinite+Loop+1&tl=Heathrow+Airport`;

/** Words that place a spot by one of the towns the tiles carry: "near Alderley", "3 mi north of Dunmere". */
const BY_A_TOWN = `.*(${ANY_TOWN})`;

/**
 * The caption's sentence about a trip, as a pattern: in full on wide screens, in short on narrow
 * ones. `onHome` and `onAway` are patterns for the words that say where it runs on each place.
 */
function tripCaption(app: MapzApp, meters: number, where: { readonly onHome: string; readonly onAway: string }): RegExp {
  const literal = (text: string): string => text.replace(/[.()]/g, '\\$&');
  const miles = literal(formatDistance(meters, 'mi'));
  if (app.touch) return new RegExp(`^${where.onHome} is ${miles} in a straight line\\. On London: ${where.onAway}\\.$`);
  const kilometres = literal(`(${formatDistance(meters, 'km')})`);
  return new RegExp(`^${where.onHome} is ${miles} ${kilometres} in a straight line\\. Laid on London, that runs from ${where.onAway}\\.$`);
}

test.describe('measuring from the pin to an address', () => {
  test.beforeEach(({ mapService }) => {
    mapService.tile = tileOfTowns();
  });

  test('from the pin menu, to an address on Away', async ({ app, page }) => {
    await app.open(`${NAMED_PIN}&trip=none`);
    // On a narrow screen the Home end is put into words only when it has a name of its own.
    const where = {
      onHome: app.touch ? `(This line|Infinite Loop 1 to ${BY_A_TOWN})` : `Infinite Loop 1 to ${BY_A_TOWN}`,
      onAway: '10 Downing Street to Heathrow Airport',
    };

    await app.choosePinMenuRow('Measure from the pin to an address');
    await expect(app.pickerHeading).toHaveText('Measure from the pin to where?');
    await expect(app.pickerLine).toHaveText('An address or landmark in San Jose or in London.');
    await app.picker.getByRole('combobox').fill('heathrow');
    const airport = app.pickerOption('Heathrow Airport', 'In London');
    await expect(airport.locator('.picker__ink--away')).toBeVisible();
    await app.press(airport);

    await expect(app.picker).toHaveCount(0);
    await expect(app.menu).toHaveCount(0);
    await app.drawn();
    const state = await app.state();
    const { trip, meters } = tripOf(state);
    expect(trip.from).toEqual(state.reg.overlayAnchor);
    expect(distanceMeters(trip.from, INFINITE_LOOP)).toBeLessThan(SAME_SPOT_METERS);
    expect(distanceMeters(overlayToBase(state.reg, trip.to), HEATHROW)).toBeLessThan(SAME_SPOT_METERS);
    // The two maps are at one scale, so the line is as long on Home as the way to the airport is on Away.
    expect(Math.abs(meters / distanceMeters(DOWNING_STREET, HEATHROW) - 1)).toBeLessThan(0.005);
    await expect(app.caption).toHaveText(tripCaption(app, meters, where));
    await expect(app.plaque).toHaveText(formatDistance(meters, 'mi'));
    await expect(page).toHaveURL(/&trip=[^&]+&tf=Infinite\+Loop\+1&tl=Heathrow\+Airport$/);

    await app.reload();
    const again = tripOf(await app.state());
    expect(again.trip).toMatchObject({ fromName: 'Infinite Loop 1', toLanding: { name: 'Heathrow Airport' } });
    await expect(app.caption).toHaveText(tripCaption(app, again.meters, where));
  });

  test('from the caption while measuring, to an address on Home', async ({ app, page }) => {
    await app.open(`${NAMED_PIN}&trip=none`);
    const where = { onHome: 'Infinite Loop 1 to Hotel Valencia - Santana Row', onAway: `10 Downing Street to ${BY_A_TOWN}` };

    await app.press(app.tool('Measure'));
    await app.press(app.captionButton('To an address'));
    await expect(app.pickerHeading).toHaveText('Measure from the pin to where?');
    await app.picker.getByRole('combobox').fill('santana row');
    const hotel = app.pickerOption('Hotel Valencia - Santana Row', 'In San Jose');
    await expect(hotel.locator('.picker__ink--home')).toBeVisible();
    await app.press(hotel);

    await expect(app.picker).toHaveCount(0);
    // Picking a target ends measuring.
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');
    await app.drawn();
    const state = await app.state();
    expect(state.mode).toBe('browse');
    const { trip, meters } = tripOf(state);
    expect(trip.from).toEqual(state.reg.overlayAnchor);
    expect(distanceMeters(trip.to, HOTEL)).toBeLessThan(SAME_SPOT_METERS);
    expect(Math.abs(meters - distanceMeters(INFINITE_LOOP, HOTEL))).toBeLessThan(2 * SAME_SPOT_METERS);
    await expect(app.caption).toHaveText(tripCaption(app, meters, where));
    await expect(app.plaque).toHaveText(formatDistance(meters, 'mi'));
    await expect(page).toHaveURL(/&trip=[^&]+&tf=Infinite\+Loop\+1&tt=Hotel\+Valencia\+-\+Santana\+Row$/);

    await app.reload();
    const again = tripOf(await app.state());
    expect(again.trip).toMatchObject({ fromName: 'Infinite Loop 1', toName: 'Hotel Valencia - Santana Row' });
    await expect(app.caption).toHaveText(tripCaption(app, again.meters, where));
  });

  test('turning Home afterwards takes the name off the spot the trip was aimed at', async ({ app, page }) => {
    await app.open(AIMED_AT_HEATHROW);
    await expect(app.caption).toHaveText(/10 Downing Street to Heathrow Airport\.$/);

    if (app.touch) {
      await app.tool('Slide Home').tap();
      await app.slideTool('Turn right').tap();
      await app.slideTool('Done').tap();
    } else {
      await app.turnButton('right').click();
    }

    // The trip turned about the pin with Home: it starts where it did and lands somewhere else.
    await expect(app.caption).toHaveText(new RegExp(`10 Downing Street to (?!Heathrow Airport)${BY_A_TOWN}\\.$`));
    expect((await app.state()).reg.rotation).toBeGreaterThan(0);
    await expect(page).toHaveURL(/&turn=\d+&trip=[^&]+&tf=Infinite\+Loop\+1$/);
  });

  const secondStep = 'at the second step of measuring: both places are listed, each in its ink, and the trip starts where its start was put';
  test(secondStep, { tag: '@desktop' }, async ({ app, page, placeSearch }) => {
    // One query that finds things in both places, put together from two saved answers.
    placeSearch.answerSpots('station row', [...savedSpots('kings cross station'), ...savedSpots('santana row')]);
    await app.open(`${NAMED_PIN}&trip=none`);
    await app.tool('Measure').click();
    await app.pressAt(await app.stageSpot(0.3, 0.3));
    await expect(app.caption).toHaveText('Now click where it ends.');
    const start = (await app.state()).tripDraft;
    expect(start).not.toBeNull();

    // The pin menu offers the same, and no longer says that the line starts at the pin.
    await page.keyboard.press('a');
    await expect(app.pinMenuRow('Measure from the start to an address')).toBeVisible();
    await page.keyboard.press('Escape');

    await app.captionButton('To an address').click();
    await expect(app.pickerHeading).toHaveText('Measure to where?');
    await app.picker.getByRole('combobox').fill('station row');
    // The two places share the room.
    await expect(app.pickerGroup('In San Jose').getByRole('option')).toHaveCount(4);
    await expect(app.pickerGroup('In San Jose').locator('.picker__ink--home')).toHaveCount(4);
    await expect(app.pickerGroup('In London').getByRole('option')).toHaveCount(4);
    await expect(app.pickerGroup('In London').locator('.picker__ink--away')).toHaveCount(4);
    const station = app.pickerOption("London King's Cross Railway Station", 'In London');
    // Read out on its own, a row still says which place it is in.
    await expect(station).toHaveAccessibleName("London King's Cross Railway Station, King's Cross, London, in London");
    await station.click();

    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');
    const state = await app.state();
    expect(state.tripDraft).toBeNull();
    const { trip } = tripOf(state);
    expect(trip.from).toEqual(start);
    expect(distanceMeters(overlayToBase(state.reg, trip.to), KINGS_CROSS)).toBeLessThan(SAME_SPOT_METERS);
    // The start is a spot that was pointed at, not the pin's: the pin's names are not its names.
    expect(trip.fromName).toBeUndefined();
    await expect(app.caption).toHaveText(new RegExp(`that runs from (?!10 Downing Street)${BY_A_TOWN} to London King's Cross Railway Station\\.$`));

    // Before anything is typed the next time, the spot is offered again, under the place it is near.
    await page.keyboard.press('a');
    await app.pinMenuRow('Measure from the pin to an address').click();
    await expect(app.pickerHeading).toHaveText('Measure from the pin to where?');
    await expect(app.pickerGroup('Recent in London').locator('.picker__name')).toHaveText(["London King's Cross Railway Station"]);
    await expect(app.pickerGroup('Recent in San Jose')).toHaveCount(0);
  });

  test('opened from the pin, the list shows what was found in both places without scrolling', async ({ app, placeSearch }) => {
    placeSearch.answerSpots('station row', [...savedSpots('kings cross station'), ...savedSpots('santana row')]);
    await app.open(`${NAMED_PIN}&trip=none`);

    await app.choosePinMenuRow('Measure from the pin to an address');
    await app.picker.getByRole('combobox').fill('station row');

    await expect(app.pickerGroup('In San Jose').getByRole('option')).toHaveCount(4);
    await expect(app.pickerGroup('In London').getByRole('option')).toHaveCount(4);
    // A sheet takes a moment to rise.
    await expect.poll(() => app.pickerRowsOutOfSight()).toEqual([]);
  });

  test('the spot the line would start from is not offered, and a line to round the corner is framed from close up', async ({ app }) => {
    await app.open(`${NAMED_PIN}&trip=none`);

    await app.choosePinMenuRow('Measure from the pin to an address');
    await app.picker.getByRole('combobox').fill('1 infinite loop');
    // The search finds Infinite Loop 1 before anything else, and the pin is on it.
    await expect(app.picker.getByRole('option').locator('.picker__name')).toHaveText(['BJ’s']);
    await app.press(app.pickerOption('BJ’s'));

    await expect(app.picker).toHaveCount(0);
    await app.drawn();
    const state = await app.state();
    const { trip, meters, ends } = tripOf(state);
    expect(trip.from).toEqual(state.reg.overlayAnchor);
    expect(distanceMeters(trip.to, ROUND_THE_CORNER)).toBeLessThan(SAME_SPOT_METERS);
    expect(meters).toBeLessThan(200);
    // As close as a line is ever framed, with the pin in the middle and the line long enough to see.
    expect(state.camera.zoom).toBeCloseTo(LINE_ZOOM, 2);
    expectPointNear(state.pin, { x: state.stage.width / 2, y: state.stage.height / 2 });
    expect(Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y)).toBeGreaterThan(40);
  });

  test('a spot picked for the pin is not offered as where to measure to from it, and a line of no length is never drawn', { tag: '@desktop' }, async ({ app, page }) => {
    await app.open('home=san-jose&away=london&trip=none');
    await app.sentenceSpot('away').click();
    await app.searchAndPick('10 downing', '10 Downing Street');
    await expect(app.pinSentence).toHaveText('Downtown San Jose sits on 10 Downing Street.');

    await page.keyboard.press('a');
    await app.pinMenuRow('Measure from the pin to an address').click();
    // The spot picked a moment ago would be listed here, were the pin not on it.
    await expect(app.pickerHeading).toHaveText('Measure from the pin to where?');
    await expect(app.pickerGroup('Recent in London')).toHaveCount(0);
    await app.picker.getByRole('combobox').fill('10 downing');
    await expect(app.pickerOption('Downing House')).toBeVisible();
    await expect(app.pickerOption('10 Downing Street')).toHaveCount(0);

    // What is listed is never where the line starts. Should the pin be moved onto a listed spot
    // behind the list all the same, picking that spot draws nothing.
    await page.evaluate((spot) => {
      const { dual } = window.__mapzWatch.app();
      dual.setRegistration({ ...dual.getRegistration(), baseAnchor: spot });
    }, DOWNING_HOUSE);
    await app.pickerOption('Downing House').click();

    await expect(app.picker).toHaveCount(0);
    expect((await app.state()).trip).toBeNull();
    await expect(app.plaque).toBeHidden();
    await expect(app.pinMenuRow('Measure from the pin to an address')).toBeFocused();
  });
});
