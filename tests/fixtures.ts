import { test as base, expect } from '@playwright/test';
import { WwiwiwhApp, watchAppIn } from './support/app';
import { watchConsole, type ConsoleWatch } from './support/console-watch';
import { Fingers } from './support/fingers';
import { stubMapService, type MapService } from './support/map-service';
import { stubPlaceSearch, type PlaceSearch } from './support/place-search';
import { stubRoadService, type RoadService } from './support/road-service';

interface Fixtures {
  /** The stand-in for the public tile service. Every test gets it, asked for or not. */
  mapService: MapService;
  /** The stand-in for the public search for places and for spots in them. Every test gets it, asked for or not. */
  placeSearch: PlaceSearch;
  /** The stand-in for the public routing server, which a drive is asked of. Every test gets it, asked for or not. */
  roadService: RoadService;
  /** Fails the test if a page logs an error or a warning that the test did not allow. */
  consoleWatch: ConsoleWatch;
  /** The app in the test's page. */
  app: WwiwiwhApp;
  /** Touch input that lasts: holds and drags. */
  fingers: Fingers;
}

export const test = base.extend<Fixtures>({
  mapService: [
    async ({ context }, use) => {
      await use(await stubMapService(context));
    },
    { auto: true },
  ],

  placeSearch: [
    async ({ context }, use) => {
      await use(await stubPlaceSearch(context));
    },
    { auto: true },
  ],

  roadService: [
    async ({ context }, use) => {
      await use(await stubRoadService(context));
    },
    { auto: true },
  ],

  consoleWatch: [
    async ({ context }, use) => {
      const watch = watchConsole(context);
      await use(watch);
      expect(watch.problems(), 'errors and warnings in the console').toEqual([]);
    },
    { auto: true },
  ],

  app: async ({ context, page, hasTouch }, use) => {
    await watchAppIn(context);
    await use(new WwiwiwhApp(page, hasTouch));
  },

  fingers: async ({ page }, use) => {
    await use(new Fingers(page));
  },
});

export { expect };
