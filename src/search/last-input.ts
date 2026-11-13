/** What the person last used: the keyboard, a finger, or a mouse or pen. */
export type InputKind = 'keyboard' | 'touch' | 'pointer';

export interface LastInput {
  kind(): InputKind;
}

/**
 * Watches a window for the kind of input used last. A click alone does not say whether it came from
 * Enter or from a finger, and the picker treats the two differently.
 */
export function watchLastInput(target: Pick<EventTarget, 'addEventListener'>): LastInput {
  let kind: InputKind = 'pointer';
  // Capturing, so that the answer is ready before any handler of the same event asks for it.
  target.addEventListener(
    'keydown',
    () => {
      kind = 'keyboard';
    },
    true,
  );
  target.addEventListener(
    'pointerdown',
    (event) => {
      kind = (event as PointerEvent).pointerType === 'touch' ? 'touch' : 'pointer';
    },
    true,
  );
  return { kind: () => kind };
}

/**
 * True when focus should rest on the picker's panel and not in its search field. A finger should not
 * raise the on-screen keyboard just to show the lists; a keyboard, on any device, is there to type.
 */
export function restsOnPanel(lastInput: InputKind, coarsePointer: boolean): boolean {
  return lastInput === 'touch' || (coarsePointer && lastInput !== 'keyboard');
}
