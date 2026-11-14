import { afterEach, describe, expect, it, vi } from 'vitest';
import { presetPlace } from '../app/defaults';
import type { Place } from '../app/types';
import {
  clearRecent,
  clearRecentIn,
  keepsRecent,
  keepsRecentIn,
  MAX_RECENT,
  recentPlaces,
  recentPlacesIn,
  rememberPlace,
  rememberPlaceIn,
  type RecentStorage,
  setKeepsRecent,
  setKeepsRecentIn,
} from './recent';
import { recentSpotsIn, rememberSpotIn } from './recent-spots';

class FakeStorage implements RecentStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const brokenStorage: RecentStorage = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
  removeItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

const town = (name: string, lat: number, lng: number, context = 'Somewhere'): Place => ({
  name,
  context,
  center: { lat, lng },
});

const paloAlto = town('Palo Alto', 37.44433, -122.15985, 'California, USA');
const london = presetPlace('london') as Place;
const tokyo = presetPlace('tokyo') as Place;

describe('recent places', () => {
  it('starts empty', () => {
    expect(recentPlacesIn(new FakeStorage())).toEqual([]);
  });

  it('lists the newest first', () => {
    const storage = new FakeStorage();
    rememberPlaceIn(storage, london);
    rememberPlaceIn(storage, paloAlto);
    rememberPlaceIn(storage, tokyo);
    expect(recentPlacesIn(storage)).toEqual([tokyo, paloAlto, london]);
  });

  it('moves a place picked again to the front instead of listing it twice', () => {
    const storage = new FakeStorage();
    rememberPlaceIn(storage, london);
    rememberPlaceIn(storage, paloAlto);
    rememberPlaceIn(storage, london);
    rememberPlaceIn(storage, { ...paloAlto, center: { lat: 37.4419, lng: -122.143 } });
    const recent = recentPlacesIn(storage);
    expect(recent.map((place) => place.name)).toEqual(['Palo Alto', 'London']);
    expect(recent[0]?.center).toEqual({ lat: 37.4419, lng: -122.143 });
  });

  it('keeps namesakes that are far apart', () => {
    const storage = new FakeStorage();
    rememberPlaceIn(storage, town('Springfield', 42.1019, -72.5887, 'Massachusetts, USA'));
    rememberPlaceIn(storage, town('Springfield', 39.799, -89.644, 'Illinois, USA'));
    expect(recentPlacesIn(storage).map((place) => place.context)).toEqual(['Illinois, USA', 'Massachusetts, USA']);
  });

  it(`keeps the last ${MAX_RECENT}`, () => {
    const storage = new FakeStorage();
    for (let index = 0; index < 9; index++) rememberPlaceIn(storage, town(`Town ${index}`, index, index));
    expect(recentPlacesIn(storage).map((place) => place.name)).toEqual([
      'Town 8',
      'Town 7',
      'Town 6',
      'Town 5',
      'Town 4',
      'Town 3',
    ]);
  });

  it('brings a preset back from the curated list, not from what was stored', () => {
    const storage = new FakeStorage();
    rememberPlaceIn(storage, london);
    const [key] = [...storage.items.keys()];
    storage.setItem(key as string, JSON.stringify([{ id: 'london', name: 'Londinium', context: 'Britannia', lat: 1, lng: 2 }]));
    expect(recentPlacesIn(storage)).toEqual([london]);
  });

  it('skips entries it cannot read and survives nonsense', () => {
    const storage = new FakeStorage();
    rememberPlaceIn(storage, paloAlto);
    const [key] = [...storage.items.keys()] as [string];
    storage.setItem(
      key,
      JSON.stringify([
        null,
        'London',
        { name: '', context: '', lat: 1, lng: 1 },
        { name: 'No latitude', context: '', lng: 1 },
        { name: 'Off the map', context: '', lat: 89, lng: 0 },
        { name: 'Text numbers', context: '', lat: '51.5', lng: '0' },
        { id: 'atlantis', name: 'Atlantis', lat: 31.25, lng: -24.25 },
        { name: 'Palo Alto', context: 'California, USA', lat: 37.44433, lng: -122.15985 },
      ]),
    );
    expect(recentPlacesIn(storage)).toEqual([
      { name: 'Atlantis', context: '', center: { lat: 31.25, lng: -24.25 } },
      paloAlto,
    ]);
    for (const nonsense of ['', 'not json', '{"a":1}', '42', 'null']) {
      storage.setItem(key, nonsense);
      expect(recentPlacesIn(storage)).toEqual([]);
    }
  });

  it('never throws when storage is missing or refuses to work', () => {
    expect(recentPlacesIn(null)).toEqual([]);
    expect(() => rememberPlaceIn(null, london)).not.toThrow();
    expect(recentPlacesIn(brokenStorage)).toEqual([]);
    expect(() => rememberPlaceIn(brokenStorage, london)).not.toThrow();
  });
});

describe('recentPlaces and rememberPlace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('use the browser’s localStorage', () => {
    vi.stubGlobal('localStorage', new FakeStorage());
    rememberPlace(london);
    rememberPlace(paloAlto);
    expect(recentPlaces()).toEqual([paloAlto, london]);
  });

  it('work as "nothing yet" when localStorage does not exist', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => rememberPlace(london)).not.toThrow();
    expect(recentPlaces()).toEqual([]);
  });

  it('work as "nothing yet" when even reading localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied.', 'SecurityError');
      },
    });
    try {
      expect(() => rememberPlace(london)).not.toThrow();
      expect(recentPlaces()).toEqual([]);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('clearing and not keeping what was picked', () => {
  const downingStreet = { name: '10 Downing Street', context: 'London', position: { lat: 51.50349, lng: -0.1277 } };
  /** Settings saved by prefs.ts, which clearing must leave alone. */
  const PREFS = ['wwiwiwh:prefs:v1', '{"units":"km","themeChoice":"dark"}'] as const;

  const withHistory = (): FakeStorage => {
    const storage = new FakeStorage();
    storage.setItem(...PREFS);
    rememberPlaceIn(storage, paloAlto);
    rememberSpotIn(storage, downingStreet);
    expect(recentPlacesIn(storage)).toEqual([paloAlto]);
    expect(recentSpotsIn(storage)).toEqual([downingStreet]);
    return storage;
  };

  it('keeps them until told otherwise', () => {
    expect(keepsRecentIn(new FakeStorage())).toBe(true);
  });

  it('clears both the places and the spots, and nothing else', () => {
    const storage = withHistory();
    clearRecentIn(storage);
    expect([...storage.items.keys()]).toEqual([PREFS[0]]);
    expect(storage.getItem(PREFS[0])).toBe(PREFS[1]);
    expect(recentPlacesIn(storage)).toEqual([]);
    expect(recentSpotsIn(storage)).toEqual([]);
    // Clearing is not switching off: the next pick is kept again.
    expect(keepsRecentIn(storage)).toBe(true);
    rememberPlaceIn(storage, tokyo);
    expect(recentPlacesIn(storage)).toEqual([tokyo]);
  });

  it('switched off, clears what was kept and keeps no new picks', () => {
    const storage = withHistory();
    setKeepsRecentIn(storage, false);
    expect(keepsRecentIn(storage)).toBe(false);
    expect(storage.getItem('wwiwiwh.recent-places')).toBeNull();
    expect(storage.getItem('wwiwiwh.recent-spots')).toBeNull();
    rememberPlaceIn(storage, tokyo);
    rememberSpotIn(storage, downingStreet);
    expect(storage.getItem('wwiwiwh.recent-places')).toBeNull();
    expect(storage.getItem('wwiwiwh.recent-spots')).toBeNull();
    expect(storage.getItem(PREFS[0])).toBe(PREFS[1]);
  });

  it('switched off, lists nothing even if a list was written some other way', () => {
    const storage = new FakeStorage();
    setKeepsRecentIn(storage, false);
    storage.setItem('wwiwiwh.recent-places', JSON.stringify([{ name: 'Palo Alto', context: '', lat: 37.4, lng: -122.1 }]));
    storage.setItem('wwiwiwh.recent-spots', JSON.stringify([{ name: 'Somewhere', context: '', lat: 51.5, lng: -0.1 }]));
    expect(recentPlacesIn(storage)).toEqual([]);
    expect(recentSpotsIn(storage)).toEqual([]);
  });

  it('switched back on, keeps picks again', () => {
    const storage = new FakeStorage();
    setKeepsRecentIn(storage, false);
    setKeepsRecentIn(storage, true);
    expect(keepsRecentIn(storage)).toBe(true);
    rememberPlaceIn(storage, tokyo);
    expect(recentPlacesIn(storage)).toEqual([tokyo]);
  });

  it('never throws when storage is missing or refuses to work', () => {
    for (const storage of [null, brokenStorage]) {
      expect(keepsRecentIn(storage)).toBe(false);
      expect(() => clearRecentIn(storage)).not.toThrow();
      expect(() => setKeepsRecentIn(storage, false)).not.toThrow();
      expect(() => setKeepsRecentIn(storage, true)).not.toThrow();
    }
  });

  describe('in the browser', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('use the browser’s localStorage', () => {
      const storage = new FakeStorage();
      vi.stubGlobal('localStorage', storage);
      rememberPlace(london);
      clearRecent();
      expect(recentPlaces()).toEqual([]);
      setKeepsRecent(false);
      expect(keepsRecent()).toBe(false);
      rememberPlace(london);
      expect(storage.getItem('wwiwiwh.recent-places')).toBeNull();
    });
  });
});
