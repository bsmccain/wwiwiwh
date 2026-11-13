import { describe, expect, it } from 'vitest';
import heathrow from './fixtures/spot-heathrow.json';
import santanaRow from './fixtures/spot-santana-row.json';
import type { PhotonResponse } from './photon';
import { accessibleRowName } from './row-name';
import { normaliseSpots } from './spots';

const LONDON = { lat: 51.5074, lng: -0.1278 };
const SAN_JOSE = { lat: 37.3362, lng: -121.8906 };

describe('accessibleRowName', () => {
  const [airport] = normaliseSpots(heathrow as unknown as PhotonResponse, LONDON);
  const [street] = normaliseSpots(santanaRow as unknown as PhotonResponse, SAN_JOSE);

  it('says a row’s name and what tells it from its namesakes', () => {
    expect(accessibleRowName({ key: 'a', name: airport?.name ?? '', context: airport?.context ?? '' })).toBe(
      'Heathrow Airport, London Borough of Hillingdon, London',
    );
    expect(accessibleRowName({ key: 'b', name: 'The centre of London', context: '' })).toBe('The centre of London');
  });

  it('says which place a row belongs to where the list holds rows of both maps', () => {
    const look = { key: 'a', name: airport?.name ?? '', context: airport?.context ?? '', sheet: { ink: 'away', place: 'London' } } as const;
    expect(accessibleRowName(look)).toBe('Heathrow Airport, London Borough of Hillingdon, London, in London');
    expect(accessibleRowName({ key: 'c', name: street?.name ?? '', context: street?.context ?? '', sheet: { ink: 'home', place: 'San Jose' } })).toBe(
      'Santana Row, San Jose, in San Jose',
    );
  });

  it('ends with the row’s note', () => {
    expect(accessibleRowName({ key: 'd', name: 'London', context: 'England, UK', note: 'Current', standing: 'current' })).toBe(
      'London, England, UK, Current',
    );
  });
});
