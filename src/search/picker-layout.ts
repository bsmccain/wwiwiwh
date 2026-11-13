/** Where the picker's panel goes. Plain geometry in CSS pixels of the layout viewport, so it can be tested without a page. */

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT = 560;
/** With less room than this above the anchor's edge, the popover drops beneath it instead. */
const POPOVER_MIN_HEIGHT = 280;
const POPOVER_GAP = 8;
const SCREEN_MARGIN = 12;
const SHEET_SHARE_OF_HEIGHT = 0.85;
/** A page zoomed in by more than this is being looked at closely, not covered by a keyboard. */
const PINCH_ZOOMED = 1.01;

/** The stretch of the layout viewport, top to bottom, that can be seen. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/** The part of `window.visualViewport` that the layout needs. */
export interface VisualViewportReading {
  readonly offsetTop: number;
  readonly height: number;
  readonly scale: number;
}

/**
 * The on-screen keyboard shrinks the visual viewport but not the layout viewport that fixed elements
 * are placed in. This is what is left to see, in layout coordinates.
 */
export function visibleBand(layoutHeight: number, visual: VisualViewportReading | null): Band {
  // Pinch-zooming the page shrinks the visual viewport too, and then the panel should stay put.
  if (!visual || visual.scale > PINCH_ZOOMED) return { top: 0, bottom: layoutHeight };
  const top = Math.min(Math.max(0, visual.offsetTop), layoutHeight);
  return { top, bottom: Math.min(Math.max(top, top + visual.height), layoutHeight) };
}

export interface SheetFit {
  /** How far the sheet's bottom edge is raised to clear the keyboard. */
  readonly lift: number;
  readonly height: number;
}

export function fitSheet(layoutHeight: number, band: Band): SheetFit {
  return {
    lift: Math.max(0, layoutHeight - band.bottom),
    height: Math.max(0, Math.min(layoutHeight * SHEET_SHARE_OF_HEIGHT, band.bottom - band.top - SCREEN_MARGIN)),
  };
}

export interface PopoverSpace {
  /** The left edge of the control the popover belongs to. */
  readonly anchorLeft: number;
  /**
   * Set for a control that stands on its own above the page's margin (the pin on the map), and is no
   * part of that margin: the popover may then stand beside it.
   */
  readonly alone?: {
    readonly anchorRight: number;
    /** Where the margin begins beneath the control: a popover beside the control keeps above it. Null on a page without one. */
    readonly marginTop: number | null;
  };
  /** Top and bottom of what the popover must not cover: the anchor, or the collar it sits in. */
  readonly edgeTop: number;
  readonly edgeBottom: number;
  readonly screenWidth: number;
  readonly band: Band;
}

export interface PopoverBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The popover rises above its control's edge, lined up with the control, or drops beneath the edge
 * where there is too little room above. Around a control that stands on its own it keeps clear of
 * the page's margin, and beside such a control there is room from the top of the screen down to that
 * margin: where that makes the popover taller it stands there instead, to the right of the control
 * where it fits, else to the left.
 */
export function placePopover(space: PopoverSpace): PopoverBox {
  const { anchorLeft, alone, edgeTop, edgeBottom, screenWidth, band } = space;
  const width = Math.min(POPOVER_WIDTH, screenWidth - 2 * SCREEN_MARGIN);
  const ceiling = band.top + SCREEN_MARGIN;
  const marginTop = alone?.marginTop ?? null;
  const floor = Math.min(band.bottom - SCREEN_MARGIN, marginTop === null ? Infinity : marginTop - POPOVER_GAP);
  // With a keyboard over the anchor, "above it" means above the keyboard.
  const restingOn = Math.min(edgeTop - POPOVER_GAP, floor);
  const hangingFrom = Math.max(edgeBottom + POPOVER_GAP, ceiling);
  const roomAbove = restingOn - ceiling;
  const roomBelow = floor - hangingFrom;
  const above = roomAbove >= POPOVER_MIN_HEIGHT || roomAbove >= roomBelow;
  const height = Math.max(0, Math.min(POPOVER_HEIGHT, above ? roomAbove : roomBelow));

  if (alone) {
    const besideHeight = Math.min(POPOVER_HEIGHT, floor - ceiling);
    const toTheRight = alone.anchorRight + POPOVER_GAP;
    const toTheLeft = anchorLeft - POPOVER_GAP - width;
    const fitsRight = toTheRight + width <= screenWidth - SCREEN_MARGIN;
    if (besideHeight > height && (fitsRight || toTheLeft >= SCREEN_MARGIN)) {
      // From the control's foot upwards, as far as the screen allows.
      const top = Math.max(ceiling, Math.min(edgeBottom, floor) - besideHeight);
      return { left: fitsRight ? toTheRight : toTheLeft, width, height: besideHeight, top };
    }
  }

  const left = Math.max(SCREEN_MARGIN, Math.min(anchorLeft, screenWidth - width - SCREEN_MARGIN));
  return { left, width, height, top: above ? restingOn - height : hangingFrom };
}
