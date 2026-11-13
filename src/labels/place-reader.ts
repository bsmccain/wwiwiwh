import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';
import { SOURCE_ID, type DualMap, type Sheet } from '../map/contracts';
import { PlaceBook, type PlaceCandidate } from './candidates';
import { shownTiles } from './tile-places';

export interface PlaceReaderOptions {
  readonly dual: Pick<DualMap, 'base' | 'overlay' | 'on'>;
  /** Whether the picture is in motion. The places are brought up to date less often while it is. */
  readonly isMoving: () => boolean;
  /** Called after the reader brought the places up to date off its own timer, whether or not they changed. */
  readonly onRead: () => void;
  /** The clock tiles are read against, in milliseconds. Defaults to `performance.now`. */
  readonly now?: () => number;
}

/** Keeps the places of both sheets in step with the tiles their maps are showing. */
export interface PlaceReader {
  readonly books: Readonly<Record<Sheet, PlaceBook>>;
  /**
   * Whether the places in hand for a sheet are all there is to know for the current view: brought
   * up to date after its tiles were all in, with nothing new since.
   */
  isComplete(sheet: Sheet): boolean;
  /**
   * For when both maps have all their tiles and have drawn them (`idle`). The places are brought up
   * to date at once, unless Home is being moved and tiles are still to be read: then those are read
   * first, a slice at a time, and `onRead` follows. Returns whether the places are up to date on return.
   */
  readAtIdle(): boolean;
  /** Subscribes to changes in what is known about either sheet. Returns a function that unsubscribes. */
  onChange(listener: () => void): () => void;
  destroy(): void;
}

const SHEETS: readonly Sheet[] = ['home', 'away'];

/**
 * A tile is read once, after it has arrived. Reading one decodes every place it carries: a fraction of
 * a millisecond for most tiles, up to about 8 ms for one over the middle of a big city. So tiles are
 * read a slice at a time: once a slice has taken this long no further tile is started in it, which
 * makes a slice one big tile or a handful of small ones and leaves the frames of a drag alone.
 */
const SLICE_BUDGET_MS = 1;
/** The pause between two slices: room for the maps to draw a frame or two. */
const SLICE_GAP_MS = 32;
/**
 * New places put new names on the plate. So the places are brought up to date once a sheet's tiles
 * are all in, or this often while they keep coming.
 */
const UPDATE_INTERVAL_MS = 1500;
/**
 * In motion they are left alone for longer still. Tiles carry the places of their neighbours too,
 * so a pan of a tile's width brings nothing new; the wait only shows on a drag that goes on and on.
 */
const UPDATE_INTERVAL_MOVING_MS = 2500;
/** How soon after a change new tiles are looked for, and how often an update that is waiting is looked at again. */
const CHECK_MS = 250;

/**
 * Reads the `place` layer of the tiles each map is showing into a `PlaceBook` per sheet. Each tile is
 * read once, soon after it arrives; which tiles are on show is settled when the pair comes to rest,
 * and now and then while tiles stream in. Never per frame.
 */
export function createPlaceReader(options: PlaceReaderOptions): PlaceReader {
  const { dual, isMoving, onRead } = options;
  const now = options.now ?? (() => performance.now());
  const books: Readonly<Record<Sheet, PlaceBook>> = { home: new PlaceBook(), away: new PlaceBook() };
  const mapOf = (sheet: Sheet): MapLibreMap => (sheet === 'home' ? dual.overlay : dual.base);
  const listeners = new Set<() => void>();

  /** What each tile read so far carries, by the tile's data, for as long as its map keeps that. */
  const read: Readonly<Record<Sheet, WeakMap<object, readonly PlaceCandidate[]>>> = {
    home: new WeakMap(),
    away: new WeakMap(),
  };
  /** Whether a sheet may be showing other tiles than its live places were taken from. */
  const stale: Record<Sheet, boolean> = { home: true, away: true };
  /** Whether a sheet's tiles were still arriving when its places were last brought up to date. */
  const partial: Record<Sheet, boolean> = { home: true, away: true };
  /** Both maps have everything they asked for, and nothing has moved or arrived since. */
  let resting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastUpdateAt = -Infinity;
  let destroyed = false;

  /**
   * Reads tiles on show that have not been read yet, starting no further tile once the time is up.
   * Returns how many it read: none means there was none left to read.
   */
  function readTiles(budgetMs: number): number {
    const startedAt = now();
    let tilesRead = 0;
    for (const sheet of SHEETS) {
      if (!stale[sheet]) continue;
      for (const tile of shownTiles(mapOf(sheet))) {
        if (read[sheet].has(tile.data)) continue;
        if (tilesRead > 0 && now() - startedAt >= budgetMs) return tilesRead;
        read[sheet].set(tile.data, books[sheet].enter(tile.places()));
        tilesRead++;
      }
    }
    return tilesRead;
  }

  /** Makes the places of the tiles on show the live ones. Every one of those tiles must have been read. */
  function update(): void {
    let changed = false;
    for (const sheet of SHEETS) {
      if (!stale[sheet]) continue;
      const map = mapOf(sheet);
      const tiles: (readonly PlaceCandidate[])[] = [];
      for (const tile of shownTiles(map)) {
        const places = read[sheet].get(tile.data);
        if (places && places.length > 0) tiles.push(places);
      }
      // Nothing while the map is still loading (at the start, or with a style being swapped) is not news.
      if (tiles.length === 0 && !map.loaded()) continue;
      stale[sheet] = false;
      partial[sheet] = !map.loaded();
      if (books[sheet].show(tiles)) changed = true;
    }
    // At rest what has been read is all there is.
    if (resting) for (const sheet of SHEETS) partial[sheet] = stale[sheet];
    lastUpdateAt = now();
    if (!changed) return;
    for (const listener of [...listeners]) listener();
  }

  function isDue(): boolean {
    if (resting) return true;
    const waited = now() - lastUpdateAt;
    if (isMoving()) return waited >= UPDATE_INTERVAL_MOVING_MS;
    return waited >= UPDATE_INTERVAL_MS || SHEETS.every((sheet) => !stale[sheet] || mapOf(sheet).areTilesLoaded());
  }

  function schedule(delayMs: number): void {
    if (timer !== null || destroyed) return;
    timer = setTimeout(step, delayMs);
  }

  function step(): void {
    timer = null;
    if (!stale.home && !stale.away) return;
    // The update that follows the last tile is a task of its own, so no task does both.
    if (readTiles(SLICE_BUDGET_MS) > 0) schedule(SLICE_GAP_MS);
    else if (!isDue()) schedule(CHECK_MS);
    else {
      update();
      onRead();
    }
  }

  function tilesMayHaveChanged(sheet: Sheet): void {
    stale[sheet] = true;
    resting = false;
    schedule(CHECK_MS);
  }

  const onSourceData = (sheet: Sheet) => (event: MapSourceDataEvent) => {
    if (event.sourceId === SOURCE_ID && event.tile) tilesMayHaveChanged(sheet);
  };
  const onHomeSourceData = onSourceData('home');
  const onAwaySourceData = onSourceData('away');
  dual.overlay.on('sourcedata', onHomeSourceData);
  dual.base.on('sourcedata', onAwaySourceData);
  // A move can bring tiles back from a map's cache, which it does without a `sourcedata`.
  const stopWatchingFrames = dual.on('frame', () => {
    for (const sheet of SHEETS) tilesMayHaveChanged(sheet);
  });

  // The pair may already be showing tiles.
  readTiles(Infinity);
  update();

  return {
    books,
    isComplete: (sheet) => !stale[sheet] && !partial[sheet],
    readAtIdle() {
      if (destroyed) return true;
      resting = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // With nothing in motion a longer task costs no frame, and the names come at once.
      const moving = isMoving();
      if (readTiles(moving ? SLICE_BUDGET_MS : Infinity) > 0 && moving) {
        schedule(SLICE_GAP_MS);
        return false;
      }
      update();
      return true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      dual.overlay.off('sourcedata', onHomeSourceData);
      dual.base.off('sourcedata', onAwaySourceData);
      stopWatchingFrames();
      listeners.clear();
    },
  };
}
