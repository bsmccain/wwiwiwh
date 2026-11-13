import { getGlobalDispatcher, VectorTileSource } from 'maplibre-gl';
import type { MapLibreMap, Tile } from 'maplibre-gl';
import { SOURCE_ID, type MapHealth, type Sheet } from './contracts';
import { classifyMapError, createHealthTracker, SHEETS, type MapErrorLike, type Troubles } from './engine-health';

/** How long restarted workers get to answer before they count as still not there. They have a script to load first. */
const WORKERS_ANSWER_WITHIN_MS = 5_000;

interface SourceDataLike {
  readonly sourceId?: string;
  readonly sourceDataType?: string;
}

export interface MapRecovery {
  getHealth(): MapHealth;
  /** Tries now to load whatever failed, instead of waiting for the next automatic try. */
  retry(): void;
  /** Takes an `error` event of a sheet's map. False when the error is not about loading, and so not dealt with here. */
  error(sheet: Sheet, event: MapErrorLike): boolean;
  /** Takes a `sourcedata` event of a sheet's map. */
  sourceData(sheet: Sheet, event: SourceDataLike): void;
  /** A sheet's map went idle: every tile it asked for has loaded or failed. */
  idle(sheet: Sheet): void;
  destroy(): void;
}

function isTile(value: unknown): value is Tile {
  return typeof value === 'object' && value !== null && 'state' in value && 'tileID' in value;
}

/**
 * Follows what fails to load on the two maps and loads it again: on a growing pause (see
 * `createHealthTracker`), at once when the browser comes back online, and at once on `retry()`.
 *
 * Each trouble is mended with the gentlest call that works on MapLibre 6, so a sheet that is mostly
 * drawn is never blanked to fetch the rest:
 *  - failed tiles are refreshed by name. (Refreshing the whole source instead leaves the failed ones
 *    waiting for a load that never comes.)
 *  - a source whose TileJSON failed is loaded again; its tiles follow by themselves.
 *  - workers that do not answer are restarted; MapLibre then rebuilds both maps' styles and tiles.
 * MapLibre draws lettering whose glyphs failed with local type and raises no error, so there is
 * nothing to follow or mend there.
 */
export function watchMapHealth(maps: Readonly<Record<Sheet, MapLibreMap>>, onChange: (health: MapHealth) => void): MapRecovery {
  const failedTiles: Record<Sheet, Set<Tile>> = { away: new Set(), home: new Set() };

  const tracker = createHealthTracker({ recover, onChange });

  /** The failed tiles the sheet still holds as failed. One that loaded since, or left the view, no longer counts. */
  function stillFailed(sheet: Sheet): Tile[] {
    const failed = failedTiles[sheet];
    for (const tile of failed) {
      if (tile.state !== 'errored') failed.delete(tile);
    }
    return [...failed];
  }

  function reloadFailedTiles(sheet: Sheet): void {
    const failed = stillFailed(sheet);
    if (failed.length === 0) tracker.resolve(sheet, 'tiles');
    else maps[sheet].refreshTiles(SOURCE_ID, failed.map((tile) => tile.tileID.canonical));
  }

  async function reviveWorkers(): Promise<void> {
    const dispatcher = getGlobalDispatcher();
    try {
      await dispatcher.ensureWorkers();
      if (!(await dispatcher.ping(WORKERS_ANSWER_WITHIN_MS))) return;
    } catch {
      // Still no workers; the next retry tries again.
      return;
    }
    for (const sheet of SHEETS) tracker.resolve(sheet, 'worker');
  }

  function recover(troubles: Troubles): void {
    if (SHEETS.some((sheet) => troubles[sheet].has('worker'))) {
      // Nothing else can load until the workers are back, and then everything is loaded afresh.
      void reviveWorkers();
      return;
    }
    for (const sheet of SHEETS) {
      const map = maps[sheet];
      // Between losing its WebGL context and getting it back a map has no style, and then loads everything again itself.
      const source = map.style ? map.getSource(SOURCE_ID) : undefined;
      if (!(source instanceof VectorTileSource)) continue;
      if (troubles[sheet].has('source')) void source.load();
      if (troubles[sheet].has('tiles')) reloadFailedTiles(sheet);
    }
  }

  const onOnline = (): void => tracker.retryNow();
  window.addEventListener('online', onOnline);

  return {
    getHealth: () => tracker.getHealth(),
    retry: () => tracker.retryNow(),

    error(sheet, event) {
      const trouble = classifyMapError(event);
      if (!trouble) return false;
      if (trouble === 'tiles' && isTile(event.tile)) failedTiles[sheet].add(event.tile);
      tracker.report(sheet, trouble);
      return true;
    },

    sourceData(sheet, event) {
      if (event.sourceId === SOURCE_ID && event.sourceDataType === 'metadata') tracker.resolve(sheet, 'source');
    },

    idle(sheet) {
      if (stillFailed(sheet).length === 0) tracker.resolve(sheet, 'tiles');
    },

    destroy() {
      tracker.stop();
      window.removeEventListener('online', onOnline);
    },
  };
}
