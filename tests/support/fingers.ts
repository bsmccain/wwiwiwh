import type { CDPSession, Page } from '@playwright/test';
import type { ScreenPoint } from '../../src/map/contracts';
import { REST_BEFORE_RELEASE_MS } from './pointer';

/**
 * Fingers on the screen, sent to the browser as touch input through the DevTools protocol.
 * Playwright's own touchscreen can only tap; presses that last and drags need this. The browser
 * treats these touches as it does real ones, scroll and `touch-action` handling included.
 */
export class Fingers {
  private session: CDPSession | null = null;

  constructor(private readonly page: Page) {}

  /** Puts fingers down, one at each point (page coordinates). */
  async down(...points: ScreenPoint[]): Promise<void> {
    await this.send('touchStart', points);
  }

  /** Moves the fingers that are down to these points, in the order they went down. */
  async moveTo(...points: ScreenPoint[]): Promise<void> {
    await this.send('touchMove', points);
  }

  async lift(): Promise<void> {
    await this.send('touchEnd', []);
  }

  /** Lifts fingers that have been held still for a moment, so that maps they moved stay where they are left. */
  async liftAtRest(): Promise<void> {
    await this.page.waitForTimeout(REST_BEFORE_RELEASE_MS);
    await this.lift();
  }

  /** One finger pressed at `from`, dragged in a straight line to `to`, and lifted there. */
  async drag(from: ScreenPoint, to: ScreenPoint, steps = 8): Promise<void> {
    await this.dragAndHold(from, to, steps);
    await this.lift();
  }

  /** The same drag, with the finger left down where it ends. */
  async dragAndHold(from: ScreenPoint, to: ScreenPoint, steps = 8): Promise<void> {
    await this.down(from);
    for (let step = 1; step <= steps; step++) {
      const share = step / steps;
      await this.moveTo({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share });
    }
  }

  /** The same drag, lifted at rest. */
  async dragToRest(from: ScreenPoint, to: ScreenPoint, steps = 8): Promise<void> {
    await this.dragAndHold(from, to, steps);
    await this.liftAtRest();
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly ScreenPoint[]): Promise<void> {
    this.session ??= await this.page.context().newCDPSession(this.page);
    await this.session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(({ x, y }, id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
    });
  }
}
