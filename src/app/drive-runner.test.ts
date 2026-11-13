import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { distanceMeters } from '../geo/distance';
import { overlayToBase, swapRegistration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { ReachAnswer, ReachLimit, RoadService, RouteAnswer } from '../routing/valhalla';
import { defaultLinkState } from './defaults';
import { ASK_GAP_MS, createDriveRunner, REACH_QUIET_MS } from './drive-runner';
import { createStore, type Store } from './store';
import { FakeDualMap } from './testing/fake-dual';
import type { AppState, Drive } from './types';

const PALO_ALTO = { lat: 37.4419, lng: -122.143 };
const SAN_JOSE = { lat: 37.3382, lng: -121.8863 };
const HEATHROW = { lat: 51.47, lng: -0.4543 };
const ROUTE = { meters: 27_963, seconds: 1338, line: [PALO_ALTO, SAN_JOSE] };
const OUTLINE = [[[PALO_ALTO, SAN_JOSE, HEATHROW, PALO_ALTO]]];
const drive: Drive = { on: 'home', from: PALO_ALTO, to: SAN_JOSE, match: 'time' };

/** One question the road service was asked, and the means to answer it. */
interface Asked<Q, A> {
  readonly question: Q;
  readonly signal: AbortSignal;
  answer(answer: A): Promise<void>;
  fail(): Promise<void>;
}

/** A road service that answers when the test says so. */
function fakeRoads() {
  const routes: Asked<{ from: LngLat; to: LngLat }, RouteAnswer>[] = [];
  const reaches: Asked<{ from: LngLat; limit: ReachLimit; detail: number }, ReachAnswer>[] = [];
  const asked = <Q, A>(list: Asked<Q, A>[], question: Q, signal: AbortSignal): Promise<A> =>
    new Promise<A>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
      list.push({
        question,
        signal,
        // Whoever awaits the answer has heard it once the microtasks have run.
        answer: async (answer) => {
          resolve(answer);
          await Promise.resolve();
          await Promise.resolve();
        },
        fail: async () => {
          reject(new Error('unavailable'));
          await Promise.resolve();
          await Promise.resolve();
        },
      });
    });
  const roads: RoadService = {
    route: (from, to, signal) => asked(routes, { from, to }, signal),
    reach: (from, limit, detail, signal) => asked(reaches, { from, limit, detail }, signal),
  };
  return { roads, routes, reaches };
}

function setup(withDrive: Drive | null = null) {
  const link = defaultLinkState();
  const store: Store<AppState> = createStore<AppState>({
    ...link,
    trip: null,
    drive: withDrive,
    mode: 'browse',
    tripDraft: null,
    driveSide: 'home',
    driveDraft: null,
    route: null,
    reach: null,
    homeHidden: false,
    units: 'mi',
    themeChoice: 'auto',
    theme: 'light',
    shortcutsOn: true,
    slideHintDone: false,
  });
  const dual = new FakeDualMap({ center: link.away.center, zoom: 10 }, link.reg);
  const service = fakeRoads();
  const runner = createDriveRunner({ store, dual, roads: service.roads, now: () => Date.now() });
  /** Lets timers of exactly this many milliseconds run, and what they started settle. */
  const wait = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
  return { store, dual, runner, wait, ...service };
}

describe('the drive runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks nothing while there is no drive', async () => {
    const { store, routes, reaches, wait } = setup();
    await wait(10_000);
    expect(routes).toHaveLength(0);
    expect(reaches).toHaveLength(0);
    expect(store.get().route).toBeNull();
    expect(store.get().reach).toBeNull();
  });

  it('asks for the route as soon as a drive is set, and says it is finding it', async () => {
    const { store, routes, wait } = setup();
    store.set({ drive });
    expect(store.get().route).toEqual({ status: 'finding' });
    expect(store.get().reach).toBeNull();
    await wait(0);
    expect(routes.map((asked) => asked.question)).toEqual([{ from: PALO_ALTO, to: SAN_JOSE }]);
  });

  it('asks about a drive that was there from the start (it came with the link)', async () => {
    const { store, routes, wait } = setup(drive);
    expect(store.get().route).toEqual({ status: 'finding' });
    await wait(0);
    expect(routes).toHaveLength(1);
  });

  it('then asks how far the same time gets from where the start lands on the other place', async () => {
    const { store, dual, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    expect(store.get().route).toEqual({ status: 'found', route: ROUTE });
    expect(store.get().reach).toEqual({ status: 'finding' });
    // Not before the server has had its second of rest.
    await wait(ASK_GAP_MS - 1);
    expect(reaches).toHaveLength(0);
    await wait(1);
    expect(reaches).toHaveLength(1);
    const { from, limit, detail } = reaches[0]?.question ?? { from: PALO_ALTO, limit: null, detail: 0 };
    expect(distanceMeters(from, overlayToBase(dual.getRegistration(), PALO_ALTO))).toBeLessThan(0.01);
    expect(limit).toEqual({ by: 'time', minutes: 22.3 });
    expect(detail).toBeCloseTo(140, 0);
    await reaches[0]?.answer({ kind: 'found', outline: OUTLINE });
    expect(store.get().reach).toEqual({ status: 'found', outline: OUTLINE });
  });

  it('asks from the start itself, on Home, for a drive on Away', async () => {
    const onAway: Drive = { on: 'away', from: HEATHROW, to: { lat: 51.5308, lng: -0.1238 }, match: 'distance' };
    const { dual, routes, reaches, wait } = setup(onAway);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    await wait(ASK_GAP_MS);
    const { from, limit } = reaches[0]?.question ?? { from: PALO_ALTO, limit: null };
    // Where Heathrow lies on Home is the Home spot that lands on Heathrow.
    expect(distanceMeters(overlayToBase(dual.getRegistration(), from), HEATHROW)).toBeLessThan(0.01);
    expect(limit).toEqual({ by: 'distance', kilometres: 28 });
  });

  it('says why when there is no route, and asks for no reach', async () => {
    for (const kind of ['no-road', 'too-far'] as const) {
      const { store, routes, reaches, wait } = setup(drive);
      await wait(0);
      await routes[0]?.answer({ kind });
      await wait(10_000);
      expect(store.get().route).toEqual({ status: kind });
      expect(store.get().reach).toBeNull();
      expect(reaches).toHaveLength(0);
    }
  });

  it('says so when the service fails, and asks again only when told to', async () => {
    const { store, runner, routes, wait } = setup(drive);
    await wait(0);
    await routes[0]?.fail();
    expect(store.get().route).toEqual({ status: 'unavailable' });
    await wait(60_000);
    expect(routes).toHaveLength(1);
    runner.retry();
    expect(store.get().route).toEqual({ status: 'finding' });
    await wait(0);
    expect(routes).toHaveLength(2);
    await routes[1]?.answer({ kind: 'found', route: ROUTE });
    expect(store.get().route).toEqual({ status: 'found', route: ROUTE });
  });

  it('asks again for a reach that failed, without asking for the route again', async () => {
    const { store, runner, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    await wait(ASK_GAP_MS);
    await reaches[0]?.fail();
    expect(store.get().reach).toEqual({ status: 'unavailable' });
    runner.retry();
    expect(store.get().reach).toEqual({ status: 'finding' });
    await wait(ASK_GAP_MS);
    expect(routes).toHaveLength(1);
    expect(reaches).toHaveLength(2);
  });

  it('answers "beyond" itself, without asking, for more driving than a reach is drawn for', async () => {
    const { store, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: { ...ROUTE, seconds: 2 * 3600 } });
    expect(store.get().reach).toEqual({ status: 'beyond' });
    await wait(10_000);
    expect(reaches).toHaveLength(0);
    // By distance the same drive is within what is drawn.
    store.set({ drive: { ...drive, match: 'distance' } });
    expect(store.get().reach).toEqual({ status: 'finding' });
    await wait(ASK_GAP_MS);
    expect(reaches.map((asked) => asked.question.limit)).toEqual([{ by: 'distance', kilometres: 28 }]);
  });

  it('says "beyond" once, not anew on every frame, while Home is slid under a drive that is beyond', async () => {
    const { store, dual, routes, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: { ...ROUTE, seconds: 2 * 3600 } });
    const beyond = store.get().reach;
    expect(beyond).toEqual({ status: 'beyond' });
    const heard = vi.fn();
    store.subscribe(heard);
    for (const lat of [51.6, 51.61, 51.62]) {
      dual.setRegistration({ ...dual.getRegistration(), baseAnchor: { lat, lng: -0.3 } }, { final: false });
      await wait(0);
      expect(store.get().reach).toBe(beyond);
    }
    expect(heard).not.toHaveBeenCalled();
  });

  it('asks for the reach again, and not the route, when what it matches changes', async () => {
    const { store, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    await wait(ASK_GAP_MS);
    await reaches[0]?.answer({ kind: 'found', outline: OUTLINE });
    store.set({ drive: { ...drive, match: 'distance' } });
    expect(store.get().route).toEqual({ status: 'found', route: ROUTE });
    expect(store.get().reach).toEqual({ status: 'finding' });
    await wait(ASK_GAP_MS);
    expect(routes).toHaveLength(1);
    expect(reaches).toHaveLength(2);
    // Going back to what was asked before costs the server nothing.
    await reaches[1]?.answer({ kind: 'found', outline: [] });
    store.set({ drive: { ...drive, match: 'time' } });
    expect(store.get().reach).toEqual({ status: 'found', outline: OUTLINE });
    await wait(10_000);
    expect(reaches).toHaveLength(2);
  });

  it('does not ask again when only a name of the drive changes', async () => {
    const { store, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    await wait(ASK_GAP_MS);
    await reaches[0]?.answer({ kind: 'found', outline: OUTLINE });
    store.set({ drive: { ...drive, fromName: 'Palo Alto' } });
    await wait(10_000);
    expect(routes).toHaveLength(1);
    expect(reaches).toHaveLength(1);
    expect(store.get().reach).toEqual({ status: 'found', outline: OUTLINE });
  });

  it('drops the question about a drive that has been replaced, and never shows its answer', async () => {
    const { store, routes, wait } = setup(drive);
    await wait(0);
    const next: Drive = { ...drive, to: { lat: 37.4, lng: -122 } };
    store.set({ drive: next });
    expect(routes[0]?.signal.aborted).toBe(true);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    expect(store.get().route).toEqual({ status: 'finding' });
    // The second question waits its turn behind the first, dropped though the first was.
    await wait(ASK_GAP_MS - 1);
    expect(routes).toHaveLength(1);
    await wait(1);
    expect(routes.map((asked) => asked.question.to)).toEqual([SAN_JOSE, next.to]);
  });

  it('never asks twice within the server’s second, however fast what is wanted changes', async () => {
    const { store, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    await wait(ASK_GAP_MS);
    expect(reaches).toHaveLength(1);
    // The match is switched to and fro while the first reach is still being worked out.
    store.set({ drive: { ...drive, match: 'distance' } });
    expect(reaches[0]?.signal.aborted).toBe(true);
    await wait(ASK_GAP_MS - 1);
    expect(reaches).toHaveLength(1);
    await wait(1);
    expect(reaches).toHaveLength(2);
    store.set({ drive: { ...drive, match: 'time' } });
    store.set({ drive: { ...drive, match: 'distance' } });
    store.set({ drive: { ...drive, match: 'time' } });
    await wait(ASK_GAP_MS - 1);
    expect(reaches).toHaveLength(2);
    await wait(1);
    // One question for where it ended up, not one for each change on the way.
    expect(reaches.map((asked) => asked.question.limit.by)).toEqual(['time', 'distance', 'time']);
  });

  it('forgets everything when the drive is cleared', async () => {
    const { store, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    store.set({ drive: null });
    expect(store.get().route).toBeNull();
    expect(store.get().reach).toBeNull();
    await wait(10_000);
    expect(reaches).toHaveLength(0);
  });

  it('answers a drive it has already asked about from memory', async () => {
    const { store, routes, reaches, wait } = setup(drive);
    await wait(0);
    await routes[0]?.answer({ kind: 'found', route: ROUTE });
    await wait(ASK_GAP_MS);
    await reaches[0]?.answer({ kind: 'found', outline: OUTLINE });
    store.set({ drive: null });
    store.set({ drive: { ...drive } });
    expect(store.get().route).toEqual({ status: 'found', route: ROUTE });
    expect(store.get().reach).toEqual({ status: 'found', outline: OUTLINE });
    await wait(10_000);
    expect(routes).toHaveLength(1);
    expect(reaches).toHaveLength(1);
  });

  describe('when Home is slid or turned', () => {
    async function driven() {
      const rig = setup(drive);
      await rig.wait(0);
      await rig.routes[0]?.answer({ kind: 'found', route: ROUTE });
      await rig.wait(ASK_GAP_MS);
      await rig.reaches[0]?.answer({ kind: 'found', outline: OUTLINE });
      return rig;
    }
    const slid = (dual: FakeDualMap, lat: number) => ({ ...dual.getRegistration(), baseAnchor: { lat, lng: -0.3 } });
    /** A drive whose reach was answered this very moment. */
    async function setupAnswered() {
      const rig = setup(drive);
      await rig.wait(0);
      await rig.routes[0]?.answer({ kind: 'found', route: ROUTE });
      await rig.wait(ASK_GAP_MS);
      await rig.reaches[0]?.answer({ kind: 'found', outline: OUTLINE });
      return rig;
    }

    it('takes the old reach down at once, and asks for the new one when Home has come to rest', async () => {
      const { store, dual, reaches, wait } = await driven();
      dual.setRegistration(slid(dual, 51.6), { final: false });
      await wait(0);
      expect(store.get().reach).toEqual({ status: 'finding' });
      // Still moving: each new position puts the question off again.
      await wait(REACH_QUIET_MS - 1);
      dual.setRegistration(slid(dual, 51.61), { final: false });
      await wait(REACH_QUIET_MS - 1);
      dual.setRegistration(slid(dual, 51.62));
      await wait(REACH_QUIET_MS - 1);
      expect(reaches).toHaveLength(1);
      await wait(1);
      expect(reaches).toHaveLength(2);
      const from = reaches[1]?.question.from ?? PALO_ALTO;
      expect(distanceMeters(from, overlayToBase(dual.getRegistration(), PALO_ALTO))).toBeLessThan(0.01);
      expect(reaches[1]?.question.limit).toEqual({ by: 'time', minutes: 22.3 });
    });

    it('leaves the reach alone when the start still lands on the same spot', async () => {
      const { store, dual, reaches, wait } = await driven();
      // Home turned about the drive's own start, which is where the pin now is.
      const pinned = { overlayAnchor: PALO_ALTO, baseAnchor: overlayToBase(dual.getRegistration(), PALO_ALTO), rotation: 0 };
      dual.setRegistration(pinned);
      await wait(10_000);
      dual.setRegistration({ ...pinned, rotation: 40 });
      await wait(10_000);
      expect(reaches).toHaveLength(1);
      expect(store.get().reach).toEqual({ status: 'found', outline: OUTLINE });
    });

    it('judges a registration that changes together with the drive once, when both have changed', async () => {
      const { store, dual, routes, reaches, wait } = await driven();
      const seen: (string | undefined)[] = [];
      store.subscribe((state) => seen.push(state.reach?.status));
      // A swap: the registration is turned inside out and the drive is on the other sheet, in one go.
      // Half way through, the start would seem to land somewhere else altogether.
      store.transaction(() => {
        dual.setRegistration(swapRegistration(dual.getRegistration()));
        store.set({ drive: { ...drive, on: 'away' } });
      });
      await wait(10_000);
      expect(seen).not.toContain('finding');
      expect(store.get().reach).toEqual({ status: 'found', outline: OUTLINE });
      expect(reaches[0]?.signal.aborted).toBe(false);
      expect(routes).toHaveLength(1);
      expect(reaches).toHaveLength(1);
    });

    it('asks for no reach when the drive is cleared together with a change of registration', async () => {
      const { store, dual, routes, reaches, wait } = await driven();
      store.transaction(() => {
        dual.setRegistration(slid(dual, 51.7));
        store.set({ drive: null });
      });
      await wait(10_000);
      expect(routes).toHaveLength(1);
      expect(reaches).toHaveLength(1);
      expect(store.get().reach).toBeNull();
    });

    it('does not ask from Home’s new position sooner than a second after the last question', async () => {
      const { dual, reaches, wait } = await setupAnswered();
      dual.setRegistration(slid(dual, 51.6));
      await wait(REACH_QUIET_MS);
      // Home has been still long enough, but the server was asked less than a second ago.
      expect(reaches).toHaveLength(1);
      await wait(ASK_GAP_MS - REACH_QUIET_MS);
      expect(reaches).toHaveLength(2);
    });
  });

  it('asks nothing more once it is destroyed', async () => {
    const { store, runner, routes, wait } = setup();
    runner.destroy();
    store.set({ drive });
    await wait(10_000);
    expect(routes).toHaveLength(0);
  });
});
