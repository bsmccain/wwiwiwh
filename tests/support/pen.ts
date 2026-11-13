import type { CDPSession, Page } from '@playwright/test';
import type { ScreenPoint } from '../../src/map/contracts';

/**
 * A pen, sent to the browser through the DevTools protocol (Playwright has none of its own). Unlike
 * a finger it is seen while it is in the air: there it moves with no button down, as a mouse does.
 */
export class Pen {
  private session: CDPSession | null = null;
  private at: ScreenPoint = { x: 0, y: 0 };
  private touching = false;

  constructor(private readonly page: Page) {}

  /** Moves in a straight line to a point of the page: in the air, or on the screen while its tip is down. */
  async moveTo(to: ScreenPoint, steps = 1): Promise<void> {
    const from = this.at;
    for (let step = 1; step <= steps; step++) {
      const share = step / steps;
      this.at = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
      await this.send('mouseMoved');
    }
  }

  /** Puts the tip down where the pen is. */
  async down(): Promise<void> {
    this.touching = true;
    await this.send('mousePressed');
  }

  async lift(): Promise<void> {
    this.touching = false;
    await this.send('mouseReleased');
  }

  private async send(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased'): Promise<void> {
    this.session ??= await this.page.context().newCDPSession(this.page);
    // A press and its release name the button that changed; a move names the one that is held.
    const tip = type !== 'mouseMoved' || this.touching;
    await this.session.send('Input.dispatchMouseEvent', {
      type,
      x: this.at.x,
      y: this.at.y,
      pointerType: 'pen',
      button: tip ? 'left' : 'none',
      buttons: this.touching ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  }
}
