import { defaultUnits, type Units } from '../geo/units';
import type { ThemeChoice } from './types';

/** The viewer's own settings. They stay on this device and never travel in a shared link. */
export interface Prefs {
  readonly units: Units;
  readonly themeChoice: ThemeChoice;
  /** The one-time hint about sliding Home has been seen or made redundant. */
  readonly slideHintDone: boolean;
  /** Single-letter keyboard shortcuts are on. People who dictate or use switch access may turn them off. */
  readonly shortcutsOn: boolean;
}

const KEY = 'wwiwiwh:prefs:v1';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage can be blocked outright
  }
}

export function loadPrefs(locale: string | undefined, store: Pick<Storage, 'getItem'> | null = storage()): Prefs {
  const fallback: Prefs = { units: defaultUnits(locale), themeChoice: 'auto', slideHintDone: false, shortcutsOn: true };
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    return {
      units: saved.units === 'mi' || saved.units === 'km' ? saved.units : fallback.units,
      themeChoice:
        saved.themeChoice === 'light' || saved.themeChoice === 'dark' || saved.themeChoice === 'auto'
          ? saved.themeChoice
          : fallback.themeChoice,
      slideHintDone: saved.slideHintDone === true,
      shortcutsOn: saved.shortcutsOn !== false,
    };
  } catch {
    return fallback;
  }
}

export function savePrefs(prefs: Prefs, store: Pick<Storage, 'setItem'> | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or a full disk: the setting simply lasts for this visit only.
  }
}
