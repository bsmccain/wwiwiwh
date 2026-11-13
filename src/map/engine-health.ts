import type { MapHealth, Sheet } from './contracts';

/**
 * What can be wrong with a sheet:
 *  - worker : the map worker did not load, so nothing the sheet asks of it is ever answered;
 *  - source : the description of the tile source (its TileJSON) did not load, so no tile can be asked for;
 *  - tiles  : some tiles did not load.
 * The first two leave the sheet with nothing to draw; the third leaves holes in it.
 */
export type Trouble = 'worker' | 'source' | 'tiles';

export const SHEETS: readonly Sheet[] = ['away', 'home'];

/** A MapLibre error event, reduced to what tells the troubles apart. */
export interface MapErrorLike {
  readonly error?: { readonly message?: string } | null;
  /** Present on errors raised while loading a tile. */
  readonly tile?: unknown;
  /** Present on errors raised by a source. Without a tile, it is the source's own description that failed. */
  readonly sourceId?: unknown;
}

/** Which trouble an error event from either map tells of, or null when it is not about loading at all. */
export function classifyMapError(event: MapErrorLike): Trouble | null {
  if (event.tile != null) return 'tiles';
  if (typeof event.sourceId === 'string') return 'source';
  if (/^Worker failed to load/.test(event.error?.message ?? '')) return 'worker';
  return null;
}

/** Pauses before the first automatic retries. After these, one retry a minute. */
const RETRY_AFTER_MS = [3_000, 8_000, 20_000, 45_000] as const;
const RETRY_EVERY_MS = 60_000;

/** How long to wait before the next automatic retry, given how many have been made since the maps were last well. */
export function retryDelay(retriesMade: number): number {
  return RETRY_AFTER_MS[retriesMade] ?? RETRY_EVERY_MS;
}

export type Troubles = Readonly<Record<Sheet, ReadonlySet<Trouble>>>;

export function healthOf(troubles: Troubles): MapHealth {
  const sheets = SHEETS.filter((sheet) => troubles[sheet].size > 0);
  if (sheets.length === 0) return { state: 'ok', sheets };
  const down = sheets.some((sheet) => troubles[sheet].has('worker') || troubles[sheet].has('source'));
  return { state: down ? 'down' : 'degraded', sheets };
}

function sameHealth(a: MapHealth, b: MapHealth): boolean {
  return a.state === b.state && a.sheets.length === b.sheets.length && a.sheets.every((sheet, i) => sheet === b.sheets[i]);
}

export interface HealthTrackerOptions {
  /** Asks the maps to load again whatever these troubles left missing. The outcome comes back through `report` and `resolve`. */
  readonly recover: (troubles: Troubles) => void;
  /** Called whenever the health changes. */
  readonly onChange: (health: MapHealth) => void;
  /** Runs `callback` after `ms`. Returns a function that calls it off. */
  readonly schedule?: (callback: () => void, ms: number) => () => void;
}

export interface HealthTracker {
  getHealth(): MapHealth;
  /** A sheet has this trouble (again). */
  report(sheet: Sheet, trouble: Trouble): void;
  /** A sheet is over this trouble. */
  resolve(sheet: Sheet, trouble: Trouble): void;
  /** Retries now instead of waiting for the next automatic try. Does nothing when all is well or a try is still out. */
  retryNow(): void;
  /** Calls off any retry still to come. */
  stop(): void;
}

function afterTimeout(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
}

/**
 * Keeps the troubles of both sheets and decides when to try again.
 *
 * While anything is wrong a retry is always on its way: 3s after the first failure, then 8s, 20s and
 * 45s after the retry before, then every minute. A retry is "out" until it is answered, by a new
 * failure or by everything coming right, and no other is started on request meanwhile. A failure
 * never starts a retry by itself, so a service that fails at once cannot be hammered.
 */
export function createHealthTracker(options: HealthTrackerOptions): HealthTracker {
  const schedule = options.schedule ?? afterTimeout;
  const troubles: Record<Sheet, Set<Trouble>> = { away: new Set(), home: new Set() };
  let published = healthOf(troubles);
  let retriesMade = 0;
  let retryIsOut = false;
  let callOffRetry: (() => void) | null = null;
  let stopped = false;

  function publish(): void {
    const health = healthOf(troubles);
    if (sameHealth(health, published)) return;
    published = health;
    options.onChange(health);
  }

  function retryIn(ms: number): void {
    callOffRetry?.();
    callOffRetry = schedule(() => {
      retriesMade++;
      retry();
    }, ms);
  }

  function retry(): void {
    retryIsOut = true;
    // The next one is lined up first: `recover` may be answered before it returns.
    retryIn(retryDelay(retriesMade));
    options.recover(troubles);
  }

  return {
    getHealth: () => published,

    report(sheet, trouble) {
      if (stopped) return;
      troubles[sheet].add(trouble);
      retryIsOut = false;
      if (!callOffRetry) retryIn(retryDelay(retriesMade));
      publish();
    },

    resolve(sheet, trouble) {
      if (stopped || !troubles[sheet].delete(trouble)) return;
      if (healthOf(troubles).state === 'ok') {
        callOffRetry?.();
        callOffRetry = null;
        retriesMade = 0;
        retryIsOut = false;
      }
      publish();
    },

    retryNow() {
      if (stopped || published.state === 'ok' || retryIsOut) return;
      retry();
    },

    stop() {
      stopped = true;
      callOffRetry?.();
      callOffRetry = null;
    },
  };
}
