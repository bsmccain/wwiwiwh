import { afterEach, describe, expect, it, vi } from 'vitest';
import { presetPlace } from '../app/defaults';
import type { Place } from '../app/types';
import { MAX_RECENT, recentPlaces, recentPlacesIn, rememberPlace, rememberPlaceIn, type RecentStorage } from './recent';

class FakeStorage implements RecentStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const brokenStorage: RecentStorage = {
  getItem() {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem() {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
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
