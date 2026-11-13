import { describe, expect, it } from 'vitest';
import { boxIsNearPoint, boxIsNearSegment } from './clearance';

const box = { x: 100, y: 50, width: 200, height: 40 };

describe('keeping a note clear of a point', () => {
  it('counts a point inside the box, and one within the margin of it', () => {
    expect(boxIsNearPoint(box, { x: 150, y: 70 }, 0)).toBe(true);
    expect(boxIsNearPoint(box, { x: 310, y: 70 }, 12)).toBe(true);
    expect(boxIsNearPoint(box, { x: 150, y: 100 }, 12)).toBe(true);
  });

  it('lets a point further off than the margin be', () => {
    expect(boxIsNearPoint(box, { x: 313, y: 70 }, 12)).toBe(false);
    expect(boxIsNearPoint(box, { x: 150, y: 103 }, 12)).toBe(false);
  });
});

describe('keeping a note clear of a line', () => {
  it('counts a line that crosses the box', () => {
    expect(boxIsNearSegment(box, { x: 0, y: 0 }, { x: 400, y: 140 }, 0)).toBe(true);
    expect(boxIsNearSegment(box, { x: 200, y: 0 }, { x: 200, y: 200 }, 0)).toBe(true);
  });

  it('counts a line that ends inside the box, or starts there', () => {
    expect(boxIsNearSegment(box, { x: 200, y: 300 }, { x: 200, y: 70 }, 0)).toBe(true);
    expect(boxIsNearSegment(box, { x: 200, y: 70 }, { x: 600, y: 600 }, 0)).toBe(true);
  });

  it('lets a line that stops short of the box be', () => {
    expect(boxIsNearSegment(box, { x: 200, y: 300 }, { x: 200, y: 120 }, 0)).toBe(false);
    expect(boxIsNearSegment(box, { x: 200, y: 300 }, { x: 200, y: 120 }, 12)).toBe(false);
    expect(boxIsNearSegment(box, { x: 200, y: 300 }, { x: 200, y: 100 }, 12)).toBe(true);
  });

  it('lets a line that passes beside the box be', () => {
    expect(boxIsNearSegment(box, { x: 0, y: 120 }, { x: 400, y: 120 }, 0)).toBe(false);
    expect(boxIsNearSegment(box, { x: 320, y: 0 }, { x: 320, y: 200 }, 12)).toBe(false);
    expect(boxIsNearSegment(box, { x: 310, y: 0 }, { x: 310, y: 200 }, 12)).toBe(true);
  });

  it('handles a line of no length as a point', () => {
    expect(boxIsNearSegment(box, { x: 150, y: 70 }, { x: 150, y: 70 }, 0)).toBe(true);
    expect(boxIsNearSegment(box, { x: 10, y: 10 }, { x: 10, y: 10 }, 0)).toBe(false);
  });
});
