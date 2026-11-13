import { METROS, type Metro } from '../data/metros';
import { defaultTripFor } from '../data/trips';
import type { Registration } from '../geo/registration';
import type { LinkState, PinSpots, Place } from './types';

export const DEFAULT_HOME_ID = 'san-jose';
export const DEFAULT_AWAY_ID = 'london';

/** The pin as it is before anyone names its spots. */
export const NO_SPOTS: PinSpots = { home: null, away: null };

export function metroToPlace(metro: Metro): Place {
  return { id: metro.id, name: metro.name, context: metro.context, center: { lng: metro.lng, lat: metro.lat } };
}

export function presetPlace(id: string): Place | null {
  const metro = METROS.find((m) => m.id === id);
  return metro ? metroToPlace(metro) : null;
}

function requirePreset(id: string): Place {
  const place = presetPlace(id);
  if (!place) throw new Error(`Missing preset "${id}"`);
  return place;
}

/** Home's centre pinned on Away's centre, not turned. */
export function centeredRegistration(home: Place, away: Place): Registration {
  return { overlayAnchor: home.center, baseAnchor: away.center, rotation: 0 };
}

export function defaultLinkState(): LinkState {
  const home = requirePreset(DEFAULT_HOME_ID);
  const away = requirePreset(DEFAULT_AWAY_ID);
  return {
    home,
    away,
    reg: centeredRegistration(home, away),
    spots: NO_SPOTS,
    view: null,
    trip: defaultTripFor(home),
    drive: null,
    rings: true,
  };
}
