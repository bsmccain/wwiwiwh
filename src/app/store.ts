export type Listener<T> = (state: T, previous: T) => void;

export interface Store<T> {
  get(): T;
  /**
   * Shallow-merges a patch. Listeners run only if at least one field actually changed (Object.is).
   * A set made from inside a listener is applied after the current round of listeners, so every
   * listener sees every state, in order.
   */
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  /**
   * Runs `work` and tells listeners once, afterwards, about everything it set: use it when one action
   * changes several things that only make sense together.
   */
  transaction(work: () => void): void;
  /** Subscribes to every change. Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): () => void;
  /** Subscribes to one derived value; the listener runs only when that value changes (Object.is). */
  select<V>(selector: (state: T) => V, listener: (value: V, previous: V) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  /** States waiting to be announced: [state, the state before it]. */
  const pending: [T, T][] = [];
  let announcing = false;
  let transactionDepth = 0;
  let transactionStart: T | null = null;

  const announce = (): void => {
    if (announcing) return; // the round in progress will get to it
    announcing = true;
    try {
      for (let next = pending.shift(); next; next = pending.shift()) {
        for (const listener of [...listeners]) listener(next[0], next[1]);
      }
    } finally {
      announcing = false;
      pending.length = 0;
    }
  };

  const store: Store<T> = {
    get: () => state,
    set(patch) {
      const resolved = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(resolved) as (keyof T)[]) {
        if (!Object.is(state[key], resolved[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const previous = state;
      state = { ...state, ...resolved };
      if (transactionDepth > 0) return;
      pending.push([state, previous]);
      announce();
    },
    transaction(work) {
      if (transactionDepth === 0) transactionStart = state;
      transactionDepth++;
      try {
        work();
      } finally {
        transactionDepth--;
        if (transactionDepth === 0) {
          const start = transactionStart as T;
          transactionStart = null;
          if (state !== start) {
            pending.push([state, start]);
            announce();
          }
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(selector, listener) {
      return store.subscribe((next, previous) => {
        const a = selector(next);
        const b = selector(previous);
        if (!Object.is(a, b)) listener(a, b);
      });
    },
  };
  return store;
}
