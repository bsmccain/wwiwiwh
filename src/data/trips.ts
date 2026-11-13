import type { Place, Trip } from '../app/types';
import { METROS } from './metros';

interface FamiliarStart {
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
}

/**
 * Where a trip that locals know by heart starts, keyed by preset id: a town 15 to 30 km out that people
 * travel to and from all the time. Each trip ends at the preset's own centre point.
 *
 * Every point is the town's own place point in OpenStreetMap as Photon returns it (2026-11-11), rounded to
 * four decimals, which is also where the map letters the town's name. The trailing comment names the OSM object.
 */
const FAMILIAR_STARTS: Readonly<Record<string, FamiliarStart>> = {
  'san-jose': { name: 'Palo Alto', lat: 37.4443, lng: -122.1598 }, // R1544955 place=city
  'san-francisco': { name: 'Berkeley', lat: 37.8708, lng: -122.2729 }, // R2833528 place=city
  oakland: { name: 'Walnut Creek', lat: 37.9021, lng: -122.0619 }, // R3705576 place=town
  'los-angeles': { name: 'Santa Monica', lat: 34.0195, lng: -118.4912 }, // R3353288 place=city
  'san-diego': { name: 'La Jolla', lat: 32.8402, lng: -117.2741 }, // N4840618776 place=suburb
  seattle: { name: 'Redmond', lat: 47.6694, lng: -122.1239 }, // R237376 place=city
  portland: { name: 'Hillsboro', lat: 45.5229, lng: -122.9898 }, // R186641 place=city
  chicago: { name: 'Evanston', lat: 42.047, lng: -87.6846 }, // R123419 place=city
  'new-york': { name: 'Newark', lat: 40.7357, lng: -74.1724 }, // R170486 place=city
  boston: { name: 'Salem', lat: 42.5214, lng: -70.8957 }, // R2373035 place=city
  washington: { name: 'Rockville', lat: 39.0818, lng: -77.1517 }, // R133700 place=city
  london: { name: 'Watford', lat: 51.6554, lng: -0.3957 }, // N20992523 place=town
  paris: { name: 'Versailles', lat: 48.8035, lng: 2.1267 }, // R30295 place=town
  tokyo: { name: 'Yokohama', lat: 35.4503, lng: 139.6344 }, // R2689482 place=city
};

/**
 * A familiar straight-line trip for some presets, keyed by preset id. Shown the first time a place is
 * used as Home so there is something to compare straight away. Stored in that place's own coordinates.
 */
export const DEFAULT_TRIPS: Readonly<Record<string, Trip>> = Object.fromEntries(
  METROS.flatMap((metro): [string, Trip][] => {
    const start = FAMILIAR_STARTS[metro.id];
    if (!start) return [];
    const trip: Trip = {
      from: { lat: start.lat, lng: start.lng },
      to: { lat: metro.lat, lng: metro.lng },
      fromName: start.name,
      toName: metro.name,
    };
    return [[metro.id, trip]];
  }),
);

export function defaultTripFor(place: Place): Trip | null {
  return (place.id && DEFAULT_TRIPS[place.id]) || null;
}
