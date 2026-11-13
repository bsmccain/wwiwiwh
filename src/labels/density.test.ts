import { describe, expect, it } from 'vitest';
import type { PlaceCandidate, PlaceClass } from './candidates';
import { classesAtZoom, MAX_PER_PATCH, namesPerPatch, namesWanted, rankPlaces } from './density';

function candidate(name: string, placeClass: PlaceClass, rank: number, lng: number, lat: number): PlaceCandidate {
  return { name, placeClass, rank, position: { lng, lat }, id: `${placeClass}|${name}|${lng}|${lat}` };
}

describe('classesAtZoom', () => {
  it('letters cities and towns below zoom 11', () => {
    expect([...classesAtZoom(9)].sort()).toEqual(['city', 'town']);
    expect([...classesAtZoom(10.99)].sort()).toEqual(['city', 'town']);
  });

  it('adds suburbs and villages from zoom 11', () => {
    expect([...classesAtZoom(11)].sort()).toEqual(['city', 'suburb', 'town', 'village']);
    expect([...classesAtZoom(12.99)].sort()).toEqual(['city', 'suburb', 'town', 'village']);
  });

  it('adds neighbourhoods, quarters and hamlets from zoom 13', () => {
    expect([...classesAtZoom(13)].sort()).toEqual(['city', 'hamlet', 'neighbourhood', 'quarter', 'suburb', 'town', 'village']);
  });
});

describe('rankPlaces', () => {
  // These five share one patch (a quarter tile) of zoom level 10; Watford lies in another.
  const london = candidate('London', 'city', 1, -0.1276, 51.5073);
  const westminster = candidate('Westminster', 'city', 12, -0.1357, 51.4975);
  const lambeth = candidate('Lambeth', 'town', 12, -0.1172, 51.4941);
  const pimlico = candidate('Pimlico', 'suburb', 13, -0.139, 51.489);
  const millbank = candidate('Millbank', 'quarter', 20, -0.127, 51.492);
  const watford = candidate('Watford', 'town', 11, -0.3957, 51.6554);

  it('leaves out classes that are not lettered at the Away zoom, whatever zoom the sheet itself is at', () => {
    const all = [london, westminster, lambeth, pimlico, millbank];
    expect(rankPlaces(all, 10.9, 11.3).map((r) => r.place.name).sort()).toEqual(['Lambeth', 'London', 'Westminster']);
    expect(rankPlaces(all, 11, 11.3).map((r) => r.place.name).sort()).toEqual(['Lambeth', 'London', 'Pimlico', 'Westminster']);
    expect(rankPlaces(all, 13, 13.3)).toHaveLength(5);
  });

  it('numbers the places of one patch by importance', () => {
    const ranked = rankPlaces([pimlico, lambeth, london, westminster], 11.5, 10.5);
    expect(ranked.map((r) => [r.place.name, r.standing])).toEqual([
      ['London', 1],
      ['Westminster', 2],
      ['Lambeth', 3],
      ['Pimlico', 4],
    ]);
  });

  it('starts counting again in every patch', () => {
    const ranked = rankPlaces([london, westminster, watford], 10, 10);
    const standing = Object.fromEntries(ranked.map((r) => [r.place.name, r.standing]));
    expect(standing).toEqual({ London: 1, Westminster: 2, Watford: 1 });
  });

  it('cuts the ground into smaller patches at a higher sheet zoom', () => {
    // 0.03 degrees apart: one patch at level 10, two at level 13 (0.022 degrees wide).
    const a = candidate('A', 'town', 11, 0.1, 51.5);
    const b = candidate('B', 'town', 12, 0.13, 51.5);
    expect(rankPlaces([a, b], 10, 10.2).map((r) => r.standing)).toEqual([1, 2]);
    expect(rankPlaces([a, b], 10, 13.2).map((r) => r.standing)).toEqual([1, 1]);
  });

  it('puts world-ranked cities first, then the best of every patch, then the second of every patch', () => {
    const ranked = rankPlaces([westminster, watford, london, lambeth], 10, 10);
    expect(ranked.map((r) => [r.place.name, r.priority])).toEqual([
      ['London', 1],
      ['Watford', 11],
      ['Westminster', 12],
      ['Lambeth', 13],
    ]);
  });

  it('orders equals the same way whatever order the tiles came in', () => {
    const a = candidate('Acton', 'suburb', 12, -0.2674, 51.5081);
    const b = candidate('Bow', 'suburb', 12, -0.2675, 51.5082);
    const names = (list: PlaceCandidate[]) => rankPlaces(list, 12, 12).map((r) => r.place.name);
    expect(names([a, b])).toEqual(names([b, a]));
  });

  it('lets a town outrank a suburb of the same rank', () => {
    const town = candidate('Zed Town', 'town', 12, -0.2674, 51.5081);
    const suburb = candidate('Abbey', 'suburb', 12, -0.2675, 51.5082);
    expect(rankPlaces([suburb, town], 12, 12)[0]?.place.name).toBe('Zed Town');
  });
});

describe('namesWanted', () => {
  it('asks for about 25 names on a desktop stage and fewer on a phone', () => {
    const desktop = namesWanted({ width: 1440, height: 900 });
    const phone = namesWanted({ width: 390, height: 844 });
    expect(desktop).toBeGreaterThan(20);
    expect(desktop).toBeLessThan(30);
    expect(phone).toBeGreaterThanOrEqual(8);
    expect(phone).toBeLessThan(desktop / 1.5);
  });

  it('stays within bounds on tiny and huge stages', () => {
    expect(namesWanted({ width: 100, height: 100 })).toBe(namesWanted({ width: 390, height: 844 }));
    expect(namesWanted({ width: 8000, height: 4000 })).toBeLessThanOrEqual(48);
  });
});

describe('namesPerPatch', () => {
  /** Standings of a stage with `patches` patches that each hold `perPatch` places. */
  const stage = (patches: number, perPatch: number) =>
    Array.from({ length: patches * perPatch }, (_, index) => (index % perPatch) + 1);

  it('takes one name per patch when the stage is covered by many patches', () => {
    expect(namesPerPatch(stage(24, 6), 25)).toBe(1);
  });

  it('takes more per patch when the city sits in few patches', () => {
    expect(namesPerPatch(stage(4, 8), 25)).toBe(6);
    expect(namesPerPatch(stage(8, 8), 25)).toBe(3);
  });

  it('never takes more than the limit', () => {
    expect(namesPerPatch(stage(1, 30), 25)).toBe(MAX_PER_PATCH);
  });

  it('takes no more per patch than adds names', () => {
    // Every patch holds two places: asking for more per patch changes nothing.
    expect(namesPerPatch(stage(5, 2), 25)).toBe(2);
  });

  it('settles for one when nothing is on the stage', () => {
    expect(namesPerPatch([], 25)).toBe(1);
  });

  it('keeps the number in use while no other is clearly better', () => {
    // 22 or 44 names for 30 wanted: one per patch is nearer, but not by enough to change.
    expect(namesPerPatch(stage(22, 2), 30)).toBe(1);
    expect(namesPerPatch(stage(22, 2), 30, 2)).toBe(2);
    expect(namesPerPatch(stage(22, 2), 30, 1)).toBe(1);
  });

  it('drops the number in use when another is clearly better', () => {
    expect(namesPerPatch(stage(24, 6), 25, 4)).toBe(1);
    expect(namesPerPatch(stage(4, 8), 25, 1)).toBe(6);
  });

  it('ignores a number in use that makes no sense', () => {
    expect(namesPerPatch(stage(24, 6), 25, 0)).toBe(1);
    expect(namesPerPatch(stage(24, 6), 25, 99)).toBe(1);
  });
});
