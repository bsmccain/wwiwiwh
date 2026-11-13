import './notes.css';
import { el } from './dom';

const STATUS_MS = 4000;
/** Failures stay up longer: they ask the person to do something. */
const ALERT_MS = 7000;

export interface Toasts {
  /** Shows one line, replacing any line still up. Failures are announced at once (`alert`). */
  show(message: string, options?: { alert?: boolean }): void;
}

/** One quiet line at a time, just above the caption. It goes away by itself, but waits while pointed at. */
export function createToasts(host: HTMLElement): Toasts {
  // Both regions are in the page from the start: a live region added together with its text is not announced.
  const status = el('div', 'toasts__region', { role: 'status' });
  const alert = el('div', 'toasts__region', { role: 'alert' });
  const root = el('div', 'toasts', {}, [status, alert]);
  host.append(root);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lifetime = STATUS_MS;
  let paused = false;

  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const clear = (): void => {
    stopTimer();
    status.replaceChildren();
    alert.replaceChildren();
  };
  const startTimer = (): void => {
    stopTimer();
    if (!paused) timer = setTimeout(clear, lifetime);
  };
  const pause = (on: boolean): void => {
    paused = on;
    if (on) stopTimer();
    else if (root.querySelector('.toast')) startTimer();
  };

  root.addEventListener('pointerenter', () => pause(true));
  root.addEventListener('pointerleave', () => pause(false));

  return {
    show(message, options) {
      clear();
      lifetime = options?.alert ? ALERT_MS : STATUS_MS;
      (options?.alert ? alert : status).append(el('p', 'toast', {}, [message]));
      startTimer();
    },
  };
}
