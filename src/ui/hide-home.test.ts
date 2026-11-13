import { describe, expect, it } from 'vitest';
import { HIDE_HOME_AT_REST, HOLD_MS, hideHomeReducer, homeIsHidden, type HideHomeEvent, type HideHomeState } from './hide-home';

function after(...events: HideHomeEvent[]): HideHomeState {
  return events.reduce(hideHomeReducer, HIDE_HOME_AT_REST);
}

describe('Hide Home', () => {
  it('hides Home the moment the button is pressed', () => {
    const state = after({ type: 'press', at: 1000 });
    expect(homeIsHidden(state)).toBe(true);
    expect(state.latched).toBe(false);
  });

  it('shows Home again when a hold is released', () => {
    const state = after({ type: 'press', at: 1000 }, { type: 'release', at: 1000 + HOLD_MS });
    expect(homeIsHidden(state)).toBe(false);
    expect(state.latched).toBe(false);
  });

  it('latches Home hidden on a quick tap', () => {
    const state = after({ type: 'press', at: 1000 }, { type: 'release', at: 1000 + HOLD_MS - 1 });
    expect(homeIsHidden(state)).toBe(true);
    expect(state.latched).toBe(true);
  });

  it('unlatches on the next press, however long it lasts, and keeps Home hidden until release', () => {
    const latched = after({ type: 'press', at: 0 }, { type: 'release', at: 80 });
    const pressedAgain = hideHomeReducer(latched, { type: 'press', at: 500 });
    expect(homeIsHidden(pressedAgain)).toBe(true);
    for (const heldFor of [50, 2000]) {
      const released = hideHomeReducer(pressedAgain, { type: 'release', at: 500 + heldFor });
      expect(released.latched).toBe(false);
      expect(homeIsHidden(released)).toBe(false);
    }
  });

  it('toggles the latch from the keyboard', () => {
    expect(after({ type: 'toggle' }).latched).toBe(true);
    expect(after({ type: 'toggle' }, { type: 'toggle' }).latched).toBe(false);
  });

  it('hides Home for as long as H is down, without touching the latch', () => {
    const down = after({ type: 'key', down: true });
    expect(homeIsHidden(down)).toBe(true);
    expect(homeIsHidden(hideHomeReducer(down, { type: 'key', down: false }))).toBe(false);

    const latchedThenKey = after({ type: 'toggle' }, { type: 'key', down: true }, { type: 'key', down: false });
    expect(latchedThenKey.latched).toBe(true);
    expect(homeIsHidden(latchedThenKey)).toBe(true);
  });

  it('treats an abandoned press as neither a tap nor a hold', () => {
    const fresh = after({ type: 'press', at: 0 }, { type: 'abandon' });
    expect(fresh).toEqual(HIDE_HOME_AT_REST);
    const latched = after({ type: 'toggle' }, { type: 'press', at: 0 }, { type: 'abandon' });
    expect(latched.latched).toBe(true);
    expect(homeIsHidden(after({ type: 'key', down: true }, { type: 'abandon' }))).toBe(false);
  });

  it('ignores a release that had no press, and a second press during the first', () => {
    expect(after({ type: 'release', at: 5 })).toEqual(HIDE_HOME_AT_REST);
    const state = after({ type: 'press', at: 0 }, { type: 'press', at: 300 }, { type: 'release', at: 340 });
    expect(state.latched).toBe(true);
  });
});
