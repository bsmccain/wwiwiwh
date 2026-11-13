import { isTurned, turnWords, turnWordsSpoken, type Span, type Spot } from '../app/readout';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { DualMap, Sheet } from '../map/contracts';
import { pinSpans, pinSpot, sameSpans, sameWords, tripSpans, type NearestLookup, type Scene } from './sentences';
import { throttle } from './throttle';

/** While Home or a trip end is being dragged, the sentences are reworded at most this often. */
const REWORD_INTERVAL_MS = 250;

export interface TurnReadout {
  /** Home is turned at all, however slightly. */
  readonly turned: boolean;
  /** "Home is turned 28° right." */
  readonly shown: string;
  /** The same for screen readers: "Home is turned 28 degrees clockwise." */
  readonly spoken: string;
}

export interface Readouts {
  /** Where the pin sits on both places, or null until both spots can be named. */
  pin(): readonly Span[] | null;
  /** How the spot under the pin on one sheet is referred to, or null while nothing is known about it. */
  pinSpot(sheet: Sheet): Spot | null;
  /** The trip's length and where it runs on both places, or null without a trip. */
  trip(): readonly Span[] | null;
  /** The same in as few words as possible, for narrow screens. */
  tripInShort(): readonly Span[] | null;
  turn(): TurnReadout;
  /** Calls back when any of the wordings has changed. Returns a function that stops the calls. */
  onChange(listener: () => void): () => void;
}

function turnReadout(rotation: number): TurnReadout {
  return { turned: isTurned(rotation), shown: `Home is ${turnWords(rotation)}.`, spoken: `Home is ${turnWordsSpoken(rotation)}.` };
}

/**
 * Keeps the sentences about the pin, the trip and the turn in step with the maps. They are reworded
 * at once when something settles (a place is picked, a slide ends, the units change) and a few times
 * a second while Home is on the move.
 */
export function createReadouts(deps: {
  store: Store<AppState>;
  dual: DualMap;
  nearest: NearestLookup;
  /** Subscribes to new place names becoming known (the type plate's `onPlacesChange`). */
  onPlacesChange: (listener: () => void) => unknown;
}): Readouts {
  const { store, dual, nearest } = deps;
  const listeners = new Set<() => void>();

  const scene = (): Scene => {
    const { home, away, spots, trip, units } = store.get();
    return { home, away, spots, trip, units, registration: dual.getRegistration() };
  };
  const word = (now: Scene) => ({
    pin: pinSpans(now, nearest),
    home: pinSpot(now, 'home', nearest),
    away: pinSpot(now, 'away', nearest),
    trip: tripSpans(now, nearest),
    tripInShort: tripSpans(now, nearest, true),
    turn: turnReadout(now.registration.rotation),
  });

  let worded = word(scene());

  const reword = (): void => {
    const next = word(scene());
    const same =
      sameSpans(next.pin, worded.pin) &&
      sameWords(next.home, worded.home) &&
      sameWords(next.away, worded.away) &&
      sameSpans(next.trip, worded.trip) &&
      sameSpans(next.tripInShort, worded.tripInShort) &&
      next.turn.shown === worded.turn.shown &&
      next.turn.turned === worded.turn.turned;
    if (same) return;
    worded = next;
    for (const listener of [...listeners]) listener();
  };
  const rewording = throttle(reword, REWORD_INTERVAL_MS);

  store.subscribe((state, previous) => {
    const renamed = state.home !== previous.home || state.away !== previous.away || state.spots !== previous.spots;
    if (renamed || state.units !== previous.units) rewording.flush();
    // A trip end being dragged rewrites the trip on every pointer move.
    else if (state.trip !== previous.trip) rewording.request();
  });
  dual.on('registrationchange', ({ final }) => {
    if (final) rewording.flush();
    else rewording.request();
  });
  deps.onPlacesChange(() => rewording.request());

  return {
    pin: () => worded.pin,
    pinSpot: (sheet) => worded[sheet],
    trip: () => worded.trip,
    tripInShort: () => worded.tripInShort,
    turn: () => worded.turn,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
