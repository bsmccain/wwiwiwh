import { describe, expect, it } from 'vitest';
import { screenAngle } from '../geo/angles';
import type { ScreenPoint } from '../map/contracts';
import {
  arrowNudge,
  boxAround,
  clipToStage,
  distanceBetween,
  edgeChipSpot,
  plaqueCenter,
  plaqueFits,
  pointAtAngle,
  ringLabelSpot,
  rotatedBoxBounds,
  stepTurn,
  turnWhileDragging,
  uprightAngle,
} from './geometry';

const STAGE = { width: 1440, height: 808 };
const CENTER: ScreenPoint = { x: 720, y: 404 };

function expectPoint(actual: ScreenPoint | null, expected: ScreenPoint, digits = 6): void {
  expect(actual).not.toBeNull();
  expect(actual?.x).toBeCloseTo(expected.x, digits);
  expect(actual?.y).toBeCloseTo(expected.y, digits);
}

describe('pointAtAngle', () => {
  it('measures clockwise from straight up, like Home’s rotation', () => {
    expectPoint(pointAtAngle(CENTER, 44, 0), { x: 720, y: 360 });
    expectPoint(pointAtAngle(CENTER, 44, 90), { x: 764, y: 404 });
    expectPoint(pointAtAngle(CENTER, 44, 180), { x: 720, y: 448 });
    expectPoint(pointAtAngle(CENTER, 44, -90), { x: 676, y: 404 });
  });

  it('sweeps the way a pointer dragged round the pin is measured', () => {
    // The knob sits at the rotation; a drag reads screen angles. They must turn the same way at the same rate.
    for (const degrees of [-135, -28, 28, 90, 141.5]) {
      const swept = screenAngle(CENTER, pointAtAngle(CENTER, 44, degrees)) - screenAngle(CENTER, pointAtAngle(CENTER, 44, 0));
      expect(turnWhileDragging(0, 0, swept)).toBeCloseTo(degrees, 9);
    }
  });
});

describe('turnWhileDragging', () => {
  it('turns Home by as much as the pointer has swept round the pin', () => {
    expect(turnWhileDragging(0, 0, 28)).toBeCloseTo(28, 9);
    expect(turnWhileDragging(28, 28, 40)).toBeCloseTo(40, 9);
    expect(turnWhileDragging(-100, 170, -170)).toBeCloseTo(-80, 9);
  });

  it('does not jump when the knob is grabbed off its centre', () => {
    // Grabbed 9 degrees round from where the knob sits: the first move changes nothing.
    expect(turnWhileDragging(28, 37, 37)).toBeCloseTo(28, 9);
    expect(turnWhileDragging(28, 37, 47)).toBeCloseTo(38, 9);
  });

  it('squares up within 2 degrees of a quarter turn and nowhere else', () => {
    expect(turnWhileDragging(0, 0, 1.9)).toBe(0);
    expect(turnWhileDragging(0, 0, -2)).toBe(0);
    expect(turnWhileDragging(0, 0, 2.1)).toBeCloseTo(2.1, 9);
    expect(turnWhileDragging(0, 0, 88.5)).toBe(90);
    expect(turnWhileDragging(0, 0, 91.5)).toBe(90);
    expect(turnWhileDragging(0, 0, -91)).toBe(-90);
    expect(turnWhileDragging(0, 0, 179)).toBe(180);
    expect(turnWhileDragging(0, 0, -179)).toBe(180);
    expect(turnWhileDragging(0, 0, 45)).toBeCloseTo(45, 9);
  });

  it('keeps the turn within (-180, 180] across the wrap', () => {
    expect(turnWhileDragging(170, 0, 30)).toBeCloseTo(-160, 9);
    expect(turnWhileDragging(-170, 0, -30)).toBeCloseTo(160, 9);
  });
});

describe('stepTurn', () => {
  it('steps by whole degrees', () => {
    expect(stepTurn(28, 1)).toBe(29);
    expect(stepTurn(28, -1)).toBe(27);
    expect(stepTurn(0, 15)).toBe(15);
    expect(stepTurn(0, -15)).toBe(-15);
  });

  it('lands on whole degrees after a drag left a fraction', () => {
    expect(stepTurn(27.6, 1)).toBe(28);
    expect(stepTurn(27.6, -1)).toBe(27);
    expect(stepTurn(-27.6, 1)).toBe(-27);
    expect(stepTurn(-27.6, -1)).toBe(-28);
    expect(stepTurn(27.6, 15)).toBe(42);
  });

  it('wraps past a half turn', () => {
    expect(stepTurn(180, 1)).toBe(-179);
    expect(stepTurn(179, 1)).toBe(180);
    expect(stepTurn(-179, -1)).toBe(180);
    expect(stepTurn(170, 15)).toBe(-175);
  });
});

describe('arrowNudge', () => {
  it('moves 16 px, 2 px with Alt and 64 px with Shift', () => {
    expect(arrowNudge({ key: 'ArrowLeft', altKey: false, shiftKey: false })).toEqual({ x: -16, y: 0 });
    expect(arrowNudge({ key: 'ArrowDown', altKey: false, shiftKey: false })).toEqual({ x: 0, y: 16 });
    expect(arrowNudge({ key: 'ArrowUp', altKey: true, shiftKey: false })).toEqual({ x: 0, y: -2 });
    expect(arrowNudge({ key: 'ArrowRight', altKey: false, shiftKey: true })).toEqual({ x: 64, y: 0 });
  });

  it('ignores every other key', () => {
    expect(arrowNudge({ key: 'Enter', altKey: false, shiftKey: false })).toBeNull();
    expect(arrowNudge({ key: 'a', altKey: false, shiftKey: true })).toBeNull();
  });
});

describe('uprightAngle', () => {
  it('follows the line', () => {
    expect(uprightAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0, 9);
    expect(uprightAngle({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(45, 9);
    expect(uprightAngle({ x: 0, y: 0 }, { x: 100, y: -100 })).toBeCloseTo(-45, 9);
  });

  it('gives the same angle whichever end comes first', () => {
    const a = { x: 310, y: 212 };
    const b = { x: 716, y: 398 };
    expect(uprightAngle(a, b)).toBeCloseTo(uprightAngle(b, a), 9);
  });

  it('never sets the lettering upside down', () => {
    for (let direction = -180; direction <= 180; direction += 7.5) {
      const to = { x: 100 * Math.cos((direction * Math.PI) / 180), y: 100 * Math.sin((direction * Math.PI) / 180) };
      const angle = uprightAngle({ x: 0, y: 0 }, to);
      expect(angle).toBeGreaterThanOrEqual(-90);
      expect(angle).toBeLessThan(90);
      // Still along the line: the same direction, or the opposite one.
      expect(Math.abs(Math.sin(((angle - direction) * Math.PI) / 180))).toBeLessThan(1e-9);
    }
  });

  it('reads a vertical line upwards', () => {
    expect(uprightAngle({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(-90, 9);
    expect(uprightAngle({ x: 0, y: 100 }, { x: 0, y: 0 })).toBeCloseTo(-90, 9);
  });
});

describe('clipToStage', () => {
  it('keeps a line that is on stage as it is', () => {
    const clipped = clipToStage({ x: 100, y: 100 }, { x: 400, y: 300 }, STAGE, 0);
    expectPoint(clipped?.[0] ?? null, { x: 100, y: 100 });
    expectPoint(clipped?.[1] ?? null, { x: 400, y: 300 });
  });

  it('cuts a line where it leaves the stage', () => {
    const clipped = clipToStage({ x: -200, y: 404 }, { x: 720, y: 404 }, STAGE, 0);
    expectPoint(clipped?.[0] ?? null, { x: 0, y: 404 });
    expectPoint(clipped?.[1] ?? null, { x: 720, y: 404 });

    const both = clipToStage({ x: -100, y: -100 }, { x: 1540, y: 908 }, STAGE, 20);
    expect(both?.[0].x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(both?.[0].y).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(both?.[1].x).toBeLessThanOrEqual(1420 + 1e-9);
    expect(both?.[1].y).toBeLessThanOrEqual(788 + 1e-9);
  });

  it('reports a line that misses the stage', () => {
    expect(clipToStage({ x: -200, y: -50 }, { x: 1600, y: -10 }, STAGE, 0)).toBeNull();
    expect(clipToStage({ x: 1500, y: 100 }, { x: 1500, y: 700 }, STAGE, 0)).toBeNull();
    expect(clipToStage({ x: -300, y: 400 }, { x: -100, y: 900 }, STAGE, 0)).toBeNull();
  });
});

describe('plaqueCenter', () => {
  const beside = { inset: 0, lift: 15, shortestVisible: 0 };

  it('sits beside the middle of the line, on its upper side', () => {
    expectPoint(plaqueCenter({ x: 100, y: 300 }, { x: 500, y: 300 }, STAGE, beside), { x: 300, y: 285 });
    expectPoint(plaqueCenter({ x: 500, y: 300 }, { x: 100, y: 300 }, STAGE, beside), { x: 300, y: 285 });
    // A vertical line reads upwards, so "above" the lettering is to its left.
    expectPoint(plaqueCenter({ x: 300, y: 100 }, { x: 300, y: 500 }, STAGE, beside), { x: 285, y: 300 });
    const sloped = plaqueCenter({ x: 100, y: 100 }, { x: 500, y: 500 }, STAGE, beside);
    expect(sloped.y).toBeLessThan(300);
    expect(distanceBetween(sloped, { x: 300, y: 300 })).toBeCloseTo(15, 9);
  });

  it('moves to the middle of the part that is on stage', () => {
    const center = plaqueCenter({ x: -2000, y: 404 }, { x: 720, y: 404 }, STAGE, { inset: 40, lift: 15, shortestVisible: 90 });
    expectPoint(center, { x: (40 + 720) / 2, y: 389 });
  });

  it('keeps to the true middle when too little of the line shows to carry it', () => {
    // 70 px of the line are on stage (60 px inside the inset).
    const center = plaqueCenter({ x: -2000, y: 404 }, { x: 100, y: 404 }, STAGE, { inset: 40, lift: 15, shortestVisible: 90 });
    expectPoint(center, { x: -950, y: 389 });
  });

  it('keeps to the true middle when the line is off stage altogether', () => {
    const center = plaqueCenter({ x: -500, y: -300 }, { x: -100, y: -300 }, STAGE, { inset: 40, lift: 15, shortestVisible: 90 });
    expectPoint(center, { x: -300, y: -315 });
  });
});

describe('plaqueFits', () => {
  it('needs the line to be as long as the plaque and the room kept at both ends', () => {
    expect(plaqueFits(85, 53, 16)).toBe(true);
    expect(plaqueFits(84.9, 53, 16)).toBe(false);
    expect(plaqueFits(400, 53, 16)).toBe(true);
    expect(plaqueFits(4, 53, 16)).toBe(false);
  });
});

describe('rotatedBoxBounds and boxAround', () => {
  it('bounds a turned rectangle', () => {
    expect(rotatedBoxBounds({ x: 100, y: 100 }, 60, 20, 0)).toEqual({ x: 70, y: 90, width: 60, height: 20 });
    const quarter = rotatedBoxBounds({ x: 100, y: 100 }, 60, 20, -90);
    expect(quarter.width).toBeCloseTo(20, 9);
    expect(quarter.height).toBeCloseTo(60, 9);
    expect(quarter.x).toBeCloseTo(90, 9);
    expect(quarter.y).toBeCloseTo(70, 9);
    const sloped = rotatedBoxBounds({ x: 0, y: 0 }, 60, 20, 45);
    expect(sloped.width).toBeCloseTo(80 * Math.SQRT1_2, 9);
    expect(sloped.height).toBeCloseTo(80 * Math.SQRT1_2, 9);
    expect(sloped.x).toBeCloseTo(-40 * Math.SQRT1_2, 9);
  });

  it('centres a box on a point', () => {
    expect(boxAround({ x: 720, y: 404 }, 26, 26)).toEqual({ x: 707, y: 391, width: 26, height: 26 });
  });
});

describe('ringLabelSpot', () => {
  const INSET = { x: 26, y: 14 };

  it('sits at the top of the ring when that is on stage', () => {
    expectPoint(ringLabelSpot(CENTER, 200, STAGE, INSET), { x: 720, y: 204 });
  });

  it('slides round the ring to stay on stage when the top is cut off', () => {
    const pin = { x: 720, y: 100 };
    const spot = ringLabelSpot(pin, 200, STAGE, INSET);
    expect(spot).not.toBeNull();
    if (!spot) return;
    expect(distanceBetween(spot, pin)).toBeCloseTo(200, 6);
    // It stops as soon as it is clear of the top edge, on the clockwise side.
    expect(spot.y).toBeGreaterThanOrEqual(INSET.y);
    expect(spot.y).toBeLessThan(INSET.y + 0.5);
    expect(spot.x).toBeGreaterThan(pin.x);
  });

  it('goes the other way round when clockwise leads off stage', () => {
    const pin = { x: 1400, y: 60 };
    const spot = ringLabelSpot(pin, 150, STAGE, INSET);
    expect(spot).not.toBeNull();
    if (!spot) return;
    expect(spot.x).toBeLessThan(pin.x);
    expect(spot.x).toBeGreaterThanOrEqual(INSET.x);
    expect(spot.y).toBeGreaterThanOrEqual(INSET.y);
  });

  it('finds the arc that shows when the pin itself is off stage', () => {
    const pin = { x: -300, y: 404 };
    const spot = ringLabelSpot(pin, 400, STAGE, INSET);
    expect(spot).not.toBeNull();
    if (!spot) return;
    expect(distanceBetween(spot, pin)).toBeCloseTo(400, 6);
    expect(spot.x).toBeGreaterThanOrEqual(INSET.x);
    expect(spot.x).toBeLessThanOrEqual(STAGE.width - INSET.x);
  });

  it('moves smoothly as the pin moves', () => {
    let previous = ringLabelSpot({ x: 720, y: 150 }, 200, STAGE, INSET);
    for (let y = 149; y >= 60; y--) {
      const spot = ringLabelSpot({ x: 720, y }, 200, STAGE, INSET);
      expect(spot).not.toBeNull();
      if (spot && previous) expect(distanceBetween(spot, previous)).toBeLessThan(6);
      previous = spot;
    }
  });

  it('gives up when no part of the ring is on stage', () => {
    expect(ringLabelSpot({ x: -500, y: -500 }, 100, STAGE, INSET)).toBeNull();
    // The ring surrounds the whole stage.
    expect(ringLabelSpot(CENTER, 2000, STAGE, INSET)).toBeNull();
  });
});

describe('edgeChipSpot', () => {
  const INSET = { x: 60, y: 30 };

  it('stays away while the pin is on stage or its mark still shows', () => {
    expect(edgeChipSpot(CENTER, STAGE, INSET, 12)).toBeNull();
    expect(edgeChipSpot({ x: 0, y: 0 }, STAGE, INSET, 12)).toBeNull();
    expect(edgeChipSpot({ x: -11, y: 400 }, STAGE, INSET, 12)).toBeNull();
    expect(edgeChipSpot({ x: -13, y: 400 }, STAGE, INSET, 12)).not.toBeNull();
    expect(edgeChipSpot({ x: 700, y: STAGE.height + 13 }, STAGE, INSET, 12)).not.toBeNull();
  });

  it('sits at the edge on the way to the pin and points at it', () => {
    const east = edgeChipSpot({ x: 3000, y: 404 }, STAGE, INSET, 12);
    expect(east).toEqual({ x: 1380, y: 404, bearing: 90 });

    const north = edgeChipSpot({ x: 720, y: -900 }, STAGE, INSET, 12);
    expect(north?.x).toBeCloseTo(720, 9);
    expect(north?.y).toBeCloseTo(30, 9);
    expect(north?.bearing).toBeCloseTo(0, 9);

    const southWest = edgeChipSpot({ x: -1000, y: 1400 }, STAGE, INSET, 12);
    expect(southWest).not.toBeNull();
    if (!southWest) return;
    // Down and to the left, so past west (-90) on the way round to south: the direction of the ray itself.
    expect(southWest.bearing).toBeCloseTo((Math.atan2(-1000 - CENTER.x, CENTER.y - 1400) * 180) / Math.PI, 9);
    expect(southWest.bearing).toBeLessThan(-90);
    // On the ray from the middle of the stage to the pin, and inside the inset on both axes.
    const along = (southWest.x - CENTER.x) / (-1000 - CENTER.x);
    expect((southWest.y - CENTER.y) / (1400 - CENTER.y)).toBeCloseTo(along, 9);
    expect(southWest.x).toBeGreaterThanOrEqual(INSET.x - 1e-9);
    expect(southWest.y).toBeLessThanOrEqual(STAGE.height - INSET.y + 1e-9);
  });

  it('holds the corner when the pin is off past one', () => {
    // Three times as far from the middle of the stage as the inset corner, in the same direction.
    const corner = edgeChipSpot({ x: 720 + 3 * 660, y: 404 - 3 * 374 }, STAGE, INSET, 12);
    expect(corner?.x).toBeCloseTo(1380, 6);
    expect(corner?.y).toBeCloseTo(30, 6);
  });

  it('copes with a stage smaller than the chip', () => {
    const spot = edgeChipSpot({ x: 500, y: 20 }, { width: 80, height: 40 }, INSET, 12);
    expect(spot).toEqual({ x: 40, y: 20, bearing: 90 });
  });
});
