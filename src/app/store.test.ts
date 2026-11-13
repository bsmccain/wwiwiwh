import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('store', () => {
  it('merges patches and tells listeners only about real changes', () => {
    const store = createStore({ a: 1, b: 'x' });
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ a: 1 });
    expect(seen).not.toHaveBeenCalled();
    store.set({ a: 2 });
    store.set((s) => ({ b: s.b + 'y' }));
    expect(seen.mock.calls).toEqual([
      [{ a: 2, b: 'x' }, { a: 1, b: 'x' }],
      [{ a: 2, b: 'xy' }, { a: 2, b: 'x' }],
    ]);
  });

  it('selects one value', () => {
    const store = createStore({ a: 1, b: 1 });
    const seen = vi.fn();
    const stop = store.select((s) => s.a, seen);
    store.set({ b: 2 });
    store.set({ a: 5 });
    stop();
    store.set({ a: 6 });
    expect(seen.mock.calls).toEqual([[5, 1]]);
  });

  it('shows every listener every state in order, even when a listener sets', () => {
    const store = createStore({ n: 0, echo: 0 });
    const first: number[] = [];
    const second: number[] = [];
    store.subscribe((s) => {
      first.push(s.n * 10 + s.echo);
      if (s.n === 1 && s.echo === 0) store.set({ echo: 1 });
    });
    store.subscribe((s) => second.push(s.n * 10 + s.echo));
    store.set({ n: 1 });
    // Without ordering, the second listener would hear 11 before 10.
    expect(first).toEqual([10, 11]);
    expect(second).toEqual([10, 11]);
  });

  it('announces a transaction once, with the state from before it', () => {
    const store = createStore({ a: 1, b: 1 });
    const seen = vi.fn();
    store.subscribe(seen);
    store.transaction(() => {
      store.set({ a: 2 });
      expect(store.get().a).toBe(2);
      store.transaction(() => store.set({ b: 2 }));
      expect(seen).not.toHaveBeenCalled();
    });
    expect(seen.mock.calls).toEqual([[{ a: 2, b: 2 }, { a: 1, b: 1 }]]);
    store.transaction(() => store.set({ a: 2 }));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('still announces what a transaction set before it threw', () => {
    const store = createStore({ a: 1 });
    const seen = vi.fn();
    store.subscribe(seen);
    expect(() =>
      store.transaction(() => {
        store.set({ a: 2 });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(seen).toHaveBeenCalledTimes(1);
    store.set({ a: 3 });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
