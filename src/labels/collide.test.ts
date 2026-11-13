import { describe, expect, it } from 'vitest';
import type { ScreenBox } from '../map/contracts';
import { collisionOrder, liesOnAny, placeLabels, type LabelBox } from './collide';

const AT_REST = { gap: 4, maxShift: 40 };
const MOVING = { gap: 4, maxShift: 40, creep: 6 };

function label(x: number, y: number, width = 60, height = 20, shownAt?: number): LabelBox {
  return shownAt === undefined ? { x, y, width, height } : { x, y, width, height, shownAt };
}

/** The boxes the placed labels end up in. */
function boxes(labels: readonly LabelBox[], shifts: readonly (number | null)[]): ScreenBox[] {
  return labels.flatMap((box, index) => {
    const shift = shifts[index];
    if (shift === null || shift === undefined) return [];
    return [{ x: box.x - box.width / 2, y: box.y + shift - box.height / 2, width: box.width, height: box.height }];
  });
}

function closerThan(a: ScreenBox, b: ScreenBox, gap: number): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width > b.x - gap && a.y < b.y + b.height + gap && a.y + a.height > b.y - gap;
}

function anyTooClose(placed: readonly ScreenBox[], gap: number): boolean {
  return placed.some((a, i) => placed.some((b, j) => i < j && closerThan(a, b, gap)));
}

describe('placeLabels', () => {
  it('leaves labels that are clear of each other on their places', () => {
    expect(placeLabels([label(100, 100), label(300, 100), label(100, 200)], [], AT_REST)).toEqual([0, 0, 0]);
  });

  it('gives the spot to the label that comes first', () => {
    const shifts = placeLabels([label(100, 100), label(120, 104)], [], AT_REST);
    expect(shifts[0]).toBe(0);
    expect(shifts[1]).not.toBe(0);
  });

  it('counts labels closer than the gap as colliding', () => {
    // 60 wide each: 62 apart leaves 2 px between them, 65 apart leaves 5 px.
    expect(placeLabels([label(100, 100), label(162, 100)], [], AT_REST)[1]).not.toBe(0);
    expect(placeLabels([label(100, 100), label(165, 100)], [], AT_REST)).toEqual([0, 0]);
  });

  it('stacks a name just below one that sits on the same point', () => {
    const labels = [label(100, 100), label(100, 100)];
    const shifts = placeLabels(labels, [], AT_REST);
    // One label height plus the gap further down.
    expect(shifts).toEqual([0, 24]);
    expect(anyTooClose(boxes(labels, shifts), 3.99)).toBe(false);
  });

  it('goes above when below is taken too', () => {
    const labels = [label(100, 100), label(100, 124), label(100, 100)];
    expect(placeLabels(labels, [], AT_REST)).toEqual([0, 0, -24]);
  });

  it('drops a label when its place, below and above are all taken', () => {
    const labels = [label(100, 100), label(100, 124), label(100, 76), label(100, 100)];
    expect(placeLabels(labels, [], AT_REST)).toEqual([0, 0, 0, null]);
  });

  it('moves a label only as far as it takes to clear what is in the way', () => {
    // The first label sits 8 px higher, so the second needs to go down by 16, not 24.
    expect(placeLabels([label(100, 92), label(100, 100)], [], AT_REST)).toEqual([0, 16]);
  });

  it('keeps clear of a reserved box, such as the pin', () => {
    const pin: ScreenBox = { x: 85, y: 85, width: 30, height: 30 };
    const labels = [label(100, 100), label(104, 96)];
    const shifts = placeLabels(labels, [pin], AT_REST);
    // The first goes below the pin, the second above it.
    expect(shifts).toEqual([29, -25]);
    for (const box of boxes(labels, shifts)) expect(closerThan(box, pin, 3.99)).toBe(false);
  });

  it('drops a label rather than move it further than allowed', () => {
    const wall: ScreenBox = { x: 0, y: 40, width: 200, height: 120 };
    expect(placeLabels([label(100, 100)], [wall], AT_REST)).toEqual([null]);
    // Near the wall's lower edge the way out is short enough.
    expect(placeLabels([label(100, 140)], [wall], AT_REST)).toEqual([34]);
  });

  it('goes on past the next thing in its way when the spot beside the first is taken too', () => {
    // A small mark inside the pin's box comes first: clearing the mark alone would land on the pin.
    const mark: ScreenBox = { x: 92, y: 92, width: 16, height: 16 };
    const pin: ScreenBox = { x: 85, y: 85, width: 30, height: 30 };
    const shifts = placeLabels([label(100, 100)], [mark, pin], AT_REST);
    expect(shifts).toEqual([29]);
  });

  it('lets a name pushed off its place by a reserved box go further than one making room for a name', () => {
    const options = { ...AT_REST, maxShiftOffReserved: 72 };
    const pin: ScreenBox = { x: 85, y: 85, width: 30, height: 30 };
    // Two names on the pin: the second stacks under the first, 53 px from its place.
    const onThePin = [label(100, 100), label(100, 100)];
    expect(placeLabels(onThePin, [pin], AT_REST)).toEqual([29, -29]);
    expect(placeLabels(onThePin, [{ ...pin, y: 40, height: 75 }], AT_REST)).toEqual([29, null]);
    expect(placeLabels(onThePin, [{ ...pin, y: 40, height: 75 }], options)).toEqual([29, 53]);
    // Away from the pin the limit is the usual one: a third name on a stack of two is dropped.
    const stack = [label(300, 100), label(300, 100), label(300, 76), label(300, 100)];
    expect(placeLabels(stack, [pin], options)).toEqual([0, 24, 0, null]);
  });

  it('keeps both names that meet under the pin when a ring label sits right above it', () => {
    const pin: ScreenBox = { x: 704, y: 364, width: 32, height: 32 };
    const ringLabel: ScreenBox = { x: 704, y: 333, width: 32, height: 16 };
    const tripEnd: ScreenBox = { x: 711, y: 371, width: 18, height: 18 };
    const sanJose = label(718, 369, 71, 23.5);
    const london = label(720, 380, 50, 19.5);
    const reserved = [tripEnd, ringLabel, pin];
    const shifts = placeLabels([sanJose, london], reserved, { ...AT_REST, maxShiftOffReserved: 72 });
    expect(shifts[0]).toBeCloseTo(42.75, 9);
    expect(shifts[1]).toBeCloseTo(57.25, 9);
    const placed = boxes([sanJose, london], shifts);
    expect(anyTooClose(placed, 3.99)).toBe(false);
    for (const box of placed) expect(reserved.some((kept) => closerThan(box, kept, 3.99))).toBe(false);
  });

  it('takes the nearer side of a reserved box, and the lower one when both are as near', () => {
    const pin: ScreenBox = { x: 85, y: 85, width: 30, height: 30 };
    expect(placeLabels([label(100, 94)], [pin], AT_REST)).toEqual([-23]);
    expect(placeLabels([label(100, 106)], [pin], AT_REST)).toEqual([23]);
    expect(placeLabels([label(100, 100)], [pin], AT_REST)).toEqual([29]);
  });

  it('keeps to one step, below first, for a name that only makes room for another name', () => {
    // The second name's place lies above the middle of the first: it still goes below, as ever.
    expect(placeLabels([label(100, 100), label(100, 94)], [], AT_REST)).toEqual([0, 30]);
    // Below the first name a third is in the way: no going on past that one.
    const stack = [label(100, 100), label(100, 124), label(100, 110)];
    expect(placeLabels(stack, [], AT_REST)).toEqual([0, 0, -34]);
    expect(placeLabels([...stack.slice(0, 2), label(100, 76), label(100, 110)], [], AT_REST)).toEqual([0, 0, 0, null]);
  });

  it('never places two labels closer than the gap, whatever the crowd', () => {
    const crowd: LabelBox[] = [];
    for (let i = 0; i < 120; i++) crowd.push(label(50 + ((i * 37) % 400), 50 + ((i * 53) % 300), 40 + (i % 5) * 12, 16 + (i % 2) * 5));
    const pin: ScreenBox = { x: 235, y: 185, width: 30, height: 30 };
    const shifts = placeLabels(crowd, [pin], AT_REST);
    const placed = boxes(crowd, shifts);
    expect(placed.length).toBeGreaterThan(20);
    expect(placed.length).toBeLessThan(crowd.length);
    expect(anyTooClose(placed, 3.99)).toBe(false);
    expect(placed.some((box) => closerThan(box, pin, 3.99))).toBe(false);
    for (const shift of shifts) expect(Math.abs(shift ?? 0)).toBeLessThanOrEqual(40);
  });
});

describe('placeLabels: labels already on show', () => {
  it('keeps a shifted label on the side it is on', () => {
    // Free both below and above; a newcomer would go below.
    expect(placeLabels([label(100, 100), label(100, 100)], [], AT_REST)[1]).toBe(24);
    expect(placeLabels([label(100, 100), label(100, 100, 60, 20, -24)], [], AT_REST)[1]).toBe(-24);
  });

  it('puts a shifted label back on its place once that is free', () => {
    expect(placeLabels([label(300, 100), label(100, 100, 60, 20, 24)], [], AT_REST)).toEqual([0, 0]);
  });

  it('switches sides when its own side is taken', () => {
    const labels = [label(100, 100), label(100, 76), label(100, 100, 60, 20, -24)];
    expect(placeLabels(labels, [], AT_REST)).toEqual([0, 0, 24]);
  });
});

describe('placeLabels: while the maps are moving', () => {
  it('does not push a label off its place: it just does not fit', () => {
    expect(placeLabels([label(100, 100), label(100, 100, 60, 20, 0)], [], MOVING)).toEqual([0, null]);
    expect(placeLabels([label(100, 100), label(100, 100)], [], MOVING)).toEqual([0, null]);
  });

  it('lets a label that is already shifted follow what it dodges in small steps', () => {
    // Shifted by 24 so far; what it dodges has moved 4 px down.
    expect(placeLabels([label(100, 104), label(100, 100, 60, 20, 24)], [], MOVING)).toEqual([0, 28]);
  });

  it('drops a shifted label that would have to jump', () => {
    expect(placeLabels([label(100, 112), label(100, 100, 60, 20, 24)], [], MOVING)).toEqual([0, null]);
    // The same jump is fine once everything is at rest.
    expect(placeLabels([label(100, 112), label(100, 100, 60, 20, 24)], [], AT_REST)).toEqual([0, 36]);
  });

  it('still lets a shifted label return to its place', () => {
    expect(placeLabels([label(300, 100), label(100, 100, 60, 20, 24)], [], MOVING)).toEqual([0, 0]);
  });
});

describe('collisionOrder', () => {
  const entry = (name: string, flags: { major?: boolean; shown?: boolean } = {}) => ({
    name,
    major: flags.major ?? false,
    shown: flags.shown ?? false,
  });
  const names = (list: readonly { name: string }[]) => list.map((item) => item.name);

  it('lets Home and Away take turns, Home first', () => {
    const home = [entry('h1'), entry('h2'), entry('h3')];
    const away = [entry('a1'), entry('a2'), entry('a3')];
    expect(names(collisionOrder(home, away))).toEqual(['h1', 'a1', 'h2', 'a2', 'h3', 'a3']);
  });

  it('lets the longer sheet run on when the other is used up', () => {
    const home = [entry('h1')];
    const away = [entry('a1'), entry('a2'), entry('a3')];
    expect(names(collisionOrder(home, away))).toEqual(['h1', 'a1', 'a2', 'a3']);
    expect(names(collisionOrder([], away))).toEqual(['a1', 'a2', 'a3']);
  });

  it('puts labels on show ahead of newcomers, however well those rank', () => {
    const home = [entry('h-new-best'), entry('h-shown', { shown: true })];
    const away = [entry('a-new-best'), entry('a-shown', { shown: true })];
    expect(names(collisionOrder(home, away))).toEqual(['h-shown', 'a-shown', 'h-new-best', 'a-new-best']);
  });

  it('puts the big names ahead of everything, on show or not', () => {
    const home = [entry('San Jose', { major: true }), entry('h-shown', { shown: true }), entry('h-new')];
    const away = [entry('London', { major: true, shown: true }), entry('a-shown', { shown: true })];
    expect(names(collisionOrder(home, away))).toEqual(['San Jose', 'London', 'h-shown', 'a-shown', 'h-new']);
  });

  it('keeps every label exactly once', () => {
    const home = [entry('h1', { major: true }), entry('h2', { shown: true }), entry('h3')];
    const away = [entry('a1'), entry('a2', { shown: true }), entry('a3', { major: true, shown: true })];
    expect(names(collisionOrder(home, away)).sort()).toEqual(['a1', 'a2', 'a3', 'h1', 'h2', 'h3']);
  });
});

describe('a pass with hysteresis', () => {
  interface Name extends LabelBox {
    readonly name: string;
    readonly major: boolean;
    readonly shown: boolean;
  }
  const name = (text: string, x: number, y: number, shown: boolean): Name => ({
    name: text,
    x,
    y,
    width: 60,
    height: 20,
    major: false,
    shown,
    ...(shown ? { shownAt: 0 } : {}),
  });
  const shownAfter = (home: Name[], away: Name[], options = MOVING): string[] => {
    const order = collisionOrder(home, away);
    const shifts = placeLabels(order, [], options);
    return order.filter((_, index) => shifts[index] !== null).map((item) => item.name);
  };

  it('does not let a better-ranked newcomer push out a name that is on show', () => {
    // "Newcomer" ranks first on its sheet but arrives where "Resident" already is.
    const home = [name('Newcomer', 110, 100, false), name('Resident', 100, 100, true)];
    expect(shownAfter(home, [])).toEqual(['Resident']);
    // Without a history the better-ranked one wins.
    expect(shownAfter([name('Newcomer', 110, 100, false), name('Resident', 100, 100, false)], [])).toEqual(['Newcomer']);
  });

  it('gives the same answer pass after pass while nothing moves', () => {
    let home = [name('H1', 100, 100, false), name('H2', 130, 104, false), name('H3', 400, 100, false)];
    let away = [name('A1', 110, 110, false), name('A2', 300, 300, false), name('A3', 410, 108, false)];
    const first = shownAfter(home, away);
    expect(first).toEqual(['H1', 'A2', 'H3']);
    for (let pass = 0; pass < 3; pass++) {
      home = home.map((item) => name(item.name, item.x, item.y, first.includes(item.name)));
      away = away.map((item) => name(item.name, item.x, item.y, first.includes(item.name)));
      expect(shownAfter(home, away).sort()).toEqual([...first].sort());
    }
  });
});

describe('liesOnAny', () => {
  const pin: ScreenBox = { x: 100, y: 100, width: 30, height: 30 };
  const plaque: ScreenBox = { x: 300, y: 40, width: 60, height: 20 };

  it('is true for a rectangle that covers part of a box', () => {
    expect(liesOnAny({ left: 120, top: 90, right: 180, bottom: 110 }, [pin, plaque])).toBe(true);
    expect(liesOnAny({ left: 290, top: 50, right: 310, bottom: 70 }, [pin, plaque])).toBe(true);
  });

  it('is true for a rectangle inside a box, and for one a box lies inside', () => {
    expect(liesOnAny({ left: 110, top: 110, right: 120, bottom: 120 }, [pin])).toBe(true);
    expect(liesOnAny({ left: 0, top: 0, right: 400, bottom: 400 }, [pin])).toBe(true);
  });

  it('is false for a rectangle clear of every box', () => {
    expect(liesOnAny({ left: 140, top: 100, right: 200, bottom: 120 }, [pin, plaque])).toBe(false);
    expect(liesOnAny({ left: 100, top: 140, right: 130, bottom: 160 }, [pin, plaque])).toBe(false);
  });

  it('does not count edges that only touch', () => {
    expect(liesOnAny({ left: 130, top: 100, right: 190, bottom: 130 }, [pin])).toBe(false);
    expect(liesOnAny({ left: 100, top: 80, right: 130, bottom: 100 }, [pin])).toBe(false);
  });

  it('is false when there are no boxes', () => {
    expect(liesOnAny({ left: 0, top: 0, right: 10, bottom: 10 }, [])).toBe(false);
  });
});
