type Listener<Event> = (event: Event) => void;

export interface Emitter<Events> {
  /** Subscribes. Returns a function that unsubscribes. */
  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void;
  emit<K extends keyof Events>(type: K, event: Events[K]): void;
  /** Drops every listener. */
  clear(): void;
}

/**
 * Hands an error to the page as an uncaught one (the console, `window.onerror`) without unwinding
 * whoever is running now.
 */
function surfaceError(error: unknown): void {
  if (typeof reportError === 'function') {
    reportError(error);
    return;
  }
  setTimeout(() => {
    throw error;
  });
}

/**
 * A minimal typed event emitter. Listeners run synchronously, in the order they subscribed.
 *
 * A listener that throws stops nothing: the others still hear the event and the code that emitted
 * it carries on, so a gesture can always end and a frame can always be drawn. The error is handed to
 * `surface`, which by default reports it as an uncaught one.
 */
export function createEmitter<Events>(surface: (error: unknown) => void = surfaceError): Emitter<Events> {
  const listeners = new Map<keyof Events, Set<Listener<never>>>();
  return {
    on(type, listener) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    emit<K extends keyof Events>(type: K, event: Events[K]) {
      const set = listeners.get(type);
      if (!set) return;
      // Copied first, so a listener may unsubscribe (itself or another) while the event is delivered.
      for (const listener of [...set]) {
        if (!set.has(listener)) continue;
        try {
          (listener as Listener<Events[K]>)(event);
        } catch (error) {
          surface(error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
