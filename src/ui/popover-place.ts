/** Where a menu's popover goes when it opens beside what it belongs to. Plain geometry in CSS pixels of the viewport, so it can be tested without a page. */

const GAP = 8;
const SCREEN_MARGIN = 12;

export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface BesidePlacement {
  readonly left: number;
  readonly top: number;
  /** The tallest the popover may be and still clear the screen's edges. */
  readonly maxHeight: number;
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest));
}

/**
 * A popover beside its anchor, rising from the anchor's foot: to the right where there is room, else
 * to the left. With room on neither side it goes above the anchor, or below it when there is no
 * room above either. It never covers the anchor unless the screen leaves it no choice, and never
 * reaches past the screen's edges.
 */
export function placeBeside(anchor: Edges, panel: Size, screen: Size): BesidePlacement {
  const maxHeight = Math.max(0, screen.height - 2 * SCREEN_MARGIN);
  const height = Math.min(panel.height, maxHeight);
  const onScreen = (top: number): number => clamp(top, SCREEN_MARGIN, screen.height - SCREEN_MARGIN - height);

  const toTheRight = anchor.right + GAP;
  if (toTheRight + panel.width <= screen.width - SCREEN_MARGIN) return { left: toTheRight, top: onScreen(anchor.bottom - height), maxHeight };
  const toTheLeft = anchor.left - GAP - panel.width;
  if (toTheLeft >= SCREEN_MARGIN) return { left: toTheLeft, top: onScreen(anchor.bottom - height), maxHeight };

  const centred = (anchor.left + anchor.right - panel.width) / 2;
  const left = clamp(centred, SCREEN_MARGIN, Math.max(SCREEN_MARGIN, screen.width - SCREEN_MARGIN - panel.width));
  const above = anchor.top - GAP - height;
  return { left, top: above >= SCREEN_MARGIN ? above : onScreen(anchor.bottom + GAP), maxHeight };
}
