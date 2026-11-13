import { describe, expect, it } from 'vitest';
import { reachOfLine, type Box } from './spot-reach';

const TARGET = 40;
/** A collar 100px tall, with the sentence's column from 100 to 440. */
const WITHIN: Box = { left: 100, right: 440, top: 0, bottom: 100 };
/** A line of the sentence, 20px tall: the first line is 30..50, the second 50..70. */
const line = (left: number, right: number, top: number): Box => ({ left, right, top, bottom: top + 20 });

describe('reachOfLine', () => {
  it('centres a band as tall as a target on a line with nothing above or below it', () => {
    expect(reachOfLine(line(100, 220, 40), TARGET, [], WITHIN)).toEqual([{ left: 100, right: 220, top: 30, bottom: 70 }]);
  });

  it('gives a line with the other spot right under it the whole target above that spot', () => {
    const home = line(100, 220, 30);
    const away = line(100, 150, 50);
    expect(reachOfLine(home, TARGET, [away], WITHIN)).toEqual([
      { left: 100, right: 150, top: 10, bottom: 50 },
      { left: 150, right: 220, top: 20, bottom: 60 },
    ]);
  });

  it('gives a line with the other spot right over it the whole target below that spot', () => {
    const home = line(100, 220, 30);
    const away = line(100, 150, 50);
    expect(reachOfLine(away, TARGET, [home], WITHIN)).toEqual([{ left: 100, right: 150, top: 50, bottom: 90 }]);
  });

  it('is cut along the line where what lies under it changes', () => {
    const away = line(100, 400, 50);
    const button = { left: 200, right: 240, top: 72, bottom: 112 };
    expect(reachOfLine(away, TARGET, [button], WITHIN)).toEqual([
      { left: 100, right: 200, top: 40, bottom: 80 },
      { left: 200, right: 240, top: 32, bottom: 72 },
      { left: 240, right: 400, top: 40, bottom: 80 },
    ]);
  });

  it('joins neighbouring stretches that come out the same', () => {
    const away = line(100, 400, 50);
    const buttons = [
      { left: 200, right: 240, top: 72, bottom: 112 },
      { left: 240, right: 280, top: 72, bottom: 112 },
    ];
    expect(reachOfLine(away, TARGET, buttons, WITHIN)).toEqual([
      { left: 100, right: 200, top: 40, bottom: 80 },
      { left: 200, right: 280, top: 32, bottom: 72 },
      { left: 280, right: 400, top: 40, bottom: 80 },
    ]);
  });

  it('takes all the room there is between two things that are closer together than a target', () => {
    const home = line(100, 220, 30);
    const away = line(100, 220, 50);
    const button = { left: 100, right: 220, top: 75, bottom: 115 };
    expect(reachOfLine(away, TARGET, [home, button], WITHIN)).toEqual([{ left: 100, right: 220, top: 50, bottom: 75 }]);
  });

  it('stays inside its bounds, and makes up below for what it cannot have above', () => {
    expect(reachOfLine(line(100, 220, 5), TARGET, [], WITHIN)).toEqual([{ left: 100, right: 220, top: 0, bottom: 40 }]);
    expect(reachOfLine(line(100, 220, 85), TARGET, [], WITHIN)).toEqual([{ left: 100, right: 220, top: 60, bottom: 100 }]);
  });

  it('answers only as far along the line as the sentence is shown', () => {
    expect(reachOfLine(line(300, 520, 40), TARGET, [], WITHIN)).toEqual([{ left: 300, right: 440, top: 30, bottom: 70 }]);
    expect(reachOfLine(line(460, 520, 40), TARGET, [], WITHIN)).toEqual([]);
  });

  it('takes no notice of what is beside the line or far from it', () => {
    const beside = { left: 240, right: 300, top: 20, bottom: 60 };
    const far = { left: 100, right: 220, top: 95, bottom: 135 };
    expect(reachOfLine(line(100, 220, 40), TARGET, [beside, far], WITHIN)).toEqual([{ left: 100, right: 220, top: 30, bottom: 70 }]);
  });
});
