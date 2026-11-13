import type { BrowserContext } from '@playwright/test';

/** Listens for what the app's pages complain about: console errors and warnings, and uncaught exceptions. */
export interface ConsoleWatch {
  /**
   * Lets through complaints a test brings about on purpose, such as the browser's own line about a
   * request the test made fail.
   */
  allow(pattern: RegExp): void;
  /** The complaints so far that nothing allows. */
  problems(): string[];
}

export function watchConsole(context: BrowserContext): ConsoleWatch {
  const complaints: string[] = [];
  const allowed: RegExp[] = [];

  context.on('console', (message) => {
    const type = message.type();
    if (type === 'error' || type === 'warning') complaints.push(`console ${type}: ${message.text()}`);
  });
  context.on('weberror', (webError) => {
    complaints.push(`uncaught: ${webError.error().message}`);
  });

  return {
    allow(pattern) {
      allowed.push(pattern);
    },
    problems: () => complaints.filter((complaint) => !allowed.some((pattern) => pattern.test(complaint))),
  };
}
