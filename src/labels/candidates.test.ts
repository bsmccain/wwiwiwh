import { describe, expect, it } from 'vitest';
import { PlaceBook, readPlace, type PlaceClass, type RawPlace } from './candidates';

function raw(name: string, placeClass: PlaceClass, rank: number, lng: number, lat: number): RawPlace {
  return { name, placeClass, rank, position: { lng, lat } };
}

/** Enters each list as one tile's places and puts exactly those tiles on show. */
function showTiles(book: PlaceBook, ...tiles: RawPlace[][]): boolean {
  return book.show(tiles.map((tile) => book.enter(tile)));
}

describe('readPlace', () => {
  const tokyoAt = { lng: 139.77, lat: 35.68 };
  const watfordAt = { lng: -0.39, lat: 51.65 };

  it('prefers the English name, then the Latin spelling, then the local name', () => {
    const tokyo = { class: 'city', rank: 1, name: '東京都', 'name:latin': 'Tōkyō', name_en: 'Tokyo' };
    expect(readPlace(tokyo, tokyoAt)?.name).toBe('Tokyo');
    expect(readPlace({ ...tokyo, name_en: undefined }, tokyoAt)?.name).toBe('Tōkyō');
    expect(readPlace({ class: 'city', rank: 1, name: '東京都' }, tokyoAt)?.name).toBe('東京都');
  });

  it('skips blank names and falls through to the next field', () => {
    expect(readPlace({ class: 'town', name_en: '  ', name: 'Watford' }, watfordAt)?.name).toBe('Watford');
    expect(readPlace({ class: 'town', name_en: '' }, watfordAt)).toBeNull();
  });

  it('keeps class, rank and position', () => {
    expect(readPlace({ class: 'suburb', rank: 13, name_en: 'Soho' }, { lng: -0.1365, lat: 51.5136 })).toEqual({
      name: 'Soho',
      placeClass: 'suburb',
      rank: 13,
      position: { lng: -0.1365, lat: 51.5136 },
    });
  });

  it.each(['island', 'country', 'state', 'province', 'continent', 'aboriginal_lands', undefined])(
    'turns down class %s',
    (placeClass) => {
      expect(readPlace({ class: placeClass, rank: 1, name_en: 'Somewhere' }, { lng: 0, lat: 0 })).toBeNull();
    },
  );

  it('turns down a place without a position', () => {
    expect(readPlace({ class: 'town', name_en: 'Line' }, null)).toBeNull();
  });

  it('puts a place without a rank behind every ranked one', () => {
    const unranked = readPlace({ class: 'village', name_en: 'Nowhere' }, { lng: 0, lat: 0 });
    expect(unranked?.rank).toBeGreaterThan(500);
  });
});

describe('PlaceBook: de-duplication', () => {
  it('makes one place of the copies that arrive from neighbouring tiles', () => {
    const book = new PlaceBook();
    showTiles(book, [
      raw('Watford', 'town', 11, -0.3957, 51.6554),
      raw('Watford', 'town', 11, -0.3957000001, 51.6554),
      raw('Watford', 'town', 11, -0.3957, 51.6554000002),
      raw('Bushey', 'town', 12, -0.3606, 51.6435),
    ]);
    expect(book.live.map((place) => place.name)).toEqual(['Watford', 'Bushey']);
  });

  it('keeps the best rank when tiles cut for two zooms disagree', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Palo Alto', 'city', 14, -122.1598, 37.4443), raw('Palo Alto', 'city', 11, -122.16, 37.4444)]);
    expect(book.live).toHaveLength(1);
    expect(book.live[0]?.rank).toBe(11);
  });

  it('keeps two places of the same name apart when they are far from each other', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Newtown', 'suburb', 12, -0.2, 51.5), raw('Newtown', 'suburb', 12, -0.2, 51.6)]);
    expect(book.live).toHaveLength(2);
    expect(new Set(book.live.map((place) => place.id)).size).toBe(2);
  });

  it('keeps a city and a quarter of the same name apart', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Westminster', 'city', 12, -0.1357, 51.4975), raw('Westminster', 'quarter', 41, -0.1357, 51.4975)]);
    expect(book.live.map((place) => place.placeClass)).toEqual(['city', 'quarter']);
  });

  it('merges copies on either side of a cell edge', () => {
    // 0.04 degrees is an edge of the grid the ids are built on.
    const book = new PlaceBook();
    showTiles(book, [raw('Edge', 'town', 11, 0.03999, 0.07999), raw('Edge', 'town', 11, 0.04001, 0.08001)]);
    expect(book.live).toHaveLength(1);
  });
});

describe('PlaceBook: from one read to the next', () => {
  it('gives the same place the same id when its position moves by a tile unit', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Ealing', 'town', 11, -0.3051, 51.5127)]);
    const before = book.live[0];
    showTiles(book, [raw('Ealing', 'town', 13, -0.30502, 51.51275)]);
    const after = book.live[0];
    expect(after?.id).toBe(before?.id);
    expect(after?.rank).toBe(13);
    expect(after?.position).toEqual({ lng: -0.30502, lat: 51.51275 });
  });

  it('keeps an id across a cell edge', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Edge', 'town', 11, 0.03999, 0.07999)]);
    const id = book.live[0]?.id;
    showTiles(book, [raw('Edge', 'town', 11, 0.04001, 0.08001)]);
    expect(book.live[0]?.id).toBe(id);
  });

  it('reports whether anything changed', () => {
    const book = new PlaceBook();
    const read = [raw('Ealing', 'town', 11, -0.3051, 51.5127), raw('Acton', 'suburb', 12, -0.2674, 51.5081)];
    expect(showTiles(book, read)).toBe(true);
    expect(showTiles(book, read)).toBe(false);
    expect(showTiles(book, [...read].reverse())).toBe(false);
    expect(showTiles(book, [read[0] as RawPlace])).toBe(true);
    expect(showTiles(book, [{ ...(read[0] as RawPlace), rank: 12 }])).toBe(true);
    expect(showTiles(book, [])).toBe(true);
    expect(showTiles(book, [])).toBe(false);
  });

  it('hands back the very same object for a place that did not change', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Ealing', 'town', 11, -0.3051, 51.5127)]);
    const first = book.live[0];
    showTiles(book, [raw('Ealing', 'town', 11, -0.3051, 51.5127)]);
    expect(book.live[0]).toBe(first);
  });

  it('remembers places whose tiles are gone, but letters only the live ones', () => {
    const book = new PlaceBook();
    showTiles(book, [raw('Watford', 'town', 11, -0.3957, 51.6554)]);
    showTiles(book, [raw('Soho', 'suburb', 14, -0.1365, 51.5136)]);
    expect(book.live.map((place) => place.name)).toEqual(['Soho']);
    expect([...book.all()].map((place) => place.name).sort()).toEqual(['Soho', 'Watford']);
  });

  it('counts a generation each time the live places are replaced wholesale', () => {
    const book = new PlaceBook();
    expect(book.generation).toBe(0);
    showTiles(book, []);
    expect(book.generation).toBe(0);
    showTiles(book, [raw('Ealing', 'town', 11, -0.3051, 51.5127), raw('Acton', 'suburb', 12, -0.2674, 51.5081)]);
    expect(book.generation).toBe(1);
    // Panning on: one place stays, one is new.
    showTiles(book, [raw('Acton', 'suburb', 12, -0.2674, 51.5081), raw('Soho', 'suburb', 14, -0.1365, 51.5136)]);
    expect(book.generation).toBe(1);
    // Another zoom's tiles: the same place with another rank.
    showTiles(book, [raw('Soho', 'suburb', 11, -0.1365, 51.5136)]);
    expect(book.generation).toBe(1);
    // Another city.
    showTiles(book, [raw('Palo Alto', 'city', 11, -122.1598, 37.4443)]);
    expect(book.generation).toBe(2);
    // Tiles gone for a moment, then the same city again.
    showTiles(book, []);
    showTiles(book, [raw('Palo Alto', 'city', 11, -122.1598, 37.4443)]);
    expect(book.generation).toBe(3);
  });

  it('forgets the places seen longest ago once it is full', () => {
    const book = new PlaceBook(3);
    showTiles(book, [raw('A', 'town', 11, 0, 0), raw('B', 'town', 11, 1, 0)]);
    showTiles(book, [raw('A', 'town', 11, 0, 0), raw('C', 'town', 11, 2, 0), raw('D', 'town', 11, 3, 0)]);
    expect([...book.all()].map((place) => place.name).sort()).toEqual(['A', 'C', 'D']);
  });
});

describe('PlaceBook: tile by tile', () => {
  const watford = raw('Watford', 'town', 11, -0.3957, 51.6554);
  const bushey = raw('Bushey', 'town', 12, -0.3606, 51.6435);

  it('gives the copy of a place in a neighbouring tile the same id', () => {
    const book = new PlaceBook();
    const here = book.enter([watford]);
    const there = book.enter([{ ...watford, position: { lng: -0.39572, lat: 51.65541 } }, bushey]);
    expect(there[0]?.id).toBe(here[0]?.id);
    book.show([here, there]);
    expect(book.live.map((place) => place.name)).toEqual(['Watford', 'Bushey']);
  });

  it('letters nothing until its tiles are put on show', () => {
    const book = new PlaceBook();
    book.enter([watford, bushey]);
    expect(book.live).toEqual([]);
    expect([...book.all()].map((place) => place.name)).toEqual(['Watford', 'Bushey']);
  });

  it('keeps the best rank among the tiles on show, and takes it back when that tile goes', () => {
    const book = new PlaceBook();
    const coarse = book.enter([{ ...watford, rank: 11 }]);
    const fine = book.enter([{ ...watford, rank: 14 }]);
    book.show([fine, coarse]);
    expect(book.live[0]?.rank).toBe(11);
    expect(book.show([fine])).toBe(true);
    expect(book.live[0]?.rank).toBe(14);
  });

  it('keeps the live list as it is when the same tiles are shown again', () => {
    const book = new PlaceBook();
    const tiles = [book.enter([watford]), book.enter([bushey, watford])];
    book.show(tiles);
    const live = book.live;
    expect(book.show(tiles)).toBe(false);
    expect(book.show([...tiles].reverse())).toBe(false);
    expect(book.live).toBe(live);
  });

  it('reports a place that became known even when it is not put on show', () => {
    const book = new PlaceBook();
    const shown = book.enter([watford]);
    expect(book.show([shown])).toBe(true);
    book.enter([bushey]);
    expect(book.show([shown])).toBe(true);
    expect(book.show([shown])).toBe(false);
    expect(book.live.map((place) => place.name)).toEqual(['Watford']);
  });

  it('puts a place back on show from a tile read before the place was forgotten', () => {
    const book = new PlaceBook(1);
    const first = book.enter([watford]);
    book.show([first]);
    showTiles(book, [bushey]);
    expect([...book.all()].map((place) => place.name)).toEqual(['Bushey']);
    book.show([first]);
    expect(book.live.map((place) => place.name)).toEqual(['Watford']);
  });
});
