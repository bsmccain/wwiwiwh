import { describe, expect, it } from 'vitest';
import type { MapHealth } from './contracts';
import { classifyMapError, createHealthTracker, healthOf, retryDelay, type Trouble, type Troubles } from './engine-health';

/** A clock whose timers fire only when the test moves time on. */
function createClock() {
  let now = 0;
  let timers: { at: number; callback: () => void }[] = [];
  return {
    schedule(callback: () => void, ms: number) {
      const timer = { at: now + ms, callback };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        now = due.at;
        due.callback();
      }
      now = until;
    },
    pending: () => timers.length,
    now: () => now,
  };
}

function createTracked() {
  const clock = createClock();
  const changes: MapHealth[] = [];
  const retries: { at: number; troubles: Record<string, Trouble[]> }[] = [];
  const answers: ((troubles: Troubles) => void)[] = [];
  const tracker = createHealthTracker({
    schedule: clock.schedule,
    onChange: (health) => changes.push(health),
    recover(troubles) {
      retries.push({ at: clock.now(), troubles: { away: [...troubles.away], home: [...troubles.home] } });
      answers.shift()?.(troubles);
    },
  });
  return { tracker, clock, changes, retries, retryTimes: () => retries.map((retry) => retry.at), answers };
}

describe('classifyMapError', () => {
  it('reads an error that carries a tile as a tile that did not load', () => {
    expect(classifyMapError({ error: { message: 'AJAXError: Failed to fetch (0)' }, tile: {}, sourceId: 'omt' })).toBe('tiles');
  });

  it('reads a source error without a tile as the source itself not loading', () => {
    expect(classifyMapError({ error: { message: 'AJAXError: Failed to fetch (0)' }, sourceId: 'omt' })).toBe('source');
    // A sign-in page answering in place of the TileJSON fails as a parse error, on the source all the same.
    expect(classifyMapError({ error: { message: 'Unexpected token \'<\', "<html>Sign"... is not valid JSON' }, sourceId: 'omt' })).toBe('source');
  });

  it('recognises the worker failing to load', () => {
    expect(classifyMapError({ error: { message: 'Worker failed to load. Check that the worker URL is correct.' } })).toBe('worker');
  });

  it('leaves errors that are not about loading alone', () => {
    expect(classifyMapError({ error: { message: 'Layer "x" already exists on this map.' } })).toBeNull();
    expect(classifyMapError({ error: null })).toBeNull();
    expect(classifyMapError({})).toBeNull();
  });
});

describe('healthOf', () => {
  const troubles = (away: Trouble[], home: Trouble[]): Troubles => ({ away: new Set(away), home: new Set(home) });

  it('is ok with no troubles', () => {
    expect(healthOf(troubles([], []))).toEqual({ state: 'ok', sheets: [] });
  });

  it('is degraded when only tiles are missing, naming the sheets', () => {
    expect(healthOf(troubles([], ['tiles']))).toEqual({ state: 'degraded', sheets: ['home'] });
    expect(healthOf(troubles(['tiles'], ['tiles']))).toEqual({ state: 'degraded', sheets: ['away', 'home'] });
  });

  it('is down when a sheet has no source or no worker, whatever the other sheet has', () => {
    expect(healthOf(troubles(['source'], []))).toEqual({ state: 'down', sheets: ['away'] });
    expect(healthOf(troubles(['tiles'], ['worker']))).toEqual({ state: 'down', sheets: ['away', 'home'] });
  });
});

describe('retryDelay', () => {
  it('grows from 3s to a minute and stays there', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([3_000, 8_000, 20_000, 45_000, 60_000, 60_000, 60_000]);
  });
});

describe('health tracker', () => {
  it('starts ok and reports each change of health once', () => {
    const { tracker, changes } = createTracked();
    expect(tracker.getHealth()).toEqual({ state: 'ok', sheets: [] });
    tracker.report('away', 'tiles');
    tracker.report('away', 'tiles');
    tracker.report('home', 'tiles');
    tracker.report('home', 'source');
    expect(changes).toEqual([
      { state: 'degraded', sheets: ['away'] },
      { state: 'degraded', sheets: ['away', 'home'] },
      { state: 'down', sheets: ['away', 'home'] },
    ]);
    expect(tracker.getHealth()).toEqual({ state: 'down', sheets: ['away', 'home'] });
  });

  it('retries 3s after the first failure, then 8s, 20s and 45s after the retry before, then every minute', () => {
    const { tracker, clock, retryTimes } = createTracked();
    tracker.report('away', 'source');
    clock.advance(2_999);
    expect(retryTimes()).toEqual([]);
    clock.advance(1);
    expect(retryTimes()).toEqual([3_000]);
    clock.advance(300_000);
    expect(retryTimes()).toEqual([3_000, 11_000, 31_000, 76_000, 136_000, 196_000, 256_000]);
  });

  it('hands the retry every trouble there is', () => {
    const { tracker, clock, retries } = createTracked();
    tracker.report('away', 'tiles');
    tracker.report('home', 'source');
    clock.advance(3_000);
    expect(retries[0]?.troubles).toEqual({ away: ['tiles'], home: ['source'] });
  });

  it('never retries because of a failure alone, however many arrive', () => {
    const { tracker, clock, retryTimes } = createTracked();
    for (let i = 0; i < 500; i++) tracker.report(i % 2 ? 'away' : 'home', 'tiles');
    expect(retryTimes()).toEqual([]);
    expect(clock.pending()).toBe(1);
    // Failures that keep arriving do not push the retry back either.
    clock.advance(2_000);
    tracker.report('away', 'tiles');
    clock.advance(1_000);
    expect(retryTimes()).toEqual([3_000]);
  });

  it('stops retrying and starts over once everything is right again', () => {
    const { tracker, clock, changes, retryTimes } = createTracked();
    tracker.report('away', 'tiles');
    tracker.report('home', 'tiles');
    clock.advance(3_000);
    tracker.resolve('away', 'tiles');
    expect(tracker.getHealth()).toEqual({ state: 'degraded', sheets: ['home'] });
    expect(clock.pending()).toBe(1);
    tracker.resolve('home', 'tiles');
    expect(changes.at(-1)).toEqual({ state: 'ok', sheets: [] });
    expect(clock.pending()).toBe(0);
    clock.advance(600_000);
    expect(retryTimes()).toEqual([3_000]);

    // The next failure is a first failure again.
    tracker.report('home', 'tiles');
    clock.advance(3_000);
    expect(retryTimes()).toEqual([3_000, 606_000]);
  });

  it('copes with a retry that is answered before it returns', () => {
    const { tracker, clock, retryTimes, answers } = createTracked();
    tracker.report('away', 'tiles');
    answers.push(() => tracker.resolve('away', 'tiles'));
    clock.advance(3_000);
    expect(tracker.getHealth().state).toBe('ok');
    expect(clock.pending()).toBe(0);
    clock.advance(600_000);
    expect(retryTimes()).toEqual([3_000]);
  });

  it('ignores a resolve for a trouble the sheet does not have', () => {
    const { tracker, changes } = createTracked();
    tracker.report('away', 'tiles');
    tracker.resolve('home', 'tiles');
    tracker.resolve('away', 'source');
    expect(changes).toEqual([{ state: 'degraded', sheets: ['away'] }]);
  });

  describe('retryNow', () => {
    it('retries at once and waits the same pause again before the next automatic try', () => {
      const { tracker, clock, retryTimes } = createTracked();
      tracker.report('away', 'source');
      clock.advance(1_000);
      tracker.retryNow();
      expect(retryTimes()).toEqual([1_000]);
      tracker.report('away', 'source');
      clock.advance(2_999);
      expect(retryTimes()).toEqual([1_000]);
      clock.advance(1);
      expect(retryTimes()).toEqual([1_000, 4_000]);
    });

    it('does nothing while all is well', () => {
      const { tracker, clock, retryTimes } = createTracked();
      tracker.retryNow();
      clock.advance(600_000);
      expect(retryTimes()).toEqual([]);
    });

    it('lets one retry be out at a time: asking again before it is answered does nothing', () => {
      const { tracker, clock, retryTimes } = createTracked();
      tracker.report('away', 'tiles');
      clock.advance(500);
      tracker.retryNow();
      tracker.retryNow();
      tracker.retryNow();
      expect(retryTimes()).toEqual([500]);
      // Answered by a new failure: the next request goes through.
      tracker.report('away', 'tiles');
      tracker.retryNow();
      expect(retryTimes()).toEqual([500, 500]);
    });

    it('still retries on schedule when a retry was never answered', () => {
      const { tracker, clock, retryTimes } = createTracked();
      tracker.report('home', 'worker');
      clock.advance(3_000);
      tracker.retryNow();
      clock.advance(8_000);
      expect(retryTimes()).toEqual([3_000, 11_000]);
    });
  });

  it('retries nothing and reports nothing once stopped', () => {
    const { tracker, clock, changes, retryTimes } = createTracked();
    tracker.report('away', 'source');
    tracker.stop();
    expect(clock.pending()).toBe(0);
    tracker.retryNow();
    tracker.report('home', 'tiles');
    tracker.resolve('away', 'source');
    clock.advance(600_000);
    expect(retryTimes()).toEqual([]);
    expect(changes).toEqual([{ state: 'down', sheets: ['away'] }]);
  });
});
