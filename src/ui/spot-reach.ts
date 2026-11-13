import type { Sheet } from '../map/contracts';
import { el } from './dom';
import type { SpotParts } from './spot-parts';

/** A rectangle on the page, in viewport pixels. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const SHEETS = ['home', 'away'] as const;
/** What `--target` falls back to until the page's styles are known. */
const TARGET_FALLBACK_PX = 40;

/**
 * Where one line of a spot's words answers the pointer: a band as tall as a full target, centred on
 * the line. Whatever else answers the pointer above or below the line (`taken`) pushes the band the
 * other way, and nothing of it leaves `within`. The band is cut along the line where that changes,
 * so each stretch of the words gets all the height there is for it; between two things that are
 * closer together than a target, that is all the room between them.
 */
export function reachOfLine(line: Box, target: number, taken: readonly Box[], within: Box): Box[] {
  const left = Math.max(line.left, within.left);
  const right = Math.min(line.right, within.right);
  if (right <= left) return [];
  const middle = (line.top + line.bottom) / 2;
  const near = taken.filter((box) => box.right > left && box.left < right && box.bottom > middle - target && box.top < middle + target);
  const edges = near.flatMap((box) => [box.left, box.right]).filter((x) => x > left && x < right);
  const cuts = [...new Set([left, ...edges, right])].sort((a, b) => a - b);

  const pieces: Box[] = [];
  cuts.slice(1).forEach((to, index) => {
    const from = cuts[index] as number;
    let ceiling = within.top;
    let floor = within.bottom;
    for (const box of near) {
      if (box.right <= from || box.left >= to) continue;
      if ((box.top + box.bottom) / 2 < middle) ceiling = Math.max(ceiling, box.bottom);
      else floor = Math.min(floor, box.top);
    }
    const top = Math.max(ceiling, Math.min(middle - target / 2, floor - target));
    const bottom = Math.min(floor, top + target);
    if (bottom <= top) return;
    const before = pieces.at(-1);
    if (before && before.right === from && before.top === top && before.bottom === bottom) pieces[pieces.length - 1] = { ...before, right: to };
    else pieces.push({ left: from, right: to, top, bottom });
  });
  return pieces;
}

/**
 * The box around the targets of a group of buttons, each grown evenly up and down until it is as
 * tall as a target. One box for all of them: the gaps between the buttons are no place to aim for
 * something else. Null without buttons.
 */
function targetsOf(buttons: readonly Element[], target: number): Box | null {
  if (buttons.length === 0) return null;
  const targets = buttons.map((button) => {
    const box = button.getBoundingClientRect();
    const grow = Math.max(0, (target - box.height) / 2);
    return { left: box.left, right: box.right, top: box.top - grow, bottom: box.bottom + grow };
  });
  return {
    left: Math.min(...targets.map((box) => box.left)),
    right: Math.max(...targets.map((box) => box.right)),
    top: Math.min(...targets.map((box) => box.top)),
    bottom: Math.max(...targets.map((box) => box.bottom)),
  };
}

export interface SpotReach {
  /** The sentence has been reworded: its spots are measured again before the next frame is drawn. */
  update(): void;
}

/**
 * Lets the two spots of the collar's pin sentence answer the pointer over a full target, without
 * moving a word of the sentence.
 *
 * The sentence is cut off after two lines, and what a spot's own box added around its words would
 * be cut off with it; and a spot on the second line cannot reach up over the words of the first.
 * So each line of a spot gets pieces of its own to take the pointer (`reachOfLine`), placed from
 * the positioned box the section stands in (the collar), where the cut-off does not reach them.
 * They are children of the spot, so a press, a hover or a tap on one is the spot's own.
 *
 * `controls` are the buttons that stand beside or below the sentence: their targets are left alone.
 * A spot's pieces never go below the foot of `section` or above the top of the collar.
 */
export function keepSpotReach(deps: { section: HTMLElement; sentence: HTMLElement; spots: SpotParts; controls: HTMLElement }): SpotReach {
  const { section, sentence, spots, controls } = deps;
  const pieces: Record<Sheet, HTMLElement[]> = { home: [], away: [] };

  /** The lines of a spot's words that are in sight, each as tall as a line of the sentence. */
  const linesOf = (sheet: Sheet, clip: DOMRect, lineHeight: number): Box[] =>
    [...spots[sheet].words.getClientRects()]
      .map((rect) => ({ rect, middle: (rect.top + rect.bottom) / 2 }))
      .filter(({ middle }) => middle > clip.top && middle < clip.bottom)
      .map(({ rect, middle }) => {
        const half = (Number.isFinite(lineHeight) ? lineHeight : rect.height) / 2;
        return { left: rect.left, right: rect.right, top: middle - half, bottom: middle + half };
      });

  const place = (sheet: Sheet, boxes: readonly Box[], origin: { readonly x: number; readonly y: number }): void => {
    const drawn = pieces[sheet];
    while (drawn.length > boxes.length) drawn.pop()?.remove();
    boxes.forEach((box, index) => {
      let piece = drawn[index];
      if (!piece) {
        piece = el('span', 'spot-part__reach');
        drawn.push(piece);
        spots[sheet].element.append(piece);
      }
      piece.style.left = `${box.left - origin.x}px`;
      piece.style.top = `${box.top - origin.y}px`;
      piece.style.width = `${box.right - box.left}px`;
      piece.style.height = `${box.bottom - box.top}px`;
    });
  };

  const measure = (): void => {
    const frame = sentence.offsetParent;
    const clip = sentence.getBoundingClientRect();
    // Not shown just now (this width of collar has no room for the sentence, or there is none to show).
    if (!frame || clip.height === 0) {
      for (const sheet of SHEETS) place(sheet, [], { x: 0, y: 0 });
      return;
    }
    const style = getComputedStyle(sentence);
    const target = Number.parseFloat(style.getPropertyValue('--target')) || TARGET_FALLBACK_PX;
    const lineHeight = Number.parseFloat(style.lineHeight);
    const frameBox = frame.getBoundingClientRect();
    const within: Box = { left: clip.left, right: clip.right, top: frameBox.top, bottom: section.getBoundingClientRect().bottom };
    const origin = { x: frameBox.left + frame.clientLeft, y: frameBox.top + frame.clientTop };
    const lines: Readonly<Record<Sheet, Box[]>> = { home: linesOf('home', clip, lineHeight), away: linesOf('away', clip, lineHeight) };
    const buttons = targetsOf([...controls.querySelectorAll('button')], target);
    for (const sheet of SHEETS) {
      const taken = [...lines[sheet === 'home' ? 'away' : 'home'], ...(buttons ? [buttons] : [])];
      place(
        sheet,
        lines[sheet].flatMap((line) => reachOfLine(line, target, taken, within)),
        origin,
      );
    }
  };

  let queued = false;
  const update = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      measure();
    });
  };

  // The lines move when the collar is laid out anew (another width, a finger in place of a mouse,
  // the sentence shown in full while a spot has the keyboard's focus) and when the type arrives.
  const resizes = new ResizeObserver(measure);
  resizes.observe(section);
  resizes.observe(sentence);
  document.fonts.addEventListener('loadingdone', update);

  return { update };
}
