/**
 * What is open over the page: the place picker, the More menu, a dialog. While any of them is open
 * it owns the keyboard, and the notes on the map step aside. Navigating away closes them all.
 */
export interface Overlays {
  /**
   * Notes that something has opened. `close` is how to shut it from outside; the returned function
   * must be called once it has closed, however that came about.
   */
  opened(close: () => void): () => void;
  isOpen(): boolean;
  closeAll(): void;
  /** Calls back when the first overlay opens and when the last one closes. */
  onChange(listener: (open: boolean) => void): void;
}

export function createOverlays(): Overlays {
  const open = new Set<() => void>();
  const listeners: ((open: boolean) => void)[] = [];
  const tell = (): void => {
    for (const listener of listeners) listener(open.size > 0);
  };

  return {
    opened(close) {
      open.add(close);
      if (open.size === 1) tell();
      return () => {
        if (open.delete(close) && open.size === 0) tell();
      };
    },
    isOpen: () => open.size > 0,
    closeAll() {
      for (const close of [...open]) close();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
