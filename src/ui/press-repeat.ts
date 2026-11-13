/** How long a button is held before it starts repeating, and how fast it then repeats. */
const FIRST_REPEAT_MS = 400;
const REPEAT_MS = 90;

/**
 * Makes a button act on press and keep acting while it is held, like the arrows of a scroll bar.
 * Enter, Space and assistive technology activate it once per click.
 */
export function bindPressRepeat(button: HTMLButtonElement, act: () => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heldByFinger = false;

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const repeat = (): void => {
    if (button.disabled || !button.isConnected) {
      stop();
      return;
    }
    act();
    timer = setTimeout(repeat, REPEAT_MS);
  };

  button.addEventListener('pointerdown', (event) => {
    if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    stop();
    heldByFinger = event.pointerType === 'touch';
    act();
    timer = setTimeout(repeat, FIRST_REPEAT_MS);
  });
  button.addEventListener('click', (event) => {
    // A click that follows a press was already acted on when the press began; `detail` is 0 only
    // for clicks that came from the keyboard or from assistive technology.
    if (event.detail === 0) act();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur'] as const) {
    button.addEventListener(type, stop);
  }
  button.addEventListener('contextmenu', (event) => {
    // A finger held on the button long enough asks for a context menu; that is the hold, not a wish for a menu.
    if (timer !== null && heldByFinger) event.preventDefault();
    else stop();
  });
}
