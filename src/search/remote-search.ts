import { MIN_QUERY_LENGTH, SearchUnavailableError } from './photon';

/*
 * Search-as-you-type manners for a free public server: wait for a pause in the typing, never leave a
 * stale request running, never ask the same thing twice, and after a failure leave the server alone for
 * a while instead of knocking again on every keystroke.
 */

export const DEBOUNCE_MS = 300;
const FIRST_PAUSE_MS = 30_000;
const LONGEST_PAUSE_MS = 300_000;
const MAX_REMEMBERED_ANSWERS = 50;

/** `A` is whatever one search answers with: a list of places, a list of spots, one list per sheet. */
export type RemoteState<A> =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting'; readonly query: string }
  | { readonly status: 'done'; readonly query: string; readonly answer: A }
  | { readonly status: 'unavailable'; readonly query: string };

/** How long a failing server is being left alone. One per server, whatever is being asked of it. */
export interface ServerPatience {
  pausedUntil: number;
  nextPauseMs: number;
}

export function createServerPatience(): ServerPatience {
  return { pausedUntil: 0, nextPauseMs: FIRST_PAUSE_MS };
}

/** What outlives one opening of a picker: answers already received, and the patience with their server. */
export interface SearchMemory<A> {
  readonly answers: Map<string, A>;
  readonly server: ServerPatience;
}

export function createSearchMemory<A>(server: ServerPatience = createServerPatience()): SearchMemory<A> {
  return { answers: new Map(), server };
}

/** Places and spots are looked up on the same public server, so a failure of one search rests them all. */
const photonPatience = createServerPatience();

/** A memory for one kind of search on the public Photon server. */
export function createPhotonMemory<A>(): SearchMemory<A> {
  return createSearchMemory<A>(photonPatience);
}

export interface RemoteSearchDeps<A> {
  readonly search: (query: string, signal: AbortSignal) => Promise<A>;
  readonly memory: SearchMemory<A>;
  /**
   * What the search is asked about besides the words, when one memory serves several: the same words
   * asked of another place are another question.
   */
  readonly scope?: string;
  /** Whether a cleaned query is long enough to ask about. Two characters or more when left out. */
  readonly worthAsking?: (query: string) => boolean;
  /** How long the typing must have paused before the server is asked. `DEBOUNCE_MS` when left out. */
  readonly quietMs?: number;
  readonly now?: () => number;
}

export interface RemoteSearch {
  /**
   * Call on every keystroke with the cleaned query. Reports the new state at once (idle for a query
   * too short to ask about) and again when the answer is in.
   */
  ask(query: string): void;
  /**
   * Call on a keystroke that leaves the cleaned query as it was (the space after a word): the person
   * is still typing, so a request that has not been sent yet waits for the next pause.
   */
  stillTyping(): void;
  /** The person pressed "Try again": forget the pause and ask straight away. */
  retry(query: string): void;
  /** Drops whatever is pending. Nothing more is reported for it. */
  stop(): void;
}

export function createRemoteSearch<A>(onState: (state: RemoteState<A>) => void, deps: RemoteSearchDeps<A>): RemoteSearch {
  const { search, memory, scope = '', quietMs = DEBOUNCE_MS, now = Date.now } = deps;
  const worthAsking = deps.worthAsking ?? ((query: string): boolean => query.length >= MIN_QUERY_LENGTH);
  const { answers, server } = memory;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The query that is waiting for a pause in the typing, while one is. */
  let unsent: string | undefined;
  let request: AbortController | undefined;

  const answerKey = (query: string): string => `${scope}\n${query.toLowerCase()}`;

  const rememberAnswer = (query: string, answer: A): void => {
    answers.set(answerKey(query), answer);
    const oldest = answers.keys().next();
    if (answers.size > MAX_REMEMBERED_ANSWERS && !oldest.done) answers.delete(oldest.value);
  };

  const stop = (): void => {
    clearTimeout(timer);
    unsent = undefined;
    request?.abort();
    request = undefined;
  };

  const run = async (query: string): Promise<void> => {
    const mine = new AbortController();
    request = mine;
    try {
      const answer = await search(query, mine.signal);
      if (mine.signal.aborted) return;
      rememberAnswer(query, answer);
      server.pausedUntil = 0;
      server.nextPauseMs = FIRST_PAUSE_MS;
      onState({ status: 'done', query, answer });
    } catch (error) {
      if (mine.signal.aborted) return;
      if (!(error instanceof SearchUnavailableError)) console.warn('Search failed unexpectedly', error);
      server.pausedUntil = now() + server.nextPauseMs;
      server.nextPauseMs = Math.min(server.nextPauseMs * 2, LONGEST_PAUSE_MS);
      onState({ status: 'unavailable', query });
    }
  };

  const sendAfter = (query: string, delayMs: number): void => {
    unsent = query;
    timer = setTimeout(() => {
      unsent = undefined;
      void run(query);
    }, delayMs);
  };

  const start = (query: string, delayMs: number): void => {
    stop();
    if (!worthAsking(query)) {
      onState({ status: 'idle' });
      return;
    }
    const known = answers.get(answerKey(query));
    if (known !== undefined) {
      onState({ status: 'done', query, answer: known });
      return;
    }
    if (now() < server.pausedUntil) {
      onState({ status: 'unavailable', query });
      return;
    }
    onState({ status: 'waiting', query });
    sendAfter(query, delayMs);
  };

  return {
    ask: (query) => start(query, quietMs),
    stillTyping() {
      if (unsent === undefined) return;
      clearTimeout(timer);
      sendAfter(unsent, quietMs);
    },
    retry(query) {
      server.pausedUntil = 0;
      start(query, 0);
    },
    stop,
  };
}
