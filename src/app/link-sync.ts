import type { Controller } from './controller';
import type { Store } from './store';
import type { AppState, LinkState } from './types';
import { decodeLink, encodeLink } from './url';

/** How long the picture must hold still before the address is rewritten. */
const SETTLE_MS = 300;

/** The browser's address bar and history, narrowed to what link syncing needs (and faked in tests). */
export interface AddressBar {
  hash(): string;
  /** Adds a history entry, so Back returns to the previous pair of places. */
  push(hash: string): void;
  /** Rewrites the current entry in place, so moving the map never floods the history. */
  replace(hash: string): void;
  /** Calls back when the person navigates (Back/Forward, or edits the hash by hand). */
  onNavigate(listener: () => void): () => void;
}

export function browserAddressBar(win: Window = window): AddressBar {
  const url = (hash: string) => `${win.location.pathname}${win.location.search}#${hash}`;
  return {
    hash: () => win.location.hash,
    push: (hash) => win.history.pushState(null, '', url(hash)),
    replace: (hash) => win.history.replaceState(null, '', url(hash)),
    onNavigate(listener) {
      win.addEventListener('popstate', listener);
      win.addEventListener('hashchange', listener);
      return () => {
        win.removeEventListener('popstate', listener);
        win.removeEventListener('hashchange', listener);
      };
    },
  };
}

export interface LinkSync {
  /** Writes any pending change to the address now. */
  flush(): void;
  /** Rewrites the address to describe what is on screen, e.g. after opening a link that was only partly understood. */
  repair(): void;
  destroy(): void;
}

function linkOf(state: AppState): LinkState {
  return {
    home: state.home,
    away: state.away,
    reg: state.reg,
    spots: state.spots,
    view: state.view,
    trip: state.trip,
    rings: state.rings,
  };
}

/**
 * Keeps the address bar describing what is on screen, and the screen following the address bar.
 *
 * - Choosing or swapping places adds a history entry.
 * - Everything else (moving the map, sliding or turning Home, the trip, rings) rewrites the current
 *   entry once things have settled.
 * - Nothing is written until the person changes something, so a bare address stays bare.
 */
export function createLinkSync(deps: {
  store: Store<AppState>;
  controller: Pick<Controller, 'applyLink'>;
  address: AddressBar;
  /** Called when a navigated-to address could not be fully understood. */
  onIncomplete?: () => void;
}): LinkSync {
  const { store, controller, address } = deps;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The state waiting to be written when the timer fires. */
  let waiting: AppState | null = null;
  let applying = false;
  let lastWritten: string | null = null;

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    waiting = null;
  };

  const write = (kind: 'push' | 'replace', state: AppState) => {
    const hash = encodeLink(linkOf(state));
    if (hash === lastWritten && kind === 'replace') return;
    lastWritten = hash;
    if (kind === 'push') address.push(hash);
    else address.replace(hash);
  };

  const flush = () => {
    const state = waiting;
    cancelTimer();
    if (state) write('replace', state);
  };

  const unsubscribe = store.subscribe((next, previous) => {
    if (applying) return;
    if (next.home !== previous.home || next.away !== previous.away) {
      // The entry being left keeps the last thing done to it, however recently.
      if (waiting) write('replace', previous);
      cancelTimer();
      write('push', next);
    } else if (
      next.reg !== previous.reg ||
      next.spots !== previous.spots ||
      next.trip !== previous.trip ||
      next.rings !== previous.rings ||
      next.view !== previous.view
    ) {
      if (timer !== null) clearTimeout(timer);
      waiting = next;
      timer = setTimeout(flush, SETTLE_MS);
    }
  });

  const stopListening = address.onNavigate(() => {
    const raw = address.hash().replace(/^#/, '');
    if (raw === lastWritten) return; // our own write echoing back as a hashchange
    cancelTimer();
    const { state, incomplete } = decodeLink(raw);
    applying = true;
    try {
      controller.applyLink(state);
    } finally {
      applying = false;
    }
    lastWritten = raw;
    if (incomplete) {
      write('replace', store.get());
      deps.onIncomplete?.();
    }
  });

  return {
    flush,
    repair() {
      cancelTimer();
      write('replace', store.get());
    },
    destroy() {
      cancelTimer();
      unsubscribe();
      stopListening();
    },
  };
}
