import type { Theme, ThemeChoice } from './types';

/**
 * The inks of the printed sheet, for code that cannot read CSS custom properties (map styles,
 * canvas-drawn images). Keep in step with src/styles/tokens.css.
 */
export interface Inks {
  /** The paper: page and map ground. */
  readonly sheet: string;
  /** The key ink: text, the pin, rings, the trip line. */
  readonly key: string;
  readonly key2: string;
  /** Home: the overprinted place you know. */
  readonly home: string;
  /** Away: the sheet underneath. */
  readonly away: string;
  readonly awayDeep: string;
}

export const INKS: Readonly<Record<Theme, Inks>> = {
  light: { sheet: '#F5F7F4', key: '#16202A', key2: '#47525E', home: '#C8102E', away: '#2A5CAA', awayDeep: '#1B3A6F' },
  dark: { sheet: '#0F1C2E', key: '#F1EEE4', key2: '#B4BCC8', home: '#FF8F4A', away: '#5A88CF', awayDeep: '#A9C4EE' },
};

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'auto') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}
