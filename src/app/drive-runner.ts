import type { LngLat } from '../geo/types';
import type { DualMap } from '../map/contracts';
import { isBeyondReach, roundLimit, type ReachAnswer, type ReachLimit, type RoadService, type RouteAnswer } from '../routing/valhalla';
import { onOtherSheet, reachDetailMeters, reachLimitOf } from './drive';
import type { Store } from './store';
import type { AppState, Drive, ReachFinding, RouteFinding } from './types';

/*
 * Asks the road service about the drive on the map and keeps its answers in the state: first the
 * route between the drive's two ends, then how far the same time or distance gets on the other
 * place, from the spot the drive's start lands on there. That spot moves whenever Home is slid or
 * turned, so the reach is asked again each time Home comes to rest somewhere new.
 *
 * Manners for a free public server: one question at a time and never two within a second, nothing
 * asked twice, a stale question dropped the moment a newer one replaces it, and after a failure
 * nothing more until the person asks again.
 */

/** The server's terms allow one request a second. */
export const ASK_GAP_MS = 1100;
/** Home must have held still this long before the reach from its new position is asked for. */
export const REACH_QUIET_MS = 400;
/** Answers kept so that going back to a question already asked costs the server nothing. */
const MAX_REMEMBERED = 24;
/** Positions that write the same in a link are the same question. */
const KEY_DIGITS = 5;

const FINDING = { status: 'finding' } as const;
const UNAVAILABLE = { status: 'unavailable' } as const;
/** One object for every "beyond": while Home is slid under a long drive the answer is the same on every frame, and must not read as news. */
const BEYOND = { status: 'beyond' } as const;

export interface DriveRunner {
  /** Asks again whatever the service failed to answer. */
  retry(): void;
  destroy(): void;
}

function positionKey(at: LngLat): string {
  return `${at.lat.toFixed(KEY_DIGITS)},${at.lng.toFixed(KEY_DIGITS)}`;
}

/**
 * The road between two spots is the same road whichever sheet its place is on at the moment, so a
 * swap of the places asks nothing again.
 */
function routeKeyOf(drive: Drive): string {
  return `${positionKey(drive.from)}|${positionKey(drive.to)}`;
}

function reachKeyOf(from: LngLat, limit: ReachLimit, detailMeters: number): string {
  const amount = limit.by === 'time' ? `${limit.minutes}min` : `${limit.kilometres}km`;
  return `${positionKey(from)}|${amount}|${Math.round(detailMeters)}`;
}

function routeFinding(answer: RouteAnswer): RouteFinding {
  return answer.kind === 'found' ? { status: 'found', route: answer.route } : { status: answer.kind };
}

function reachFinding(answer: ReachAnswer): ReachFinding {
  return answer.kind === 'found' ? { status: 'found', outline: answer.outline } : { status: answer.kind };
}

/** A small memory of answers, oldest forgotten first. */
function remember<V>(memory: Map<string, V>, key: string, value: V): void {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MAX_REMEMBERED) memory.delete(memory.keys().next().value as string);
}

/** One question waiting to be asked, or being asked. */
interface Asking {
  readonly key: string;
  readonly abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createDriveRunner(deps: {
  store: Store<AppState>;
  dual: Pick<DualMap, 'getRegistration' | 'on'>;
  roads: RoadService;
  /** The clock, for spacing questions out. `Date.now` when left out. */
  now?: () => number;
}): DriveRunner {
  const { store, dual, roads } = deps;
  const now = deps.now ?? Date.now;
  const routes = new Map<string, RouteFinding>();
  const reaches = new Map<string, ReachFinding>();
  /** The questions the state's `route` and `reach` currently answer, or are waiting on. */
  let routeKey: string | null = null;
  let reachKey: string | null = null;
  let askingRoute: Asking | null = null;
  let askingReach: Asking | null = null;
  /** When the server was last asked anything. */
  let lastAskedAt = -Infinity;
  let destroyed = false;

  function drop(asking: Asking | null): void {
    if (!asking) return;
    if (asking.timer !== null) clearTimeout(asking.timer);
    asking.abort.abort();
  }

  /**
   * Puts a question to the server once `quietMs` has passed and the server has had its second of
   * rest, and hands the answer to `settle` unless the question was dropped meanwhile.
   */
  function ask<A>(key: string, quietMs: number, question: (signal: AbortSignal) => Promise<A>, settle: (answer: A | null) => void): Asking {
    const asking: Asking = { key, abort: new AbortController(), timer: null };
    const send = (): void => {
      const wait = lastAskedAt + ASK_GAP_MS - now();
      if (wait > 0) {
        // Another question went out in the meantime: this one takes its turn after it.
        asking.timer = setTimeout(send, wait);
        return;
      }
      asking.timer = null;
      lastAskedAt = now();
      question(asking.abort.signal).then(
        (answer) => {
          if (!asking.abort.signal.aborted) settle(answer);
        },
        () => {
          // Whatever went wrong, the person is told the same thing: it did not answer.
          if (!asking.abort.signal.aborted) settle(null);
        },
      );
    };
    asking.timer = setTimeout(send, Math.max(quietMs, lastAskedAt + ASK_GAP_MS - now(), 0));
    return asking;
  }

  function forgetReach(): void {
    drop(askingReach);
    askingReach = null;
    reachKey = null;
  }

  /** Brings `route` in step with the drive. Returns whether the route is there to match a reach to. */
  function syncRoute(drive: Drive | null): boolean {
    const wanted = drive ? routeKeyOf(drive) : null;
    if (wanted !== routeKey) {
      drop(askingRoute);
      askingRoute = null;
      forgetReach();
      routeKey = wanted;
      if (!drive || wanted === null) {
        store.set({ route: null, reach: null });
        return false;
      }
      const known = routes.get(wanted);
      store.set({ route: known ?? FINDING, reach: null });
      if (!known) {
        askingRoute = ask(
          wanted,
          0,
          (signal) => roads.route(drive.from, drive.to, signal),
          (answer) => {
            askingRoute = null;
            const finding = answer ? routeFinding(answer) : UNAVAILABLE;
            if (answer) remember(routes, wanted, finding);
            store.set({ route: finding });
          },
        );
      }
    }
    return store.get().route?.status === 'found';
  }

  /** Brings `reach` in step with the drive, its route and where Home lies. */
  function syncReach(drive: Drive, quietMs: number): void {
    const { route } = store.get();
    if (route?.status !== 'found') return;
    const from = onOtherSheet(dual.getRegistration(), drive.on, drive.from);
    const limit = roundLimit(reachLimitOf(route.route, drive.match));
    const detail = reachDetailMeters(route.route);
    const wanted = reachKeyOf(from, limit, detail);
    if (wanted === reachKey) return;
    forgetReach();
    reachKey = wanted;
    if (isBeyondReach(limit)) {
      store.set({ reach: BEYOND });
      return;
    }
    const known = reaches.get(wanted);
    store.set({ reach: known ?? FINDING });
    if (known) return;
    askingReach = ask(
      wanted,
      quietMs,
      (signal) => roads.reach(from, limit, detail, signal),
      (answer) => {
        askingReach = null;
        const finding = answer ? reachFinding(answer) : UNAVAILABLE;
        if (answer) remember(reaches, wanted, finding);
        store.set({ reach: finding });
      },
    );
  }

  function sync(quietMs = 0): void {
    if (destroyed) return;
    const { drive } = store.get();
    if (syncRoute(drive) && drive) syncReach(drive, quietMs);
    else if (drive && store.get().reach !== null) {
      // The route is being asked again, or came to nothing: there is nothing to match a reach to.
      forgetReach();
      store.set({ reach: null });
    }
  }

  let syncQueued = false;
  const cleanups = [
    store.subscribe((state, previous) => {
      if (state.drive !== previous.drive || state.route !== previous.route) sync();
    }),
    // Not at once: a registration that changes together with the places (a swap, a link) is reported
    // before the state has caught up, and one question about the half-changed picture would be wasted.
    dual.on('registrationchange', () => {
      if (syncQueued) return;
      syncQueued = true;
      queueMicrotask(() => {
        syncQueued = false;
        sync(REACH_QUIET_MS);
      });
    }),
  ];
  sync();

  return {
    retry() {
      const { route, reach } = store.get();
      if (route?.status === 'unavailable') routeKey = null;
      if (reach?.status === 'unavailable') reachKey = null;
      sync();
    },
    destroy() {
      destroyed = true;
      for (const cleanup of cleanups) cleanup();
      drop(askingRoute);
      drop(askingReach);
    },
  };
}
