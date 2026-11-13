import { distanceMeters } from '../src/geo/distance';
import { expect, test } from './fixtures';
import { MapzApp, tripOf } from './support/app';
import { dragWithMouse, expectPointNear } from './support/pointer';
import { expectDrawnInOrder } from './support/text';

test.describe('opening a link', () => {
  test('restores the places, the pin, the turn, the view, the trip and the rings it names', async ({ app, page }) => {
    await app.open('home=tokyo&away=paris&pin=35.6,139.7~48.9,2.3&turn=28&view=48.86,2.34,11.5&trip=35.7,139.6~35.6,139.8&rings=0');

    const state = await app.state();
    expect(state.home.name).toBe('Tokyo');
    expect(state.away.name).toBe('Paris');
    expect(state.reg).toEqual({ overlayAnchor: { lat: 35.6, lng: 139.7 }, baseAnchor: { lat: 48.9, lng: 2.3 }, rotation: 28 });
    expect(state.camera.zoom).toBeCloseTo(11.5, 5);
    expect(distanceMeters(state.camera.center, { lat: 48.86, lng: 2.34 })).toBeLessThan(1);
    expect(state.trip).toEqual({ from: { lat: 35.7, lng: 139.6 }, to: { lat: 35.6, lng: 139.8 } });
    expect(state.rings).toBe(false);
    await expect(page).toHaveTitle('Tokyo over Paris at the same scale | mapz');
    await expect(app.toast).toHaveCount(0);
  });

  test('a link that names a place that cannot be understood opens the default pair and says so', async ({ app }) => {
    await app.open('home=atlantis&away=london&turn=sideways');

    await expect(app.legendName('home')).toHaveText('San Jose');
    await expect(app.legendName('away')).toHaveText('London');
    await expect(app.toast).toHaveText('That link was incomplete, so here is San Jose over London.');
    const { reg, trip } = await app.state();
    expect(reg.rotation).toBe(0);
    expect(trip).toMatchObject({ fromName: 'Palo Alto' });
  });

  test('a broken link is repaired in the address', async ({ app }) => {
    await app.open('home=atlantis&away=london&turn=sideways');
    expect(await app.hash()).toBe('#home=san-jose&away=london');
  });

  test('a hash that is no link at all opens the default pair, says so and is repaired', async ({ app }) => {
    await app.open('%%%nonsense');

    await expect(app.toast).toHaveText('That link was incomplete, so here is San Jose over London.');
    expect(await app.hash()).toBe('#home=san-jose&away=london');
    await expect(app.legendName('home')).toHaveText('San Jose');
  });

  test('a broken link typed into an open page is repaired the same way', async ({ app, page }) => {
    await app.open();

    await page.evaluate(() => {
      window.location.hash = 'home=atlantis&away=tokyo';
    });

    await expect(app.legendName('away')).toHaveText('Tokyo');
    await expect(app.legendName('home')).toHaveText('San Jose');
    await expect(app.toast).toHaveText('That link was incomplete, so here is San Jose over Tokyo.');
    await expect(page).toHaveURL(/#home=san-jose&away=tokyo$/);
  });
});

/** Names in a link are words anyone can have written. */
test.describe('names in a link', () => {
  const CAIRO = 'القاهرة';

  test('a name written from right to left reads in its place, with the words around it in theirs', async ({ app }) => {
    // Away is Cairo under its own name, and the link names the spots of it that the trip's two ends land on.
    const trip = 'trip=37.33167,-122.0301~37.4,-121.95&ts=6+October+Bridge&tl=Tahrir+Square';
    await app.open(`home=san-jose&away=30.0444,31.2357,${encodeURIComponent(CAIRO)}&${trip}`);

    await expect(app.legendName('away')).toHaveText(CAIRO);
    expect(await app.state()).toMatchObject({
      away: { name: CAIRO },
      trip: { fromLanding: { name: '6 October Bridge' }, toLanding: { name: 'Tahrir Square' } },
    });
    const laidOn = app.touch ? `On ${CAIRO}: ` : `Laid on ${CAIRO}, that runs from `;
    await expect(app.caption).toHaveText(new RegExp(` in a straight line\\. ${laidOn}6 October Bridge to Tahrir Square\\.$`));
    // Left to itself, the number that follows the name would be drawn on the far side of it.
    await expectDrawnInOrder(app.caption, ['straight line', CAIRO, '6 October Bridge', 'Tahrir Square']);
  });

  test('a mark that turns the direction of text around is taken out of a name, and the caption reads as ever', async ({ app }) => {
    const turnsTextAround = encodeURIComponent('\u202E');
    await app.open(`home=san-jose&away=london&trip=37.3318,-122.0312~37.4,-121.9&tf=${turnsTextAround}desrever&tt=School`);

    await expect(app.caption).toHaveText(/^Desrever to School is 8\.6 mi /);
    expect(tripOf(await app.state()).trip.fromName).toBe('desrever');
    await expectDrawnInOrder(app.caption, ['Desrever', 'School', '8.6 mi', 'straight line']);
  });

  test('names a link gives to the trip a place comes with stay in the address', { tag: '@desktop' }, async ({ app, page }) => {
    // San Jose's own trip, from Palo Alto, with the spots of London its ends land on named.
    await app.open('home=san-jose&away=london&trip=37.4443,-122.1598~37.3322,-121.8896&ts=Big+Ben&tl=Heathrow');
    await expect(app.caption).toHaveText(/that runs from Big Ben to Heathrow\.$/);

    // Anything that has the address written again.
    await page.keyboard.press('g');
    await expect.poll(() => app.hash()).toContain('rings=0');

    expect(await app.hash()).toContain('&ts=Big+Ben&tl=Heathrow');
  });
});

test.describe('Copy link', { tag: '@desktop' }, () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copies a link that reproduces the pin, the turn, the view, the trip and the rings in a fresh page', async ({ app, context, page }) => {
    await app.open();
    // Something of everything a link carries: Home slid and turned, a trip of our own, no rings, a view of our own.
    const from = await app.stageSpot(0.4, 0.4);
    await dragWithMouse(page, from, { x: from.x + 60, y: from.y + 40 }, { holding: 'Shift' });
    await page.keyboard.press(']');
    await app.tool('Measure').click();
    await app.pressAt(await app.stageSpot(0.3, 0.3));
    await app.pressAt(await app.stageSpot(0.6, 0.6));
    await app.tool('Rings').click();
    await app.zoomButton('in').click();
    await app.drawn();
    const original = await app.state();

    await app.copyLinkButton.click();
    await expect(app.toast).toHaveText('Link copied. It opens this exact view.');
    const link = await page.evaluate(() => navigator.clipboard.readText());

    const fresh = new MapzApp(await context.newPage(), false);
    await fresh.page.goto(link);
    await fresh.drawn();
    const copy = await fresh.state();

    expect(copy.home).toEqual(original.home);
    expect(copy.away).toEqual(original.away);
    expect(copy.reg.rotation).toBeCloseTo(original.reg.rotation, 1);
    // A link keeps five decimals of a degree: about a metre.
    expect(distanceMeters(copy.reg.overlayAnchor, original.reg.overlayAnchor)).toBeLessThan(2);
    expect(distanceMeters(copy.reg.baseAnchor, original.reg.baseAnchor)).toBeLessThan(2);
    expect(distanceMeters(copy.camera.center, original.camera.center)).toBeLessThan(2);
    expect(copy.camera.zoom).toBeCloseTo(original.camera.zoom, 2);
    expect(distanceMeters(tripOf(copy).trip.from, tripOf(original).trip.from)).toBeLessThan(2);
    expect(distanceMeters(tripOf(copy).trip.to, tripOf(original).trip.to)).toBeLessThan(2);
    expect(copy.rings).toBe(false);
    // The same stage shows the same picture: the pin and the trip are drawn where they were.
    expectPointNear(copy.pin, original.pin, 1);
    expectPointNear(tripOf(copy).ends[0], tripOf(original).ends[0], 1);
  });

  test('the C key copies the link too', async ({ app, page }) => {
    await app.open();

    await page.keyboard.press('c');

    await expect(app.toast).toHaveText('Link copied. It opens this exact view.');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/#home=san-jose&away=london&view=51\.5\d*,-0\.12\d*,10\.2$/);
  });

  test('copying puts the current view in the address without waiting for it to settle', async ({ app }) => {
    await app.open();
    await app.tool('Rings').click();

    await app.copyLinkButton.click();

    expect(await app.hash()).toContain('rings=0');
  });

  test('a name from a link that is too long is cut between characters, never through one, and the address and Copy link go on working', async ({ app, page }) => {
    // One character too many, and the cut falls at an emoji: half of one could not be written into a link at all.
    const kept = `${'x'.repeat(79)}🏠`;
    await app.open(`home=san-jose&away=london&hs=${encodeURIComponent(`${kept}🏡`)}`);
    expect((await app.state()).spots.home?.name).toBe(kept);

    await page.keyboard.press('x');
    await expect(app.legendName('home')).toHaveText('London');
    // Swapped, the name is the Away spot's.
    const named = `&as=${encodeURIComponent(kept)}&`;
    await expect.poll(() => app.hash()).toContain(named);
    expect(await app.hash()).toMatch(/^#home=london&away=san-jose&/);

    await app.copyLinkButton.click();
    await expect(app.toast).toHaveText('Link copied. It opens this exact view.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(named);
  });
});
