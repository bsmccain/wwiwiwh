import { describe, expect, it } from 'vitest';
import type { Place } from '../app/types';
import { METROS } from '../data/metros';
import { matchPresets, presetFor, searchPresets, WELL_KNOWN } from './presets';

const names = (query: string, limit?: number): string[] => searchPresets(query, limit).map((place) => place.name);

describe('searchPresets', () => {
  it('finds the South Bay, which no geocoder knows', () => {
    expect(names('south bay')[0]).toBe('San Jose');
    expect(names('South Bay')).toEqual(['San Jose']);
    expect(names('silicon valley')[0]).toBe('San Jose');
  });

  it('understands the abbreviations people type', () => {
    expect(names('nyc')[0]).toBe('New York');
    expect(names('sf')[0]).toBe('San Francisco');
    expect(names('dc')[0]).toBe('Washington');
    expect(names('l.a.')[0]).toBe('Los Angeles');
  });

  it('puts a whole-alias match above places that merely start with the letters', () => {
    const found = names('la');
    expect(found[0]).toBe('Los Angeles');
    expect(found.indexOf('Los Angeles')).toBeLessThan(found.indexOf('Las Vegas'));
    expect(found.indexOf('Los Angeles')).toBeLessThan(found.indexOf('Lagos'));
    expect(found).toContain('Las Vegas');
    expect(found).toContain('Lagos');
  });

  it('ignores accents and case in both directions', () => {
    expect(names('sao paulo')).toEqual(['São Paulo']);
    expect(names('SÃO PAULO')).toEqual(['São Paulo']);
    expect(names('munchen')[0]).toBe('Munich');
    expect(names('München')[0]).toBe('Munich');
    expect(names('zurich')).toEqual(['Zurich']);
    expect(names('Zürich')).toEqual(['Zurich']);
    expect(names('montreal')[0]).toBe('Montréal');
    expect(names('LONDON')[0]).toBe('London');
  });

  it('ignores punctuation', () => {
    expect(names('st louis')).toEqual(['St. Louis']);
    expect(names('washington dc')).toEqual(['Washington']);
    expect(names('dallas fort worth')).toEqual(['Dallas']);
  });

  it('ranks the start of a name, then the start of a later word, then a match inside a word', () => {
    // Portland and Porto start with it; Melbourne is also "Port Phillip"; Lisbon is in Portugal; Norfolk has "Newport News".
    expect(names('port')).toEqual(['Portland', 'Porto', 'Melbourne', 'Lisbon', 'Norfolk']);
    expect(names('york')[0]).toBe('New York');
    expect(names('ange')[0]).toBe('Los Angeles');
  });

  it('lists well-known places first among equals', () => {
    expect(names('san', 3)).toEqual(['San Jose', 'San Francisco', 'San Antonio']);
    expect(names('bay area')).toEqual(['San Jose', 'San Francisco', 'Oakland']);
    expect(names('new').slice(0, 2)).toEqual(['New York', 'New Orleans']);
  });

  it('matches a name followed by its context', () => {
    expect(names('san jose ca')).toEqual(['San Jose']);
    expect(searchPresets('birmingham al').map((place) => place.id)).toEqual(['birmingham-al']);
    expect(names('paris france')).toEqual(['Paris']);
    expect(names('japan')).toEqual(['Tokyo', 'Kyoto', 'Nagoya', 'Osaka']);
  });

  it('does not match inside words on one or two letters', () => {
    expect(names('ny')).toEqual(['New York']);
    expect(names('x')).toEqual([]);
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchPresets('')).toEqual([]);
    expect(searchPresets('  ')).toEqual([]);
    expect(searchPresets('...')).toEqual([]);
    expect(searchPresets('a')).toHaveLength(6);
    expect(searchPresets('a', 2)).toHaveLength(2);
    expect(searchPresets('a', 50).length).toBeGreaterThan(6);
  });

  it('returns places that carry their preset id and centre', () => {
    const [sanJose] = searchPresets('san jose');
    expect(sanJose).toEqual({
      id: 'san-jose',
      name: 'San Jose',
      context: 'California, USA',
      center: { lat: 37.3322, lng: -121.8896 },
    });
  });
});

describe('matchPresets', () => {
  it('names the nickname or member town that was matched, so the row can explain itself', () => {
    expect(matchPresets('south bay')[0]).toMatchObject({ place: { name: 'San Jose' }, via: 'South Bay' });
    expect(matchPresets('palo al')[0]).toMatchObject({ place: { name: 'San Jose' }, via: 'Palo Alto' });
    expect(matchPresets('munchen')[0]).toMatchObject({ place: { name: 'Munich' }, via: 'München' });
  });

  it('stays quiet when the alias is plainly the same name', () => {
    expect(matchPresets('san jose')[0]?.via).toBeUndefined();
    expect(matchPresets('nyc')[0]?.via).toBeUndefined();
    expect(matchPresets('greater london')[0]?.via).toBeUndefined();
    expect(matchPresets('new york city')[0]?.via).toBeUndefined();
  });
});

describe('WELL_KNOWN', () => {
  it('lists a dozen places, San Jose first', () => {
    expect(WELL_KNOWN.map((place) => place.name)).toEqual([
      'San Jose',
      'San Francisco',
      'Los Angeles',
      'New York',
      'Chicago',
      'Seattle',
      'London',
      'Paris',
      'Berlin',
      'Tokyo',
      'Sydney',
      'Mexico City',
    ]);
  });

  it('holds real presets', () => {
    for (const place of WELL_KNOWN) {
      const metro = METROS.find((candidate) => candidate.id === place.id);
      expect(metro, place.name).toBeDefined();
      expect(place.center).toEqual({ lat: metro?.lat, lng: metro?.lng });
    }
  });
});

describe('presetFor', () => {
  const searched = (name: string, lat: number, lng: number): Place => ({ name, context: '', center: { lat, lng } });

  it('recognises a searched place as the preset it is', () => {
    expect(presetFor(searched('San Jose', 37.33617, -121.89059))?.id).toBe('san-jose');
    expect(presetFor(searched('São Paulo', -23.55065, -46.63338))?.id).toBe('sao-paulo');
    expect(presetFor(searched('sao paulo', -23.55065, -46.63338))?.id).toBe('sao-paulo');
  });

  it('keeps namesakes elsewhere apart', () => {
    expect(presetFor(searched('San José', 9.93274, -84.07967))).toBeNull();
    expect(presetFor(searched('Birmingham', 33.5207, -86.8025))?.id).toBe('birmingham-al');
    expect(presetFor(searched('Birmingham', 52.4797, -1.9027))?.id).toBe('birmingham');
    expect(presetFor(searched('Palo Alto', 37.44433, -122.15985))).toBeNull();
  });
});
