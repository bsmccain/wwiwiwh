import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first request at once and the rest once the interval is up', () => {
    const run = vi.fn();
    const throttled = throttle(run, 250);
    throttled.request();
    expect(run).toHaveBeenCalledTimes(1);
    throttled.request();
    throttled.request();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs at once again after a quiet spell', () => {
    const run = vi.fn();
    const throttled = throttle(run, 250);
    throttled.request();
    vi.advanceTimersByTime(300);
    throttled.request();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flush runs now and replaces the run that was waiting', () => {
    const run = vi.fn();
    const throttled = throttle(run, 250);
    throttled.request();
    throttled.request();
    throttled.flush();
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
