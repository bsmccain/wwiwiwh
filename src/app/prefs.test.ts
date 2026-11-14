import { describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs } from './prefs';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('prefs', () => {
  it('defaults units from the locale and theme to auto', () => {
    expect(loadPrefs('en-US', fakeStorage())).toEqual({
      units: 'mi',
      themeChoice: 'auto',
      ground: 'away',
      inkSet: 'classic',
      slideHintDone: false,
      shortcutsOn: true,
    });
    expect(loadPrefs('fr-FR', fakeStorage()).units).toBe('km');
    expect(loadPrefs('en-US', null).units).toBe('mi');
  });

  it('round-trips saved settings', () => {
    const store = fakeStorage();
    const prefs = { units: 'km', themeChoice: 'dark', ground: 'home', inkSet: 'thistle', slideHintDone: true, shortcutsOn: false } as const;
    savePrefs(prefs, store);
    expect(loadPrefs('en-US', store)).toEqual(prefs);
  });

  it('ignores corrupt or hostile stored values', () => {
    expect(loadPrefs('en-US', fakeStorage({ 'wwiwiwh:prefs:v1': '{not json' })).units).toBe('mi');
    const odd = fakeStorage({
      'wwiwiwh:prefs:v1': JSON.stringify({ units: 'furlongs', themeChoice: 7, ground: 'mars', inkSet: 'sepia', slideHintDone: 'yes' }),
    });
    expect(loadPrefs('de-DE', odd)).toEqual({
      units: 'km',
      themeChoice: 'auto',
      ground: 'away',
      inkSet: 'classic',
      slideHintDone: false,
      shortcutsOn: true,
    });
  });

  it('never throws when storage refuses', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => loadPrefs('en-US', broken)).not.toThrow();
    expect(() =>
      savePrefs({ units: 'mi', themeChoice: 'auto', ground: 'away', inkSet: 'classic', slideHintDone: false, shortcutsOn: true }, broken),
    ).not.toThrow();
  });
});
