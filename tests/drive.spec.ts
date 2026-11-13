import { distanceMeters } from '../src/geo/distance';
import { baseToOverlay, overlayToBase } from '../src/geo/registration';
import type { LngLat } from '../src/geo/types';
import { formatDistance, formatDuration } from '../src/geo/units';
import type { ScreenPoint, Sheet } from '../src/map/contracts';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import type { Snapshot, WwiwiwhApp } from './support/app';
import { savedSpot } from './support/place-search';
import { expectPointNear } from './support/pointer';
import { standInDrive, standInReachMeters, type RoadRequest } from './support/road-service';

/**
 * A drive follows the roads of one of the two places, and the other place shades how far the same
 * time or distance of driving gets from the spot the drive's start lands on. The road service is a
 * stand-in here (see support/road-service.ts): every drive is 1.3 times the straight line at
 * 60 km/h, and every reach is a round area.
 */

const PALO_ALTO = { lat: 37.4419, lng: -122.143 };
const SAN_JOSE = { lat: 37.3382, lng: -121.8863 };
const PALO_ALTO_TO_SAN_JOSE = 'home=san-jose&away=london&drive=37.4419,-122.143~37.3382,-121.8863&df=Palo+Alto&dt=San+Jose';
const HEATHROW = savedSpot('heathrow', 'Heathrow Airport');
const KINGS_CROSS = savedSpot('kings cross station', "London King's Cross Railway Station");
/** A link, a question to the road service and a pick all keep a position to about a metre. */
const SAME_SPOT_METERS = 2;

const literal = (text: string): string => text.replace(/[.()]/g, '\\$&');

/** The drive of a snapshot. Throws when there is none. */
function driveOf({ drive }: Snapshot): NonNullable<Snapshot['drive']> {
  if (!drive) throw new Error('There is no drive.');
  return drive;
}

/** The first sentence of the caption about a drive between two spots, as a pattern: both units where there is room. */
function driveCaption(app: WwiwiwhApp, from: LngLat, to: LngLat, ends = '.+'): string {
  const { meters, seconds } = standInDrive(from, to);
  const distance = app.touch ? formatDistance(meters, 'mi') : `${formatDistance(meters, 'mi')} (${formatDistance(meters, 'km')})`;
  return `^${ends} is ${literal(distance)} by road, about ${formatDuration(seconds)}\\.`;
}

/** The sentence about the reach, as a pattern: in full on wide screens, in short on narrow ones. */
function reachCaption(app: WwiwiwhApp, amount: 'long' | 'far', other: string): string {
  return app.touch ? ` Shaded on ${other}: that ${amount} from .+\\.$` : ` Driving that ${amount} from .+ reaches the shaded part of ${other}\\.$`;
}

/** How many shapes each map is drawing of the drive's road and of its reach. */
async function drawn(app: WwiwiwhApp): Promise<Record<Sheet, { route: number; reach: number }>> {
  return app.page.evaluate(() => {
    const { dual } = window.__wwiwiwhWatch.app();
    const count = (map: typeof dual.base) => ({
      route: map.querySourceFeatures('drive-route').length,
      reach: map.querySourceFeatures('drive-reach').length,
    });
    return { home: count(dual.overlay), away: count(dual.base) };
  });
}

/** Waits for the road to be drawn on one map and the reach on the other, and for neither to be on the wrong one. */
async function expectDrawn(app: WwiwiwhApp, roadOn: Sheet): Promise<void> {
  const reachOn: Sheet = roadOn === 'home' ? 'away' : 'home';
  await expect(async () => {
    const shown = await drawn(app);
    expect(shown[roadOn].route).toBeGreaterThan(0);
    expect(shown[reachOn].reach).toBeGreaterThan(0);
    expect(shown[roadOn].reach).toBe(0);
    expect(shown[reachOn].route).toBe(0);
  }).toPass({ timeout: 15_000 });
}

/** The two rings about a drive's start: one through its end, one as far out as the drive is long by road. */
type RingKind = 'straight' | 'road';

const ringLabel = (app: WwiwiwhApp, kind: RingKind): Locator => app.page.locator(`.wwiwiwh-drive-ring-label--${kind}`);

/**
 * One of the rings about the drive's start as it is drawn: the radius of its arcs and the points they
 * run through (where each starts, its middle, where it ends), in stage pixels. Null while it is not showing.
 */
async function ringDrawn(app: WwiwiwhApp, kind: RingKind = 'straight'): Promise<{ radius: number; points: ScreenPoint[] } | null> {
  return app.page.locator(`.wwiwiwh-drive-ring--${kind}`).evaluate((path) => {
    if (path.closest('[hidden]')) return null;
    const d = path.getAttribute('d') ?? '';
    return {
      radius: Number(/A(\S+) /.exec(d)?.[1]),
      points: [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)(?=A|M|$)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) })),
    };
  });
}

const routesAsked = (requests: readonly RoadRequest[]): RoadRequest[] => requests.filter((request) => request.action === 'route');
const reachesAsked = (requests: readonly RoadRequest[]): RoadRequest[] => requests.filter((request) => request.action === 'isochrone');

test.describe('setting a drive by pointing', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('two presses on the map set a drive on Home: its road, its figures, and its reach on Away', async ({ app, page, roadService }) => {
    const press = app.touch ? 'tap' : 'click';
    const start = await app.stagePoint(0.3, 0.3);
    const end = await app.stagePoint(0.65, 0.55);

    await app.press(app.tool('Drive'));
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.caption).toHaveText(`${press === 'tap' ? 'Tap' : 'Click'} where the drive starts in San Jose.`);
    await expect(app.captionButton('On Away')).toHaveAttribute('aria-pressed', 'false');
    // The place is chosen before the start is put down, so its switch comes first, and the way out last.
    expect(await app.captionBand.getByRole('button').allInnerTexts()).toEqual(['On Away', 'To an address', 'Cancel']);

    await app.pressAt(await app.onPage(start));
    await expect(app.caption).toHaveText(`Now ${press} where it ends in San Jose.`);
    // The start settles which place the drive is on.
    await expect(app.captionButton('On Away')).toBeDisabled();
    expect(roadService.requests).toEqual([]);

    await app.pressAt(await app.onPage(end));
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'false');
    const state = await app.state();
    expect(state.mode).toBe('browse');
    // The drive takes the place of the trip San Jose came with.
    expect(state.trip).toBeNull();
    const drive = driveOf(state);
    expect(drive).toMatchObject({ on: 'home', match: 'time' });
    const startOnStage = await page.evaluate((at) => window.__wwiwiwhWatch.app().dual.projectHome(at), drive.from);
    const endOnStage = await page.evaluate((at) => window.__wwiwiwhWatch.app().dual.projectHome(at), drive.to);
    expectPointNear(startOnStage, start);
    expectPointNear(endOnStage, end);

    const { meters, seconds } = standInDrive(drive.from, drive.to);
    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, drive.from, drive.to) + reachCaption(app, 'long', 'London')));
    await expect(page.locator('.wwiwiwh-drive-plaque')).toHaveText(`${formatDistance(meters, 'mi')} · ${formatDuration(seconds)}`);
    await expectDrawn(app, 'home');

    // The road is asked for between the two ends, and the reach from where the start lands on Away, for as long as the drive takes.
    const [route] = routesAsked(roadService.requests);
    expect(distanceMeters(route?.locations[0] ?? SAN_JOSE, drive.from)).toBeLessThan(SAME_SPOT_METERS);
    expect(distanceMeters(route?.locations[1] ?? SAN_JOSE, drive.to)).toBeLessThan(SAME_SPOT_METERS);
    const [reach] = reachesAsked(roadService.requests);
    expect(distanceMeters(reach?.locations[0] ?? SAN_JOSE, overlayToBase(state.reg, drive.from))).toBeLessThan(SAME_SPOT_METERS);
    expect(reach?.contour).toEqual({ time: Number((seconds / 60).toFixed(1)) });
    expect(roadService.requests).toHaveLength(2);

    await expect(page).toHaveURL(/[#&]drive=-?\d+(\.\d+)?,-?\d+(\.\d+)?~-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  });

  test('"On Away" sets the drive on Away, and shades its reach on Home', async ({ app, page, roadService }) => {
    await app.press(app.tool('Drive'));
    await app.press(app.captionButton('On Away'));
    await expect(app.captionButton('On Away')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.caption).toHaveText(`${app.touch ? 'Tap' : 'Click'} where the drive starts in London.`);

    await app.pressAt(await app.stageSpot(0.3, 0.3));
    await app.pressAt(await app.stageSpot(0.65, 0.55));
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'false');
    const state = await app.state();
    const drive = driveOf(state);
    expect(drive.on).toBe('away');

    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, drive.from, drive.to) + reachCaption(app, 'long', 'San Jose')));
    await expectDrawn(app, 'away');
    const [reach] = reachesAsked(roadService.requests);
    expect(distanceMeters(reach?.locations[0] ?? SAN_JOSE, baseToOverlay(state.reg, drive.from))).toBeLessThan(SAME_SPOT_METERS);
    await expect(page).toHaveURL(/[#&]drive=[^&]+&on=away$/);

    // Another drive starts on the place the last one was on. The one on the map keeps its road and
    // its two marks while the new one is set, and gives up only its figures.
    await app.press(app.tool('Drive'));
    await expect(app.captionButton('On Away')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.wwiwiwh-drive-plaque')).toBeHidden();
    await expect(page.locator('.wwiwiwh-drive__start')).toBeVisible();
    await expect(page.locator('.wwiwiwh-drive__end')).toBeVisible();
    expect((await drawn(app)).away.route).toBeGreaterThan(0);
  });

  test('Cancel and Escape leave a drive that was being set, and the one on the map stays', async ({ app, page }) => {
    await app.press(app.tool('Drive'));
    await app.pressAt(await app.stageSpot(0.3, 0.3));
    expect((await app.state()).driveDraft).not.toBeNull();
    await app.press(app.captionButton('Cancel'));
    const state = await app.state();
    expect(state).toMatchObject({ mode: 'browse', driveDraft: null, drive: null });
    // Nothing was set, so the trip the place came with is still there.
    expect(state.trip).not.toBeNull();

    test.skip(app.touch, 'Escape is a key.');
    await page.keyboard.press('d');
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'false');
  });

  test('by keyboard: D, then Enter at the centre mark for the start and again for the end @desktop', async ({ app, page }) => {
    await page.keyboard.press('d');
    await expect(app.caption).toHaveText('Press Enter to set where the drive starts in San Jose, at the centre mark.');
    await expect(page.locator('.wwiwiwh-measure-center')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(app.caption).toHaveText('Move the map, then press Enter to set where the drive ends.');
    // Enter on the spot the start is on sets nothing.
    await page.keyboard.press('Enter');
    expect((await app.state()).drive).toBeNull();

    const before = (await app.state()).camera.center;
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => distanceMeters((await app.state()).camera.center, before)).toBeGreaterThan(1000);
    await app.drawn();
    await page.keyboard.press('Enter');
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'false');
    const drive = driveOf(await app.state());
    expect(distanceMeters(drive.from, drive.to)).toBeGreaterThan(1000);
    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, drive.from, drive.to)));
    // Back at the tool, ready to set another.
    await expect(app.tool('Drive')).toBeFocused();
  });
});

test.describe('a drive on the map', () => {
  test('comes back from its link, by name, and stays after a reload', async ({ app, roadService }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    const sentence = new RegExp(driveCaption(app, PALO_ALTO, SAN_JOSE, 'Palo Alto to San Jose') + reachCaption(app, 'long', 'London'));
    await expect(app.caption).toHaveText(sentence);
    await expectDrawn(app, 'home');
    expect(driveOf(await app.state())).toEqual({ on: 'home', from: PALO_ALTO, to: SAN_JOSE, fromName: 'Palo Alto', toName: 'San Jose', match: 'time' });
    expect(roadService.requests.map((request) => request.action)).toEqual(['route', 'isochrone']);

    await app.reload();
    await expect(app.caption).toHaveText(sentence);
    expect(await app.hash()).toBe(`#${PALO_ALTO_TO_SAN_JOSE}`);
  });

  test('"Same distance" shades how far the drive’s distance gets instead of its time', async ({ app, page, roadService }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    const { meters } = standInDrive(PALO_ALTO, SAN_JOSE);

    await app.press(app.captionButton('Same distance'));
    await expect(app.captionButton('Same distance')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.caption).toHaveText(new RegExp(reachCaption(app, 'far', 'London')));
    await expect(page).toHaveURL(/&same=distance$/);
    await expect.poll(() => reachesAsked(roadService.requests).length).toBe(2);
    expect(reachesAsked(roadService.requests)[1]?.contour).toEqual({ distance: Number((meters / 1000).toFixed(1)) });
    // The road itself is the same road: it is not asked for again.
    expect(routesAsked(roadService.requests)).toHaveLength(1);

    // Back to the time, which was asked before: nothing more is asked.
    await app.press(app.captionButton('Same distance'));
    await expect(app.caption).toHaveText(new RegExp(reachCaption(app, 'long', 'London')));
    await expect(page).not.toHaveURL(/same=/);
    expect(roadService.requests).toHaveLength(3);
  });

  test('the reach is worked out again from where the start lands once Home has been slid', async ({ app, page, roadService }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    const before = await app.state();

    await page.evaluate(() => window.__wwiwiwhWatch.app().controller.slideBy(120, -60));
    await expect.poll(() => reachesAsked(roadService.requests).length).toBe(2);
    const after = await app.state();
    const landsOn = overlayToBase(after.reg, PALO_ALTO);
    expect(distanceMeters(landsOn, overlayToBase(before.reg, PALO_ALTO))).toBeGreaterThan(1000);
    expect(distanceMeters(reachesAsked(roadService.requests)[1]?.locations[0] ?? SAN_JOSE, landsOn)).toBeLessThan(SAME_SPOT_METERS);
    await expectDrawn(app, 'home');
    // The road is Home's own and went with it: only the reach was asked for again.
    expect(routesAsked(roadService.requests)).toHaveLength(1);
  });

  test('a drive on Away has its reach on Home worked out again, and drawn again, once Home has been slid', async ({ app, page, roadService }) => {
    await app.open(`home=san-jose&away=london&drive=${KINGS_CROSS.lat.toFixed(5)},${KINGS_CROSS.lng.toFixed(5)}~${HEATHROW.lat.toFixed(5)},${HEATHROW.lng.toFixed(5)}&on=away`);
    await expectDrawn(app, 'away');
    const start = driveOf(await app.state()).from;
    const before = baseToOverlay((await app.state()).reg, start);

    await page.evaluate(() => window.__wwiwiwhWatch.app().controller.slideBy(-140, 80));
    // The old reach went along with Home, and no longer starts under the drive's start: it is taken down at once.
    expect((await app.state()).reach).toEqual({ status: 'finding' });
    await expect.poll(() => reachesAsked(roadService.requests).length).toBe(2);
    const startsFrom = baseToOverlay((await app.state()).reg, start);
    expect(distanceMeters(startsFrom, before)).toBeGreaterThan(1000);
    expect(distanceMeters(reachesAsked(roadService.requests)[1]?.locations[0] ?? SAN_JOSE, startsFrom)).toBeLessThan(SAME_SPOT_METERS);
    await expectDrawn(app, 'away');
    expect(routesAsked(roadService.requests)).toHaveLength(1);
  });

  test('the shaded area reaches as far as the road service says, about the spot the start lands on', async ({ app, page }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    const state = await app.state();
    const { seconds } = standInDrive(PALO_ALTO, SAN_JOSE);
    const reaches = standInReachMeters({ time: Number((seconds / 60).toFixed(1)) });
    const start = overlayToBase(state.reg, PALO_ALTO);
    const outline = state.reach?.status === 'found' ? (state.reach.outline[0]?.[0] ?? []) : [];
    expect(outline.length).toBeGreaterThan(10);
    for (const corner of outline) expect(Math.abs(distanceMeters(start, corner) / reaches - 1)).toBeLessThan(0.01);
    // And the start's ring is drawn over that very spot.
    const ring = await page.locator('.wwiwiwh-drive__start').evaluate((circle) => ({ x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }));
    expectPointNear(ring, await page.evaluate((at) => window.__wwiwiwhWatch.app().dual.projectAway(at), start));
  });

  test('two rings about the start: one through the end, one as far out as the drive is long by road', async ({ app, page }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    const straight = distanceMeters(PALO_ALTO, SAN_JOSE);
    const { meters: byRoad } = standInDrive(PALO_ALTO, SAN_JOSE);
    await expect(ringLabel(app, 'straight')).toHaveText(`${formatDistance(straight, 'mi')} straight`);
    await expect(ringLabel(app, 'road')).toHaveText(`${formatDistance(byRoad, 'mi')} by road`);

    /**
     * Both rings as drawn, checked against where the two ends are: every point of the straight one is
     * as far from the start as the end is, and the road's is larger by as much as the road is longer.
     */
    const expectRings = async (): Promise<Record<RingKind, { start: ScreenPoint; radius: number; points: ScreenPoint[] }>> => {
      const { start, end } = await page.evaluate(
        ({ from, to }) => {
          const { dual } = window.__wwiwiwhWatch.app();
          return { start: dual.projectHome(from), end: dual.projectHome(to) };
        },
        { from: PALO_ALTO, to: SAN_JOSE },
      );
      const across = Math.hypot(end.x - start.x, end.y - start.y);
      const rings = { straight: await ringDrawn(app, 'straight'), road: await ringDrawn(app, 'road') };
      if (!rings.straight || !rings.road) throw new Error('A ring is not showing.');
      // Zoomed in, the ends are tens of thousands of pixels apart: a pixel of slack in a thousand.
      const slack = 0.5 + across / 1000;
      expect(Math.abs(rings.straight.radius - across)).toBeLessThan(slack);
      expect(Math.abs(rings.road.radius - (across * byRoad) / straight)).toBeLessThan(slack);
      for (const ring of [rings.straight, rings.road]) {
        expect(ring.points.length).toBeGreaterThanOrEqual(3);
        for (const point of ring.points) expect(Math.abs(Math.hypot(point.x - start.x, point.y - start.y) - ring.radius)).toBeLessThan(0.5);
      }
      return { straight: { start, ...rings.straight }, road: { start, ...rings.road } };
    };
    /** The middle of a ring's label lies on that ring. */
    const expectLabelOnRing = async (kind: RingKind, { start, radius }: { start: ScreenPoint; radius: number }): Promise<void> => {
      const box = await ringLabel(app, kind).boundingBox();
      if (!box) throw new Error(`The label of the ${kind} ring is not showing.`);
      const startOnPage = await app.onPage(start);
      expect(Math.abs(Math.hypot(box.x + box.width / 2 - startOnPage.x, box.y + box.height / 2 - startOnPage.y) - radius)).toBeLessThan(1.5);
    };

    const whole = await expectRings();
    await expectLabelOnRing('straight', whole.straight);

    // Close in on a spot of the straight ring, where the whole of it is hundreds of stages round: only the stretch in sight is drawn.
    await page.evaluate(
      ({ start, radius }) => {
        const { dual } = window.__wwiwiwhWatch.app();
        dual.setView({ center: dual.unprojectAway({ x: start.x + radius * Math.SQRT1_2, y: start.y + radius * Math.SQRT1_2 }), zoom: 16 }, { animate: false });
      },
      { start: whole.straight.start, radius: whole.straight.radius },
    );
    await app.atRest();
    const { stage } = await app.state();
    // The road's ring is thousands of pixels further out here, and nothing of it is drawn.
    expect(await ringDrawn(app, 'road')).toBeNull();
    await expect(ringLabel(app, 'road')).toBeHidden();
    const close = await ringDrawn(app, 'straight');
    if (!close) throw new Error('The straight ring is not showing.');
    expect(close.radius).toBeGreaterThan(5 * stage.width);
    for (const point of close.points) {
      expect(point.x).toBeGreaterThan(-40);
      expect(point.x).toBeLessThan(stage.width + 40);
      expect(point.y).toBeGreaterThan(-40);
      expect(point.y).toBeLessThan(stage.height + 40);
    }
    const startNow = await page.evaluate((from) => window.__wwiwiwhWatch.app().dual.projectHome(from), PALO_ALTO);
    for (const point of close.points) expect(Math.abs(Math.hypot(point.x - startNow.x, point.y - startNow.y) - close.radius)).toBeLessThan(0.5);
    await expectLabelOnRing('straight', { start: startNow, radius: close.radius });

    // Back out to where both show.
    await page.evaluate(() => {
      const { dual } = window.__wwiwiwhWatch.app();
      dual.setView({ ...dual.getView(), zoom: 8 }, { animate: false });
    });
    await app.atRest();
    const far = await expectRings();
    await expectLabelOnRing('straight', far.straight);
    await expectLabelOnRing('road', far.road);
    // The two labels do not lie on each other.
    const [one, other] = [await ringLabel(app, 'straight').boundingBox(), await ringLabel(app, 'road').boundingBox()];
    if (!one || !other) throw new Error('A label is not showing.');
    expect(one.x + one.width <= other.x || other.x + other.width <= one.x || one.y + one.height <= other.y || other.y + other.height <= one.y).toBe(true);

    // They are the drive's, not the pin's rings: switching those off leaves them.
    await app.press(app.tool('Rings'));
    await expect(app.ringLabels.first()).toBeHidden();
    await expectRings();
    await expect(ringLabel(app, 'straight')).toBeVisible();

    // They are put away with the drive's figures while another drive is being set, and come back with them.
    await app.press(app.tool('Drive'));
    await expect(ringLabel(app, 'straight')).toBeHidden();
    await expect(ringLabel(app, 'road')).toBeHidden();
    expect(await ringDrawn(app, 'straight')).toBeNull();
    expect(await ringDrawn(app, 'road')).toBeNull();
    await app.press(app.captionButton('Cancel'));
    await expectRings();
  });

  test('the rings of a drive on Away are drawn about its start on Away', async ({ app, page }) => {
    await app.open(`home=san-jose&away=london&drive=51.5308,-0.1238~51.47,-0.4543&on=away`);
    await expectDrawn(app, 'away');
    const from = { lat: 51.5308, lng: -0.1238 };
    const to = { lat: 51.47, lng: -0.4543 };
    const straight = distanceMeters(from, to);
    const { meters: byRoad } = standInDrive(from, to);
    const { start, end } = await page.evaluate(
      (ends) => {
        const { dual } = window.__wwiwiwhWatch.app();
        return { start: dual.projectAway(ends.from), end: dual.projectAway(ends.to) };
      },
      { from, to },
    );
    const across = Math.hypot(end.x - start.x, end.y - start.y);
    const rings = { straight: await ringDrawn(app, 'straight'), road: await ringDrawn(app, 'road') };
    if (!rings.straight || !rings.road) throw new Error('A ring is not showing.');
    expect(Math.abs(rings.straight.radius - across)).toBeLessThan(0.5);
    expect(Math.abs(rings.road.radius - (across * byRoad) / straight)).toBeLessThan(0.5);
    for (const ring of [rings.straight, rings.road]) {
      for (const point of ring.points) expect(Math.abs(Math.hypot(point.x - start.x, point.y - start.y) - ring.radius)).toBeLessThan(0.5);
    }
    await expect(ringLabel(app, 'straight')).toHaveText(`${formatDistance(straight, 'mi')} straight`);
    await expect(ringLabel(app, 'road')).toHaveText(`${formatDistance(byRoad, 'mi')} by road`);
  });

  test('the road and the reach stay drawn when the maps are restyled: another theme, and Home far up north', async ({ app, page, roadService }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');

    await page.evaluate(() => window.__wwiwiwhWatch.app().controller.setThemeChoice('dark'));
    await app.drawn();
    await expectDrawn(app, 'home');

    // Home put on a spot far to the north runs at another zoom, and is restyled for it.
    await page.evaluate(() => {
      const { controller, dual } = window.__wwiwiwhWatch.app();
      controller.pinSpot('away', { name: null, position: { lat: 64.1466, lng: -21.9426 } });
      dual.setView({ center: { lat: 64.1466, lng: -21.9426 }, zoom: 9 }, { animate: false });
    });
    await expect.poll(() => reachesAsked(roadService.requests).length).toBe(2);
    await app.atRest();
    await expectDrawn(app, 'home');
    expect(routesAsked(roadService.requests)).toHaveLength(1);
  });

  test('Swap leaves the drive on its own roads and asks nothing again', async ({ app, roadService }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    await app.press(app.swapButton);
    await app.drawn();
    expect(driveOf(await app.state())).toMatchObject({ on: 'away', from: PALO_ALTO, to: SAN_JOSE });
    await expectDrawn(app, 'away');
    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, PALO_ALTO, SAN_JOSE, 'Palo Alto to San Jose') + reachCaption(app, 'long', 'London')));
    expect(roadService.requests).toHaveLength(2);
    expect(await app.hash()).toContain('&on=away');
  });

  test('"Clear drive" takes it off both maps and out of the address', async ({ app, page }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    await app.press(app.captionButton('Clear drive'));
    await expect(page.locator('.wwiwiwh-drive-plaque')).toBeHidden();
    await expect(ringLabel(app, 'straight')).toBeHidden();
    await expect(ringLabel(app, 'road')).toBeHidden();
    expect(await ringDrawn(app, 'straight')).toBeNull();
    expect(await ringDrawn(app, 'road')).toBeNull();
    await expect(page).not.toHaveURL(/drive=/);
    expect(await app.state()).toMatchObject({ drive: null, route: null, reach: null });
    await expect.poll(async () => drawn(app)).toEqual({ home: { route: 0, reach: 0 }, away: { route: 0, reach: 0 } });
  });

  test('"By road" turns the trip into a drive between the same two ends', async ({ app }) => {
    await app.open();
    const { trip } = await app.state();
    await app.press(app.captionButton('By road'));
    const state = await app.state();
    expect(state.trip).toBeNull();
    expect(driveOf(state)).toEqual({ on: 'home', from: trip?.from, to: trip?.to, fromName: 'Palo Alto', toName: 'San Jose', match: 'time' });
    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, driveOf(state).from, driveOf(state).to, 'Palo Alto to San Jose')));
    await expectDrawn(app, 'home');
  });

  test('measuring a line afterwards takes the drive off the map', async ({ app }) => {
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expectDrawn(app, 'home');
    await app.press(app.tool('Measure'));
    await app.pressAt(await app.stageSpot(0.3, 0.3));
    await app.pressAt(await app.stageSpot(0.65, 0.55));
    await expect(app.tool('Measure')).toHaveAttribute('aria-pressed', 'false');
    const state = await app.state();
    expect(state.drive).toBeNull();
    expect(state.trip).not.toBeNull();
    await expect(app.caption).toHaveText(/in a straight line\.$/);
  });
});

test.describe('a drive by address', () => {
  test('the start is looked for in both places, and the end in the place the start was found in', async ({ app, page }) => {
    await app.open('home=san-jose&away=london&trip=none');
    await app.press(app.tool('Drive'));
    await app.press(app.captionButton('To an address'));
    await expect(app.pickerHeading).toHaveText('Drive from where?');
    await expect(app.pickerLine).toHaveText('An address or landmark in San Jose or in London: the drive is on that place’s roads.');
    await app.picker.getByRole('combobox').fill('kings cross station');
    await app.press(app.pickerOption("London King's Cross Railway Station", 'In London'));

    // The picker for the end follows at once, for London alone.
    await expect(app.pickerHeading).toHaveText('Drive to where in London?');
    await expect(app.pickerLine).toHaveText("From London King's Cross Railway Station, by road.");
    expect(await app.state()).toMatchObject({ mode: 'drive', driveSide: 'away', driveDraft: { name: "London King's Cross Railway Station" } });
    await app.searchAndPick('heathrow', 'Heathrow Airport');

    await expect(app.picker).toHaveCount(0);
    await expect(app.tool('Drive')).toHaveAttribute('aria-pressed', 'false');
    await app.drawn();
    const drive = driveOf(await app.state());
    expect(drive).toMatchObject({ on: 'away', fromName: "London King's Cross Railway Station", toName: 'Heathrow Airport', match: 'time' });
    expect(distanceMeters(drive.from, KINGS_CROSS)).toBeLessThan(SAME_SPOT_METERS);
    expect(distanceMeters(drive.to, HEATHROW)).toBeLessThan(SAME_SPOT_METERS);
    const ends = "London King's Cross Railway Station to Heathrow Airport";
    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, drive.from, drive.to, ends) + reachCaption(app, 'long', 'San Jose')));
    await expectDrawn(app, 'away');
    await expect(page).toHaveURL(/&on=away&df=London\+King's\+Cross\+Railway\+Station&dt=Heathrow\+Airport/);
  });

  test('closing the picker for the end keeps the start, and the map can finish the drive', async ({ app }) => {
    await app.open('home=san-jose&away=london&trip=none');
    await app.press(app.tool('Drive'));
    await app.press(app.captionButton('To an address'));
    await app.searchAndPick('heathrow', 'Heathrow Airport');
    await expect(app.pickerHeading).toHaveText('Drive to where in London?');
    // The spot the drive starts from is not offered as its end.
    await app.picker.getByRole('combobox').fill('heathrow');
    await expect(app.picker.locator('.picker__status, .picker__option').first()).toBeVisible();
    await expect(app.pickerOption('Heathrow Airport')).toHaveCount(0);
    await app.closePicker();
    await expect(app.picker).toHaveCount(0);

    // Escape closed the picker on a wide screen, so there the caption goes on in terms of the keyboard.
    await expect(app.caption).toHaveText(app.touch ? 'Now tap where it ends in London.' : 'Move the map, then press Enter to set where the drive ends.');
    await app.drawn();
    await app.pressAt(await app.stageSpot(0.5, 0.3));
    const drive = driveOf(await app.state());
    expect(drive).toMatchObject({ on: 'away', fromName: 'Heathrow Airport' });
    expect(drive.toName).toBeUndefined();
  });
});

test.describe('when the road service cannot help', () => {
  test('out of reach: the caption says so, and "Try again" asks again', async ({ app, roadService, consoleWatch }) => {
    consoleWatch.allow(/Failed to load resource: net::ERR_CONNECTION_REFUSED/);
    roadService.down = true;
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expect(app.caption).toHaveText("Directions aren't answering right now. Try again.");
    // It is left alone until the person asks.
    expect(roadService.requests).toHaveLength(1);
    expect(await drawn(app)).toEqual({ home: { route: 0, reach: 0 }, away: { route: 0, reach: 0 } });
    // The ring through the end is a straight-line measurement and asks no one: it is there all the same. The road's waits for the road.
    await expect(ringLabel(app, 'straight')).toHaveText(`${formatDistance(distanceMeters(PALO_ALTO, SAN_JOSE), 'mi')} straight`);
    expect(await ringDrawn(app, 'straight')).not.toBeNull();
    expect(await ringDrawn(app, 'road')).toBeNull();
    await expect(ringLabel(app, 'road')).toBeHidden();

    roadService.down = false;
    await app.press(app.captionButton('Try again'));
    await expect(app.caption).toHaveText(new RegExp(driveCaption(app, PALO_ALTO, SAN_JOSE, 'Palo Alto to San Jose') + reachCaption(app, 'long', 'London')));
    await expect(app.captionButton('Try again')).toBeHidden();
    await expectDrawn(app, 'home');
  });

  test('no way by road: the caption says so, and there is nothing to try again', async ({ app, roadService, consoleWatch }) => {
    consoleWatch.allow(/Failed to load resource: the server responded with a status of 400/);
    roadService.noRoad = true;
    await app.open(PALO_ALTO_TO_SAN_JOSE);
    await expect(app.caption).toHaveText('No road joins Palo Alto and San Jose.');
    await expect(app.captionButton('Try again')).toBeHidden();
    await expect(app.captionButton('Same distance')).toBeHidden();
    await expect(app.captionButton('Clear drive')).toBeVisible();
    expect(roadService.requests.map((request) => request.action)).toEqual(['route']);
  });
});
