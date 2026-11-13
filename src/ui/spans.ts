import type { Span } from '../app/readout';
import type { Sheet } from '../map/contracts';
import { el } from './dom';
import { sameSpans } from './sentences';
import type { SpotParts } from './spot-parts';

interface Drawn {
  readonly spans: readonly Span[];
  readonly parts: SpotParts | null;
}

const drawn = new WeakMap<Element, Drawn>();

function onSheet(span: Span): Sheet | null {
  return span.ink === 'home' || span.ink === 'away' ? span.ink : null;
}

function inkRun(span: Span): Node | string {
  return span.ink ? el('span', `ink ink--${span.ink}`, {}, [span.text]) : span.text;
}

/** Writes the pin sentence: its Home and Away runs are the controls of `parts`, the words between them plain text. */
function drawWithParts(target: Element, spans: readonly Span[], parts: SpotParts): void {
  const standsFor = (span: Span, node: ChildNode | undefined): boolean => {
    const sheet = onSheet(span);
    return sheet ? node === parts[sheet].element : span.ink === undefined && node instanceof Text;
  };
  // Taking a control out of the page, even to put it straight back, costs it the focus. So as long
  // as the sentence is built the same way, only its words are changed.
  const sameBuild = target.childNodes.length === spans.length && spans.every((span, index) => standsFor(span, target.childNodes[index]));
  if (!sameBuild) {
    target.replaceChildren(
      ...spans.map((span) => {
        const sheet = onSheet(span);
        return sheet ? parts[sheet].element : inkRun(span);
      }),
    );
  }
  spans.forEach((span, index) => {
    const sheet = onSheet(span);
    const node = target.childNodes[index];
    if (sheet) parts[sheet].setWords(span.text);
    else if (node && node.textContent !== span.text) node.textContent = span.text;
  });
}

/**
 * Writes a sentence into an element, each run in its ink (`.ink--home`, `.ink--away`, `.ink--figure`).
 * Nothing is touched when the sentence is the one already there. Given `parts`, the sentence is the
 * pin sentence, and the runs that name its two spots are those controls.
 */
export function drawSpans(target: Element, spans: readonly Span[], parts: SpotParts | null = null): void {
  const before = drawn.get(target);
  if (before && before.parts === parts && sameSpans(before.spans, spans)) return;
  drawn.set(target, { spans, parts });
  if (parts) drawWithParts(target, spans, parts);
  else target.replaceChildren(...spans.map(inkRun));
}
