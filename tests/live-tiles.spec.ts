import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * How many different colours a sheet's canvas holds, sampled on a grid. Read inside the map's own
 * render call, the one moment a WebGL canvas can be read back without being told to keep its picture.
 */
function coloursDrawn(page: Page, sheet: 'base' | 'overlay'): Promise<number> {
  return page.evaluate(
    (which) =>
      new Promise<number>((resolve) => {
        const map = window.__mapzWatch.app().dual[which];
        map.once('render', () => {
          const gl = map.getCanvas().getContext('webgl2');
          if (!gl) return resolve(0);
          const colours = new Set<string>();
          const pixel = new Uint8Array(4);
          const steps = 40;
          for (let across = 0; across < steps; across++) {
            for (let down = 0; down < steps; down++) {
              const x = Math.floor(((across + 0.5) * gl.drawingBufferWidth) / steps);
              const y = Math.floor(((down + 0.5) * gl.drawingBufferHeight) / steps);
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              colours.add(pixel.join(','));
            }
          }
          resolve(colours.size);
        });
        map.triggerRepaint();
      }),
    sheet,
  );
}

test.describe('with the public tile service', { tag: ['@live', '@desktop'] }, () => {
  test.skip(!process.env.MAPZ_LIVE, 'Loads real tiles from the public service. Run it with: npm run test:e2e:live');

  test('both sheets are drawn and place names appear on them', async ({ app, mapService, page }) => {
    await mapService.stepAside();
    await app.open();

    // An empty sheet is one flat colour. Streets, water and parks make many.
    expect(await coloursDrawn(page, 'base')).toBeGreaterThan(4);
    expect(await coloursDrawn(page, 'overlay')).toBeGreaterThan(2);

    const names = page.locator('.mapz-name--on');
    await expect(names.first()).toBeVisible();
    expect(await names.count()).toBeGreaterThan(5);
    // With names to go by, the trip is described on Away too.
    await expect(app.caption).toContainText(/Laid on London, that runs from .+ to central London\./);
  });
});
