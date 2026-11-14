import { afterEach, describe, expect, it, vi } from 'vitest';
import { destination } from '../geo/distance';
import type { LngLat } from '../geo/types';
import type { RecentStorage } from './recent';
import {
  MAX_REMEMBERED_SPOTS,
  recentSpotsIn,
  recentSpotsNear,
  recentSpotsNearIn,
  type RememberedSpot,
  rememberSpot,
  rememberSpotIn,
} from './recent-spots';

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

const LONDON: LngLat = { lat: 51.5074, lng: -0.1278 };
const SAN_JOSE: LngLat = { lat: 37.3362, lng: -121.8906 };

const spot = (name: string, position: LngLat, context = 'Somewhere'): RememberedSpot => ({ name, context, position });
const downingStreet = spot('10 Downing Street', { lat: 51.50349, lng: -0.1277 }, 'Covent Garden, London');
const heathrow = spot('Heathrow Airport', { lat: 51.46774, lng: -0.45878 }, 'London Borough of Hillingdon, London');
const infiniteLoop = spot('Infinite Loop 1', { lat: 37.33167, lng: -122.0301 }, '1 Infinite Loop, Cupertino');
const names = (spots: readonly RememberedSpot[]): string[] => spots.map((remembered) => remembered.name);

describe('remembered spots', () => {
  it('start empty', () => {
    expect(recentSpotsIn(new FakeStorage())).toEqual([]);
  });

  it('are listed newest first, as they were picked', () => {
    const storage = new FakeStorage();
    rememberSpotIn(storage, downingStreet);
    rememberSpotIn(storage, infiniteLoop);
    rememberSpotIn(storage, heathrow);
    expect(recentSpotsIn(storage)).toEqual([heathrow, infiniteLoop, downingStreet]);
  });

  it('move to the front when picked again, instead of being listed twice', () => {
    const storage = new FakeStorage();
    rememberSpotIn(storage, downingStreet);
    rememberSpotIn(storage, heathrow);
    rememberSpotIn(storage, { ...downingStreet, name: '10 downing street', position: destination(downingStreet.position, 90, 40) });
    const recent = recentSpotsIn(storage);
    expect(names(recent)).toEqual(['10 downing street', 'Heathrow Airport']);
    expect(recent[0]?.position).not.toEqual(downingStreet.position);
  });

  it('keep two spots of one name that are more than 50 m apart, and two names at one spot', () => {
    const storage = new FakeStorage();
    rememberSpotIn(storage, spot('Starbucks', LONDON));
    rememberSpotIn(storage, spot('Starbucks', destination(LONDON, 0, 60)));
    rememberSpotIn(storage, spot('Pret A Manger', LONDON));
    expect(names(recentSpotsIn(storage))).toEqual(['Pret A Manger', 'Starbucks', 'Starbucks']);
  });

  it(`keep the last ${MAX_REMEMBERED_SPOTS}`, () => {
    const storage = new FakeStorage();
    for (let index = 0; index < 15; index++) rememberSpotIn(storage, spot(`Spot ${index}`, { lat: index, lng: index }));
    expect(MAX_REMEMBERED_SPOTS).toBe(12);
    expect(names(recentSpotsIn(storage))).toEqual(Array.from({ length: 12 }, (_, index) => `Spot ${14 - index}`));
  });

  it('skip entries that cannot be read and survive nonsense', () => {
    const storage = new FakeStorage();
    rememberSpotIn(storage, downingStreet);
    const [key] = [...storage.items.keys()] as [string];
    storage.setItem(
      key,
      JSON.stringify([
        null,
        'Heathrow',
        { name: '', context: '', lat: 1, lng: 1 },
        { name: 'No latitude', context: '', lng: 1 },
        { name: 'Off the map', context: '', lat: 89, lng: 0 },
        { name: 'Text numbers', context: '', lat: '51.5', lng: '0' },
        { name: 'No context', lat: 31.25, lng: -24.25 },
        { name: '10 Downing Street', context: 'Covent Garden, London', lat: 51.50349, lng: -0.1277 },
      ]),
    );
    expect(recentSpotsIn(storage)).toEqual([spot('No context', { lat: 31.25, lng: -24.25 }, ''), downingStreet]);
    for (const nonsense of ['', 'not json', '{"a":1}', '42', 'null']) {
      storage.setItem(key, nonsense);
      expect(recentSpotsIn(storage)).toEqual([]);
    }
  });

  it('never throw when storage is missing or refuses to work', () => {
    expect(recentSpotsIn(null)).toEqual([]);
    expect(recentSpotsNearIn(null, LONDON, 6)).toEqual([]);
    expect(() => rememberSpotIn(null, heathrow)).not.toThrow();
    expect(recentSpotsIn(brokenStorage)).toEqual([]);
    expect(recentSpotsNearIn(brokenStorage, LONDON, 6)).toEqual([]);
    expect(() => rememberSpotIn(brokenStorage, heathrow)).not.toThrow();
  });
});

describe('remembered spots near a place', () => {
  it('are those within 150 km of it, newest first', () => {
    const storage = new FakeStorage();
    rememberSpotIn(storage, downingStreet);
    rememberSpotIn(storage, infiniteLoop);
    rememberSpotIn(storage, spot('Just in reach', destination(LONDON, 300, 149_000)));
    rememberSpotIn(storage, spot('Just out of reach', destination(LONDON, 300, 151_000)));
    rememberSpotIn(storage, heathrow);
    expect(names(recentSpotsNearIn(storage, LONDON, 6))).toEqual(['Heathrow Airport', 'Just in reach', '10 Downing Street']);
    expect(recentSpotsNearIn(storage, SAN_JOSE, 6)).toEqual([infiniteLoop]);
    expect(recentSpotsNearIn(storage, { lat: -33.87, lng: 151.21 }, 6)).toEqual([]);
  });

  it('are cut to the number asked for after the far ones are left out', () => {
    const storage = new FakeStorage();
    for (let index = 0; index < 5; index++) {
      rememberSpotIn(storage, spot(`London ${index}`, destination(LONDON, 0, 1000 * (index + 1))));
      rememberSpotIn(storage, spot(`San Jose ${index}`, destination(SAN_JOSE, 0, 1000 * (index + 1))));
    }
    expect(names(recentSpotsNearIn(storage, LONDON, 3))).toEqual(['London 4', 'London 3', 'London 2']);
  });
});

describe('rememberSpot and recentSpotsNear', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('use the browser’s localStorage, under a key of their own', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('localStorage', storage);
    rememberSpot(downingStreet);
    rememberSpot(heathrow);
    expect(recentSpotsNear(LONDON, 6)).toEqual([heathrow, downingStreet]);
    expect([...storage.items.keys()]).toEqual(['wwiwiwh.recent-spots']);
  });

  it('work as "nothing yet" when localStorage does not exist', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => rememberSpot(heathrow)).not.toThrow();
    expect(recentSpotsNear(LONDON, 6)).toEqual([]);
  });

  it('work as "nothing yet" when even reading localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied.', 'SecurityError');
      },
    });
    try {
      expect(() => rememberSpot(heathrow)).not.toThrow();
      expect(recentSpotsNear(LONDON, 6)).toEqual([]);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
