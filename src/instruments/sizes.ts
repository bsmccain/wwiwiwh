export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The sizes of drawn elements as the browser laid them out, learned by watching rather than asking:
 * asking in the middle of a map frame would force a layout there.
 */
export interface Sizes {
  watch(element: Element): void;
  /** The element's border box as it was last laid out while showing, or null before it ever was. */
  of(element: Element): BoxSize | null;
  destroy(): void;
}

/** `onChange` is called when a watched element turns out to have a size other than the one known. */
export function watchSizes(onChange: () => void): Sizes {
  const known = new WeakMap<Element, BoxSize>();
  const observer = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const box = entry.borderBoxSize[0];
      // A hidden element reports no size; the one it had is what it will have when it shows again.
      if (!box || box.inlineSize === 0 || box.blockSize === 0) continue;
      const before = known.get(entry.target);
      if (before?.width === box.inlineSize && before.height === box.blockSize) continue;
      known.set(entry.target, { width: box.inlineSize, height: box.blockSize });
      changed = true;
    }
    if (changed) onChange();
  });

  return {
    watch: (element) => observer.observe(element, { box: 'border-box' }),
    of: (element) => known.get(element) ?? null,
    destroy: () => observer.disconnect(),
  };
}
