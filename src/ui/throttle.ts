export interface Throttled {
  /** Runs now if the last run was long enough ago, otherwise once when the interval is up. */
  request(): void;
  /** Runs now, in place of any run still waiting. */
  flush(): void;
}

/** Runs `run` at most once per interval, and always once more after the last request. */
export function throttle(run: () => void, intervalMs: number): Throttled {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRunAt = -Infinity;

  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const fire = (): void => {
    stopTimer();
    lastRunAt = Date.now();
    run();
  };

  return {
    request() {
      if (timer !== null) return;
      const wait = lastRunAt + intervalMs - Date.now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    flush: fire,
  };
}
