import { expect, type Locator } from '@playwright/test';

interface TextBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Where a piece of text is drawn: the box its first words are in, and the box of its last (the same, unless a line breaks it). */
interface DrawnText {
  readonly begins: TextBox;
  readonly ends: TextBox;
}

/** Where a piece of an element's text is drawn on the page. The piece has to lie within one run of the text. */
async function whereDrawn(within: Locator, piece: string): Promise<DrawnText> {
  const drawn = await within.evaluate((element, wanted) => {
    const runs = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let run = runs.nextNode(); run; run = runs.nextNode()) {
      const at = (run.textContent ?? '').indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(run, at);
      range.setEnd(run, at + wanted.length);
      const boxes = [...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
      const [begins] = boxes;
      const ends = boxes.at(-1);
      return begins && ends ? { begins, ends } : null;
    }
    return null;
  }, piece);
  if (!drawn) throw new Error(`No run of the text holds "${piece}".`);
  return drawn;
}

/**
 * The pieces of an element's text are drawn in the order given, as a sentence written left to right
 * is read: each begins to the right of where the one before it ends, or on a line further down. That
 * the text holds them in that order does not say so: a name written right to left, or a mark that
 * overrides the direction, can make the browser draw the words around it somewhere else.
 */
export async function expectDrawnInOrder(within: Locator, pieces: readonly string[]): Promise<void> {
  const drawn = await Promise.all(pieces.map((piece) => whereDrawn(within, piece)));
  drawn.slice(1).forEach(({ begins }, index) => {
    const before = drawn[index]?.ends;
    if (!before) return;
    const furtherDown = begins.top >= before.bottom - 1;
    const toTheRight = begins.left >= before.right - 1;
    expect(furtherDown || toTheRight, `"${pieces[index + 1]}" is drawn after "${pieces[index]}"`).toBe(true);
  });
}
