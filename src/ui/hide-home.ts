/**
 * Hide Home is two tools in one button. Held down, it is a blink comparison: Home is gone while the
 * press lasts. Tapped, it latches: Home stays hidden until the next tap. The H key hides Home for as
 * long as it is down. This is the bookkeeping for all three, free of the DOM.
 */

/** A press released sooner than this is a tap. */
export const HOLD_MS = 350;

export interface HideHomeState {
  /** Home stays hidden until the button is used again. */
  readonly latched: boolean;
  /** A press on the button that has not been released yet. */
  readonly press: { readonly at: number; readonly wasLatched: boolean } | null;
  readonly keyHeld: boolean;
}

export type HideHomeEvent =
  | { readonly type: 'press'; readonly at: number }
  | { readonly type: 'release'; readonly at: number }
  /** The press was taken away (pointer cancelled, window lost focus): it counts as neither tap nor hold. */
  | { readonly type: 'abandon' }
  /** Activated without a press: Enter, Space or assistive technology. */
  | { readonly type: 'toggle' }
  | { readonly type: 'key'; readonly down: boolean };

export const HIDE_HOME_AT_REST: HideHomeState = { latched: false, press: null, keyHeld: false };

export function hideHomeReducer(state: HideHomeState, event: HideHomeEvent): HideHomeState {
  switch (event.type) {
    case 'press':
      return state.press ? state : { ...state, press: { at: event.at, wasLatched: state.latched } };
    case 'release': {
      if (!state.press) return state;
      // Any press on a latched button unlatches it; otherwise a tap latches and a hold was only a look.
      const latched = !state.press.wasLatched && event.at - state.press.at < HOLD_MS;
      return { ...state, latched, press: null };
    }
    case 'abandon':
      return { ...state, press: null, keyHeld: false };
    case 'toggle':
      return { ...state, latched: !state.latched, press: null };
    case 'key':
      return { ...state, keyHeld: event.down };
  }
}

export function homeIsHidden(state: HideHomeState): boolean {
  return state.latched || state.press !== null || state.keyHeld;
}
