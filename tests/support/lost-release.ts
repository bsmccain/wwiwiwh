import type { BrowserContext, Page } from '@playwright/test';
import type { ScreenPoint } from '../../src/map/contracts';

/**
 * Releases that never reach the app. A menu, another window or a part of the system can take the
 * release of a mouse button or the lift of a finger, and the page then never hears of it. The tests
 * bring that about in two ways: by stopping the events of a release before any listener of the app
 * hears them, and by reporting a mouse with no button down that was never let go.
 */

/** What a browser fires when a pointer is let go: the release itself, then the end of the capture it held. */
export type ReleaseEvent = 'pointerup' | 'lostpointercapture';

declare global {
  interface Window {
    /** Put there by `watchForReleasesToLose`: the events of a release still to be stopped, each once. */
    __releasesToLose: Set<ReleaseEvent>;
  }
}

/**
 * Runs in the page before the app does, so that these listeners come before every one of the app's
 * own, its listeners on the window included: an event stopped here is heard by nothing in the app.
 */
function watchForReleasesToLose(): void {
  const toLose = new Set<ReleaseEvent>();
  window.__releasesToLose = toLose;
  for (const type of ['pointerup', 'lostpointercapture'] as const) {
    window.addEventListener(
      type,
      (event) => {
        if (toLose.delete(type)) event.stopImmediatePropagation();
      },
      true,
    );
  }
}

/** Makes the pages the context opens from now on able to lose a release (see `loseNext`). */
export async function letReleasesBeLostIn(context: BrowserContext): Promise<void> {
  await context.addInitScript(watchForReleasesToLose);
}

/** The next of each of these events is stopped before the app hears it. Only the next: the one after arrives. */
export async function loseNext(page: Page, ...events: ReleaseEvent[]): Promise<void> {
  await page.evaluate((types) => {
    for (const type of types) window.__releasesToLose.add(type);
  }, events);
}

/** The events that `loseNext` was asked to stop and that have not come by yet. */
export async function releasesStillToLose(page: Page): Promise<ReleaseEvent[]> {
  return page.evaluate(() => [...window.__releasesToLose]);
}

/**
 * Moves the mouse and reports no button down, though the button that was pressed has not been let
 * go: what a page sees first after a release it never heard of. The browser goes on believing the
 * button is down, and so does Playwright, until `page.mouse.up()` is called.
 */
export async function moveMouseWithNoButtonDown(page: Page, to: ScreenPoint): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'none', buttons: 0 });
  await session.detach();
}
