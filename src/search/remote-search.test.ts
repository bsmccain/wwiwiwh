import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '../app/types';
import { SearchUnavailableError } from './photon';
import {
  createPhotonMemory,
  createRemoteSearch,
  createSearchMemory,
  createServerPatience,
  DEBOUNCE_MS,
  type RemoteSearchDeps,
  type RemoteState,
  type SearchMemory,
} from './remote-search';

const paloAlto: Place = { name: 'Palo Alto', context: 'California, USA', center: { lat: 37.44433, lng: -122.15985 } };

interface Call {
  readonly query: string;
  readonly signal: AbortSignal;
  readonly resolve: (places: Place[]) => void;
  readonly reject: (error: unknown) => void;
}

type Manners = Pick<RemoteSearchDeps<Place[]>, 'worthAsking' | 'quietMs'>;

/** A remote search wired to a hand-driven server and vitest's fake clock. */
function setUp(memory: SearchMemory<Place[]> = createSearchMemory(), scope?: string, manners: Manners = {}) {
  const calls: Call[] = [];
  const states: RemoteState<Place[]>[] = [];
  const search = (query: string, signal: AbortSignal): Promise<Place[]> =>
    new Promise((resolve, reject) => calls.push({ query, signal, resolve, reject }));
  const remote = createRemoteSearch<Place[]>((state) => states.push(state), {
    search,
    memory,
    ...(scope === undefined ? {} : { scope }),
    ...manners,
    now: () => Date.now(),
  });
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  return { calls, states, remote, settle, last: () => states.at(-1) };
}

describe('remote search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for a pause in the typing before asking', async () => {
    const { calls, states, remote } = setUp();
    remote.ask('pa');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    remote.ask('pal');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    remote.ask('palo');
    expect(calls).toHaveLength(0);
    expect(states.at(-1)).toEqual({ status: 'waiting', query: 'palo' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls.map((call) => call.query)).toEqual(['palo']);
    expect(DEBOUNCE_MS).toBe(300);
  });

  it('counts a keystroke that changes nothing as typing: what is not sent yet waits for the next pause', async () => {
    const { calls, states, remote } = setUp();
    remote.ask('san');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    // The space after the word.
    remote.stillTyping();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((call) => call.query)).toEqual(['san']);
    expect(states).toEqual([{ status: 'waiting', query: 'san' }]);
  });

  it('leaves a request that is on its way, and its answer, alone when such a keystroke comes', async () => {
    const { calls, remote, settle, last } = setUp();
    remote.stillTyping();
    remote.ask('san');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    remote.stillTyping();
    expect(calls[0]?.signal.aborted).toBe(false);
    calls[0]?.resolve([paloAlto]);
    await settle();
    remote.stillTyping();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(1);
    expect(last()).toEqual({ status: 'done', query: 'san', answer: [paloAlto] });
  });

  it('reports the answer', async () => {
    const { calls, remote, settle, last } = setUp();
    remote.ask('palo al');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0]?.resolve([paloAlto]);
    await settle();
    expect(last()).toEqual({ status: 'done', query: 'palo al', answer: [paloAlto] });
  });

  it('aborts the request in flight on the next keystroke and ignores its late answer', async () => {
    const { calls, states, remote, settle } = setUp();
    remote.ask('palo');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    remote.ask('palo a');
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve([paloAlto]);
    await settle();
    expect(states.at(-1)).toEqual({ status: 'waiting', query: 'palo a' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls.map((call) => call.query)).toEqual(['palo', 'palo a']);
  });

  it('asks nothing for fewer than two characters', async () => {
    const { calls, remote, last } = setUp();
    remote.ask('p');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(0);
    expect(last()).toEqual({ status: 'idle' });
  });

  it('waits as long, and for as much, as the search it serves says', async () => {
    const patient = setUp(createSearchMemory(), undefined, { quietMs: 400, worthAsking: (query) => query.length >= 3 });
    patient.remote.ask('pa');
    expect(patient.last()).toEqual({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(patient.calls).toHaveLength(0);

    patient.remote.ask('pal');
    expect(patient.last()).toEqual({ status: 'waiting', query: 'pal' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    patient.remote.ask('palo');
    await vi.advanceTimersByTimeAsync(399);
    expect(patient.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(patient.calls.map((call) => call.query)).toEqual(['palo']);

    // Too short a query drops what was pending, as it does for every search.
    patient.remote.ask('pa');
    expect(patient.calls[0]?.signal.aborted).toBe(true);
    expect(patient.last()).toEqual({ status: 'idle' });
  });

  it('tries again at once whatever pause it otherwise waits for', async () => {
    const patient = setUp(createSearchMemory(), undefined, { quietMs: 400 });
    patient.remote.retry('palo alto');
    await patient.settle();
    expect(patient.calls.map((call) => call.query)).toEqual(['palo alto']);
  });

  it('answers a repeated query from memory, whatever its case', async () => {
    const { calls, remote, settle, last } = setUp();
    remote.ask('palo alto');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0]?.resolve([paloAlto]);
    await settle();
    remote.ask('palo alt');
    remote.ask('Palo Alto');
    expect(last()).toEqual({ status: 'done', query: 'Palo Alto', answer: [paloAlto] });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it('leaves a failing server alone, longer each time, until it answers again', async () => {
    const { calls, remote, settle, last } = setUp();
    const failNext = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      calls.at(-1)?.reject(new SearchUnavailableError('network'));
      await settle();
    };

    remote.ask('first');
    await failNext();
    expect(last()).toEqual({ status: 'unavailable', query: 'first' });

    remote.ask('second');
    expect(last()).toEqual({ status: 'unavailable', query: 'second' });
    await vi.advanceTimersByTimeAsync(29_000);
    remote.ask('third');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    remote.ask('fourth');
    expect(last()).toEqual({ status: 'waiting', query: 'fourth' });
    await failNext();
    expect(calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(59_000);
    remote.ask('fifth');
    expect(last()).toEqual({ status: 'unavailable', query: 'fifth' });
    await vi.advanceTimersByTimeAsync(1000);
    remote.ask('sixth');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls.at(-1)?.resolve([]);
    await settle();
    expect(last()).toEqual({ status: 'done', query: 'sixth', answer: [] });

    remote.ask('seventh');
    await failNext();
    await vi.advanceTimersByTimeAsync(30_000);
    remote.ask('eighth');
    expect(last()).toEqual({ status: 'waiting', query: 'eighth' });
  });

  it('never pauses for more than five minutes', async () => {
    const { calls, remote, settle, last } = setUp();
    for (let round = 0; round < 8; round++) {
      await vi.advanceTimersByTimeAsync(300_000);
      remote.ask(`round ${round}`);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      calls.at(-1)?.reject(new SearchUnavailableError('timeout'));
      await settle();
    }
    expect(calls).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(299_000);
    remote.ask('still paused');
    expect(last()).toEqual({ status: 'unavailable', query: 'still paused' });
  });

  it('tries again at once when the person asks, pause or not', async () => {
    const { calls, remote, settle, last } = setUp();
    remote.ask('palo alto');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0]?.reject(new SearchUnavailableError('http', 503));
    await settle();
    remote.retry('palo alto');
    expect(last()).toEqual({ status: 'waiting', query: 'palo alto' });
    await settle();
    expect(calls).toHaveLength(2);
    calls[1]?.resolve([paloAlto]);
    await settle();
    expect(last()).toEqual({ status: 'done', query: 'palo alto', answer: [paloAlto] });
  });

  it('treats an unexpected error as "unavailable" and says so on the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { calls, remote, settle, last } = setUp();
    remote.ask('palo alto');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    calls[0]?.reject(new TypeError('boom'));
    await settle();
    expect(last()).toEqual({ status: 'unavailable', query: 'palo alto' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the answers to the same words asked of different things apart', async () => {
    const memory = createSearchMemory<Place[]>();
    const nearLondon = setUp(memory, 'London');
    nearLondon.remote.ask('palo alto');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    nearLondon.calls[0]?.resolve([]);
    await nearLondon.settle();

    const nearSanJose = setUp(memory, 'San Jose');
    nearSanJose.remote.ask('palo alto');
    expect(nearSanJose.last()).toEqual({ status: 'waiting', query: 'palo alto' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    nearSanJose.calls[0]?.resolve([paloAlto]);
    await nearSanJose.settle();

    const nearLondonAgain = setUp(memory, 'London');
    nearLondonAgain.remote.ask('Palo Alto');
    expect(nearLondonAgain.last()).toEqual({ status: 'done', query: 'Palo Alto', answer: [] });
    const nearSanJoseAgain = setUp(memory, 'San Jose');
    nearSanJoseAgain.remote.ask('Palo Alto');
    expect(nearSanJoseAgain.last()).toEqual({ status: 'done', query: 'Palo Alto', answer: [paloAlto] });
    expect(nearLondonAgain.calls.length + nearSanJoseAgain.calls.length).toBe(0);
  });

  it('rests every search of one server after a failure of any, until one of them is answered again', async () => {
    const server = createServerPatience();
    const places = setUp(createSearchMemory(server));
    const spots = setUp(createSearchMemory(server));
    places.remote.ask('palo alto');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    places.calls[0]?.reject(new SearchUnavailableError('network'));
    await places.settle();

    spots.remote.ask('10 downing');
    expect(spots.last()).toEqual({ status: 'unavailable', query: '10 downing' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(spots.calls).toHaveLength(0);

    spots.remote.retry('10 downing');
    await spots.settle();
    spots.calls[0]?.resolve([]);
    await spots.settle();
    places.remote.ask('palo alto');
    expect(places.last()).toEqual({ status: 'waiting', query: 'palo alto' });
  });

  it('gives the searches of the public Photon server one patience and each its own answers', () => {
    const places = createPhotonMemory<Place[]>();
    const spots = createPhotonMemory<Place[]>();
    expect(places.server).toBe(spots.server);
    expect(places.answers).not.toBe(spots.answers);
  });

  it('reports nothing after stop', async () => {
    const { calls, states, remote, settle } = setUp();
    remote.ask('palo alto');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    remote.stop();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.reject(new DOMException('Aborted', 'AbortError'));
    await settle();
    remote.ask('paris');
    remote.stop();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(1);
    expect(states.map((state) => state.status)).toEqual(['waiting', 'waiting']);
  });
});
