import { describe, expect, it } from 'vitest';
import { statusNote } from './map-status';

const retry = (): void => undefined;

describe('the standing note about the maps', () => {
  it('says which place is being drawn while all is well', () => {
    expect(statusNote('ok', 'London', retry)).toEqual({ tone: 'loading', text: 'Drawing London…' });
  });

  it('says nothing once the view is drawn', () => {
    expect(statusNote('ok', null, retry)).toBeNull();
  });

  it('puts an unreachable map service above a view still being drawn, with a way to try again', () => {
    const note = statusNote('down', 'London', retry);
    expect(note).toEqual({ tone: 'down', text: "Can't reach the map service. Trying again…", onRetry: retry });
  });

  it('keeps a quiet line up while parts are missing, drawn or not', () => {
    expect(statusNote('degraded', null, retry)?.text).toBe("Parts of the map didn't load. Trying again…");
    expect(statusNote('degraded', 'Paris', retry)?.tone).toBe('degraded');
  });

  it('never names a sheet in a failure', () => {
    for (const health of ['down', 'degraded'] as const) {
      expect(statusNote(health, 'Paris', retry)?.text).not.toMatch(/Paris/);
    }
  });
});
