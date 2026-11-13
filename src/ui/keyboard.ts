import { isHideHomeKey, resolveKey, type KeyCommand, type KeyContext } from './shortcuts';

const TYPING_FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Controls that Enter activates by itself. */
const ACTIVATED_BY_ENTER = 'button, a[href], summary, [role="button"]';

export interface KeyboardDeps {
  /** A dialog, a picker, the More menu or the pin menu is open. */
  overlayIsOpen(): boolean;
  /** Home is being slid or turned with a pointer right now. */
  draggingHome(): boolean;
  measuring(): boolean;
  /** Single-key shortcuts are switched on. */
  singleKeys(): boolean;
  /** Whether an element is one of the instrument handles, which use the arrow keys themselves. */
  isHandle(target: Element): boolean;
  /** Whether an element is part of the map pair, where MapLibre pans and zooms on its own. */
  isMap(target: Element): boolean;
  run(command: KeyCommand): void;
  /** The key that hides Home was let go. */
  releaseHideHome(): void;
}

/** Listens for the app's keyboard shortcuts on the whole window. */
export function bindKeyboard(deps: KeyboardDeps, win: Window = window): void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const context: KeyContext = {
      typing: target?.closest(TYPING_FIELDS) != null,
      overlayOpen: deps.overlayIsOpen(),
      draggingHome: deps.draggingHome(),
      onHandle: target !== null && deps.isHandle(target),
      onMap: target !== null && deps.isMap(target),
      onControl: target?.closest(ACTIVATED_BY_ENTER) != null,
      measuring: deps.measuring(),
      singleKeys: deps.singleKeys(),
    };
    const command = resolveKey(event, context);
    if (!command) return;
    event.preventDefault();
    // MapLibre does not check for a prevented default. Shift+arrow reaching a focused map would
    // start a 300 ms move that goes nowhere, so that key stops here.
    if (command.do === 'slide') event.stopPropagation();
    deps.run(command);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    // Whatever has focus by now: a key that went down must be allowed to come up.
    if (isHideHomeKey(event)) deps.releaseHideHome();
  };

  // In the capture phase, so the shortcuts are decided before any control or the map sees the key.
  win.addEventListener('keydown', onKeyDown, { capture: true });
  win.addEventListener('keyup', onKeyUp, { capture: true });
}
