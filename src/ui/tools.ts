import type { Controller } from '../app/controller';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import { button, el } from './dom';
import { HIDE_HOME_AT_REST, hideHomeReducer, homeIsHidden, type HideHomeEvent, type HideHomeState } from './hide-home';
import { icon, type IconName } from './icons';

export type ToolName = 'slide' | 'measure' | 'drive' | 'rings' | 'hide';

export interface Tools {
  readonly element: HTMLElement;
  button(tool: ToolName): HTMLButtonElement;
  /** The H key going down or coming up: Home is hidden for as long as it is down. */
  holdHideKey(down: boolean): void;
}

/** A tool as the collar draws it: an icon with its name, a toggle unless said otherwise. */
export function createToolButton(name: IconName, word: string, className = '', toggle = true): HTMLButtonElement {
  return button(`tool ${className}`.trim(), toggle ? { 'aria-pressed': 'false' } : {}, [icon(name), el('span', 'tool__word', {}, [word])]);
}

/**
 * The map tools: Slide Home, Measure, Drive, Rings and Hide Home, each a toggle that is reversed while on.
 */
export function createTools(deps: {
  store: Store<AppState>;
  actions: Pick<Controller, 'toggleSlide' | 'toggleMeasure' | 'toggleDrive' | 'toggleRings' | 'setHomeHidden'>;
  disabled: boolean;
}): Tools {
  const { store, actions } = deps;
  const tools: Readonly<Record<ToolName, HTMLButtonElement>> = {
    slide: createToolButton('slide', 'Slide Home', 'tool--home'),
    measure: createToolButton('measure', 'Measure'),
    drive: createToolButton('drive', 'Drive'),
    rings: createToolButton('rings', 'Rings'),
    hide: createToolButton('hide', 'Hide Home', 'tool--home'),
  };
  const element = el(
    'div',
    'collar__section tools',
    // A plain group, not a toolbar: a toolbar would claim the arrow keys, which move the maps.
    { role: 'group', 'aria-label': 'Map tools' },
    Object.values(tools),
  );
  for (const tool of Object.values(tools)) tool.disabled = deps.disabled;

  const press = (tool: ToolName, pressed: boolean): void => {
    tools[tool].setAttribute('aria-pressed', String(pressed));
  };

  // --- Hide Home: hold to blink, tap to latch ---

  let hiding: HideHomeState = HIDE_HOME_AT_REST;
  /** The pointer whose press on the button is in progress. */
  let pressedBy: number | null = null;
  const hide = tools.hide;
  // A thumb drifts during a hold of a second or more. Left to the browser, the drift would become a
  // scroll and end the press; an inline style is the one thing no stylesheet rule about buttons outranks.
  hide.style.touchAction = 'none';

  const send = (event: HideHomeEvent): void => {
    hiding = hideHomeReducer(hiding, event);
    actions.setHomeHidden(homeIsHidden(hiding));
    // The name stays "Hide Home" whether or not it is latched: only the pressed state changes.
    press('hide', hiding.latched);
    hide.classList.toggle('is-held', hiding.press !== null);
  };

  hide.addEventListener('pointerdown', (event) => {
    if (hide.disabled || pressedBy !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pressedBy = event.pointerId;
    // The release must reach the button even if the pointer has wandered off it by then.
    hide.setPointerCapture(event.pointerId);
    send({ type: 'press', at: event.timeStamp });
  });
  hide.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pressedBy) return;
    pressedBy = null;
    send({ type: 'release', at: event.timeStamp });
  });
  hide.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== pressedBy) return;
    pressedBy = null;
    send({ type: 'abandon' });
  });
  // A long press must not bring up a menu over the comparison it is making.
  hide.addEventListener('contextmenu', (event) => {
    if (pressedBy !== null) event.preventDefault();
  });
  hide.addEventListener('click', (event) => {
    // Clicks that end a press were dealt with on release; `detail` is 0 for Enter, Space and assistive technology.
    if (event.detail === 0) send({ type: 'toggle' });
  });
  // A held press or key whose release went to another window would leave Home hidden for no visible reason.
  window.addEventListener('blur', () => {
    if (hiding.press || hiding.keyHeld) {
      pressedBy = null;
      send({ type: 'abandon' });
    }
  });

  // --- the plain toggles ---

  tools.slide.addEventListener('click', () => actions.toggleSlide());
  tools.measure.addEventListener('click', () => actions.toggleMeasure());
  tools.drive.addEventListener('click', () => actions.toggleDrive());
  tools.rings.addEventListener('click', () => actions.toggleRings());

  const draw = (): void => {
    const { mode, rings } = store.get();
    press('slide', mode === 'slide');
    press('measure', mode === 'measure');
    press('drive', mode === 'drive');
    press('rings', rings);
  };
  store.subscribe((state, previous) => {
    if (state.mode !== previous.mode || state.rings !== previous.rings) draw();
  });
  draw();

  return {
    element,
    button: (tool) => tools[tool],
    holdHideKey(down) {
      if (deps.disabled || hiding.keyHeld === down) return;
      send({ type: 'key', down });
    },
  };
}
