import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DualMap, Sheet } from '../map/contracts';
import { createPlaceReader, type PlaceReader } from './place-reader';
import type { TileFeature, TileLayer } from './tile-places';

const EXTENT = 4096;

/** Simulated time spent decoding tiles, on top of the timers' clock. */
let spentReading = 0;
const now = (): number => Date.now() + spentReading;

/** As much of a MapLibre tile as the reader goes through, with one town in its middle. */
class FakeTile {
  decodes = 0;
  readonly tileID: { canonical: { z: number; x: number; y: number } };
  latestFeatureIndex: { rawTileData: ArrayBuffer; loadVTLayers: () => Record<string, TileLayer> };

  constructor(
    readonly id: string,
    x: number,
    town: string,
    /** How long decoding it takes on the simulated clock. */
    costMs = 0,
  ) {
    const feature: TileFeature = {
      type: 1,
      extent: EXTENT,
      properties: { class: 'town', rank: 11, name: town },
      loadGeometry: () => [[{ x: EXTENT / 2, y: EXTENT / 2 }]],
    };
    this.tileID = { canonical: { z: 10, x, y: 340 } };
    this.latestFeatureIndex = {
      rawTileData: new ArrayBuffer(1),
      loadVTLayers: () => {
        this.decodes++;
        spentReading += costMs;
        return { place: { length: 1, feature: () => feature } };
      },
    };
  }

  /** The map parsed the tile again for a new style: the same data behind a new index. */
  reparse(): void {
    this.latestFeatureIndex = { ...this.latestFeatureIndex };
  }
}

/** As much of a MapLibre map as the reader goes through. */
class FakeMap {
  private readonly tiles = new Map<string, FakeTile>();
  private readonly sourceDataListeners = new Set<(event: unknown) => void>();
  allLoaded = true;
  readonly style = {
    tileManagers: {
      omt: {
        getRenderableIds: (): string[] => [...this.tiles.keys()],
        getTileByID: (id: string): FakeTile | undefined => this.tiles.get(id),
      },
    },
  };

  on(_type: 'sourcedata', listener: (event: unknown) => void): void {
    this.sourceDataListeners.add(listener);
  }
  off(_type: 'sourcedata', listener: (event: unknown) => void): void {
    this.sourceDataListeners.delete(listener);
  }
  loaded = (): boolean => this.allLoaded;
  areTilesLoaded = (): boolean => this.allLoaded;

  /** A tile arrives from the network. */
  arrive(...tiles: FakeTile[]): void {
    for (const tile of tiles) {
      this.tiles.set(tile.id, tile);
      for (const listener of this.sourceDataListeners) listener({ sourceId: 'omt', tile: {} });
    }
  }
  /** Tiles come back from the map's own cache, or are already there: no event. */
  put(...tiles: FakeTile[]): void {
    for (const tile of tiles) this.tiles.set(tile.id, tile);
  }
  drop(id: string): void {
    this.tiles.delete(id);
  }
  get listenerCount(): number {
    return this.sourceDataListeners.size;
  }
}

interface Rig {
  readonly reader: PlaceReader;
  readonly home: FakeMap;
  readonly away: FakeMap;
  readonly onRead: ReturnType<typeof vi.fn>;
  /** Says whether the picture is in motion from now on. */
  setMoving(moving: boolean): void;
  frame(): void;
  liveNames(sheet: Sheet): string[];
}

function rig(prepare?: (home: FakeMap, away: FakeMap) => void): Rig {
  const home = new FakeMap();
  const away = new FakeMap();
  prepare?.(home, away);
  const frameListeners = new Set<() => void>();
  const dual = {
    base: away as unknown as MapLibreMap,
    overlay: home as unknown as MapLibreMap,
    on: (_type: string, listener: () => void) => {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
  } as unknown as Pick<DualMap, 'base' | 'overlay' | 'on'>;
  const onRead = vi.fn();
  let moving = false;
  const reader = createPlaceReader({ dual, isMoving: () => moving, onRead, now });
  return {
    reader,
    home,
    away,
    onRead,
    setMoving(next) {
      moving = next;
    },
    frame() {
      for (const listener of frameListeners) listener();
    },
    liveNames: (sheet) => reader.books[sheet].live.map((place) => place.name).sort(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  spentReading = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createPlaceReader', () => {
  it('reads at once the tiles the maps are already showing', () => {
    const { reader, liveNames } = rig((home, away) => {
      home.put(new FakeTile('h1', 163, 'Palo Alto'));
      away.put(new FakeTile('a1', 511, 'Watford'), new FakeTile('a2', 512, 'Ilford'));
    });
    expect(liveNames('home')).toEqual(['Palo Alto']);
    expect(liveNames('away')).toEqual(['Ilford', 'Watford']);
    expect(reader.isComplete('away')).toBe(true);
  });

  it('holds nothing to be complete while a map is still loading with no tile in', () => {
    const { reader } = rig((_home, away) => {
      away.allLoaded = false;
    });
    expect(reader.isComplete('away')).toBe(false);
    expect(reader.isComplete('home')).toBe(true);
  });

  it('letters a tile that arrives, shortly after, and says so', () => {
    const { reader, away, onRead, liveNames } = rig();
    const heard = vi.fn();
    reader.onChange(heard);
    away.arrive(new FakeTile('a1', 511, 'Watford'));
    expect(liveNames('away')).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(liveNames('away')).toEqual(['Watford']);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('decodes a tile once, however often the picture changes', () => {
    const tile = new FakeTile('a1', 511, 'Watford');
    const { away, frame } = rig();
    away.arrive(tile);
    for (let round = 0; round < 20; round++) {
      frame();
      vi.advanceTimersByTime(300);
    }
    expect(tile.decodes).toBe(1);
  });

  it('does not decode a tile again when the map only parsed it afresh for a new style', () => {
    const tile = new FakeTile('a1', 511, 'Watford');
    const { away, liveNames } = rig((_home, map) => map.put(tile));
    tile.reparse();
    away.arrive(tile);
    vi.advanceTimersByTime(400);
    expect(tile.decodes).toBe(1);
    expect(liveNames('away')).toEqual(['Watford']);
  });

  it('drops the places of a tile that left the picture, and takes them back without decoding again', () => {
    const watford = new FakeTile('a1', 511, 'Watford');
    const { away, frame, liveNames } = rig((_home, map) => map.put(watford, new FakeTile('a2', 512, 'Ilford')));
    away.drop('a1');
    frame();
    vi.advanceTimersByTime(300);
    expect(liveNames('away')).toEqual(['Ilford']);
    away.put(watford);
    frame();
    vi.advanceTimersByTime(300);
    expect(liveNames('away')).toEqual(['Ilford', 'Watford']);
    expect(watford.decodes).toBe(1);
  });

  it('reads tiles a slice at a time, and brings the places up to date in a task after the last', () => {
    const tiles = [1, 2, 3, 4, 5].map((n) => new FakeTile(`a${n}`, 510 + n, `Town ${n}`, 3));
    const { away, onRead, liveNames } = rig();
    away.arrive(...tiles);
    const decoded = (): number => tiles.reduce((sum, tile) => sum + tile.decodes, 0);

    vi.advanceTimersByTime(250);
    // Each tile takes longer than a slice may: one per slice.
    expect(decoded()).toBe(1);
    vi.advanceTimersByTime(32);
    expect(decoded()).toBe(2);
    vi.advanceTimersByTime(3 * 32);
    expect(decoded()).toBe(5);
    expect(liveNames('away')).toEqual([]);
    vi.advanceTimersByTime(32);
    expect(liveNames('away')).toHaveLength(5);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('reads several small tiles in one slice', () => {
    const tiles = [1, 2, 3, 4, 5, 6].map((n) => new FakeTile(`a${n}`, 510 + n, `Town ${n}`, 0.25));
    const { away } = rig();
    away.arrive(...tiles);
    vi.advanceTimersByTime(250);
    expect(tiles.map((tile) => tile.decodes)).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it('brings the places up to date only now and then while the picture is in motion', () => {
    const state = rig((_home, away) => away.put(new FakeTile('a1', 511, 'Watford')));
    state.setMoving(true);
    // Past the interval since the places were first brought up to date.
    vi.advanceTimersByTime(3000);
    state.away.arrive(new FakeTile('a2', 512, 'Ilford'));
    vi.advanceTimersByTime(600);
    expect(state.liveNames('away')).toEqual(['Ilford', 'Watford']);

    state.away.arrive(new FakeTile('a3', 513, 'Romford'));
    vi.advanceTimersByTime(2000);
    expect(state.liveNames('away')).toEqual(['Ilford', 'Watford']);
    vi.advanceTimersByTime(1000);
    expect(state.liveNames('away')).toEqual(['Ilford', 'Romford', 'Watford']);
  });

  it('waits for the tiles still on their way before an update at rest, but not for long', () => {
    const { away, liveNames } = rig();
    away.allLoaded = false;
    away.arrive(new FakeTile('a1', 511, 'Watford'));
    vi.advanceTimersByTime(600);
    expect(liveNames('away')).toEqual([]);
    vi.advanceTimersByTime(1200);
    expect(liveNames('away')).toEqual(['Watford']);
  });

  it('holds a sheet to be complete once read at rest, until its tiles may have changed', () => {
    const { reader, away, frame } = rig();
    away.allLoaded = false;
    away.arrive(new FakeTile('a1', 511, 'Watford'));
    vi.advanceTimersByTime(2000);
    expect(reader.isComplete('away')).toBe(false);
    away.allLoaded = true;
    expect(reader.readAtIdle()).toBe(true);
    expect(reader.isComplete('away')).toBe(true);
    frame();
    expect(reader.isComplete('away')).toBe(false);
  });

  it('reads everything that is left when the pair comes to rest', () => {
    const tiles = [1, 2, 3, 4].map((n) => new FakeTile(`a${n}`, 510 + n, `Town ${n}`, 3));
    const { reader, away, onRead, liveNames } = rig();
    away.arrive(...tiles);
    expect(reader.readAtIdle()).toBe(true);
    expect(liveNames('away')).toHaveLength(4);
    vi.advanceTimersByTime(1000);
    expect(onRead).not.toHaveBeenCalled();
    expect(tiles.map((tile) => tile.decodes)).toEqual([1, 1, 1, 1]);
  });

  it('keeps to slices at such a moment while Home is being moved, then reports', () => {
    const tiles = [1, 2, 3].map((n) => new FakeTile(`h${n}`, 160 + n, `Town ${n}`, 3));
    const state = rig();
    state.setMoving(true);
    state.home.arrive(...tiles);
    expect(state.reader.readAtIdle()).toBe(false);
    expect(tiles.map((tile) => tile.decodes)).toEqual([1, 0, 0]);
    expect(state.liveNames('home')).toEqual([]);
    vi.advanceTimersByTime(3 * 32);
    expect(state.liveNames('home')).toHaveLength(3);
    expect(state.onRead).toHaveBeenCalledTimes(1);
  });

  it('tells its listeners only of changes', () => {
    const { reader, away, frame } = rig((_home, map) => map.put(new FakeTile('a1', 511, 'Watford')));
    const heard = vi.fn();
    const stop = reader.onChange(heard);
    frame();
    vi.advanceTimersByTime(300);
    expect(heard).not.toHaveBeenCalled();
    away.arrive(new FakeTile('a2', 512, 'Ilford'));
    vi.advanceTimersByTime(400);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    away.arrive(new FakeTile('a3', 513, 'Romford'));
    vi.advanceTimersByTime(400);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('stops reading and listening once destroyed', () => {
    const tile = new FakeTile('a1', 511, 'Watford');
    const { reader, home, away, onRead } = rig();
    away.arrive(tile);
    reader.destroy();
    vi.advanceTimersByTime(5000);
    expect(tile.decodes).toBe(0);
    expect(onRead).not.toHaveBeenCalled();
    expect(home.listenerCount + away.listenerCount).toBe(0);
    expect(reader.readAtIdle()).toBe(true);
  });
});
