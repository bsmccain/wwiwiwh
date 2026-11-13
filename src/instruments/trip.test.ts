import { describe, expect, it } from 'vitest';
import type { Trip } from '../app/types';
import { moveTripEnd } from './trip';

const PALO_ALTO = { lat: 37.4443, lng: -122.1598 };
const SAN_JOSE = { lat: 37.3322, lng: -121.8896 };
const ELSEWHERE = { lat: 37.4, lng: -122.05 };

describe('moveTripEnd', () => {
  const named: Trip = { from: PALO_ALTO, to: SAN_JOSE, fromName: 'Palo Alto', toName: 'San Jose' };

  it('moves one end and leaves the other where it was', () => {
    expect(moveTripEnd(named, 'from', ELSEWHERE)).toMatchObject({ from: ELSEWHERE, to: SAN_JOSE });
    expect(moveTripEnd(named, 'to', ELSEWHERE)).toMatchObject({ from: PALO_ALTO, to: ELSEWHERE });
  });

  it('drops the name of the end that moved, since it named the old spot, and keeps the other', () => {
    const start = moveTripEnd(named, 'from', ELSEWHERE);
    expect('fromName' in start).toBe(false);
    expect(start.toName).toBe('San Jose');

    const end = moveTripEnd(named, 'to', ELSEWHERE);
    expect('toName' in end).toBe(false);
    expect(end.fromName).toBe('Palo Alto');
  });

  it('adds no name keys to a trip that had none', () => {
    const moved = moveTripEnd({ from: PALO_ALTO, to: SAN_JOSE }, 'to', ELSEWHERE);
    expect(Object.keys(moved).sort()).toEqual(['from', 'to']);
  });

  it('does not change the trip it was given', () => {
    moveTripEnd(named, 'from', ELSEWHERE);
    expect(named).toEqual({ from: PALO_ALTO, to: SAN_JOSE, fromName: 'Palo Alto', toName: 'San Jose' });
  });
});
