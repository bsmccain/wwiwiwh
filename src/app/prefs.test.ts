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
    expect(loadPrefs('en-US', fakeStorage())).toEqual({ units: 'mi', themeChoice: 'auto', slideHintDone: false, shortcutsOn: true });
    expect(loadPrefs('fr-FR', fakeStorage()).units).toBe('km');
    expect(loadPrefs('en-US', null).units).toBe('mi');
  });

  it('round-trips saved settings', () => {
    const store = fakeStorage();
    savePrefs({ units: 'km', themeChoice: 'dark', slideHintDone: true, shortcutsOn: false }, store);
    expect(loadPrefs('en-US', store)).toEqual({ units: 'km', themeChoice: 'dark', slideHintDone: true, shortcutsOn: false });
  });

  it('ignores corrupt or hostile stored values', () => {
    expect(loadPrefs('en-US', fakeStorage({ 'wwiwiwh:prefs:v1': '{not json' })).units).toBe('mi');
    const odd = fakeStorage({ 'wwiwiwh:prefs:v1': JSON.stringify({ units: 'furlongs', themeChoice: 7, slideHintDone: 'yes' }) });
    expect(loadPrefs('de-DE', odd)).toEqual({ units: 'km', themeChoice: 'auto', slideHintDone: false, shortcutsOn: true });
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
    expect(() => savePrefs({ units: 'mi', themeChoice: 'auto', slideHintDone: false, shortcutsOn: true }, broken)).not.toThrow();
  });
});
