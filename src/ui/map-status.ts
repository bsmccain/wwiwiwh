import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import type { DualMap, MapHealthState } from '../map/contracts';
import type { StageNote } from './stage';

/** A place change that is drawn sooner than this never shows its "Drawing…" note. */
const DRAWING_NOTE_DELAY_MS = 400;

const STATUS_COPY = {
  down: "Can't reach the map service. Trying again…",
  degraded: "Parts of the map didn't load. Trying again…",
} as const;

/**
 * The one standing note about the maps themselves. A failure outranks "still drawing": while the
 * map service is out of reach nothing is being drawn, and the loading note must not outlive that.
 * The notes never name a sheet, because either or both may be affected.
 */
export function statusNote(health: MapHealthState, drawing: string | null, retry: () => void): StageNote | null {
  if (health === 'down') return { tone: 'down', text: STATUS_COPY.down, onRetry: retry };
  if (health === 'degraded') return { tone: 'degraded', text: STATUS_COPY.degraded, onRetry: retry };
  return drawing === null ? null : { tone: 'loading', text: `Drawing ${drawing}…` };
}

/**
 * Keeps the stage's standing note in step with the maps: "Drawing {place}…" from the start and from
 * each change of place until the view is drawn, and the failure notes for as long as the maps say
 * they are not well.
 *
 * `onDrawing(true)` is called when a view starts being drawn and `onDrawing(false)` when it is drawn
 * or has plainly failed to be. `onFirstOutcome` is called once, at the first of those two ends.
 */
export function keepStatusNote(deps: {
  store: Store<AppState>;
  dual: DualMap;
  setNote: (note: StageNote | null) => void;
  onDrawing: (drawing: boolean) => void;
  onFirstOutcome: () => void;
}): void {
  const { store, dual } = deps;
  /** The place whose map is being drawn, once that has taken long enough to mention. */
  let drawing: string | null = store.get().away.name;
  let mention: ReturnType<typeof setTimeout> | null = null;
  let firstOutcomeDue = true;

  const show = (): void => deps.setNote(statusNote(dual.getHealth().state, drawing, () => dual.retry()));
  const stopDrawing = (): void => {
    if (mention !== null) clearTimeout(mention);
    mention = null;
    drawing = null;
    deps.onDrawing(false);
  };
  const firstOutcome = (): void => {
    if (!firstOutcomeDue) return;
    firstOutcomeDue = false;
    deps.onFirstOutcome();
  };

  store.subscribe((state, previous) => {
    const changed = state.away !== previous.away ? state.away : state.home !== previous.home ? state.home : null;
    if (!changed) return;
    stopDrawing();
    deps.onDrawing(true);
    mention = setTimeout(() => {
      drawing = changed.name;
      show();
    }, DRAWING_NOTE_DELAY_MS);
  });
  dual.on('idle', () => {
    stopDrawing();
    show();
    firstOutcome();
  });
  dual.on('health', ({ state }) => {
    // With the map service out of reach nothing is being drawn; whoever waits for the drawing is let go.
    if (state === 'down') {
      deps.onDrawing(false);
      firstOutcome();
    }
    show();
  });
  // Moving the map during an outage is asking for it again: no need to wait for the next automatic try.
  dual.on('viewchange', ({ byUser }) => {
    if (byUser && dual.getHealth().state !== 'ok') dual.retry();
  });

  deps.onDrawing(true);
  show();
}
