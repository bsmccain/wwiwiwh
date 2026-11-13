import { defaultTripFor } from '../data/trips';
import { clamp, MAX_MERCATOR_LAT } from '../geo/mercator';
import { normalizeDegrees, overlayToBase } from '../geo/registration';
import type { LngLat } from '../geo/types';
import { centeredRegistration, defaultLinkState, presetPlace } from './defaults';
import { nameAt, tidyName } from './spots';
import type { LinkState, Place, Trip, View } from './types';

/**
 * The shareable state lives in the URL hash so the site needs no server:
 *
 *   #home=san-jose&away=london                         presets by id
 *   #home=37.4275,-122.1697,Stanford&away=paris        any other place: lat,lng,name
 *   &pin=37.4419,-122.143~51.6565,-0.3903              Home spot ~ Away spot held together (default: the two centres)
 *   &hs=My+old+house&as=Big+Ben                         what the person called the pin's Home spot and Away spot
 *   &turn=28                                           Home turned clockwise, degrees (default 0)
 *   &view=51.5321,-0.214,9.6                           Away camera: lat,lng,zoom (default: framed automatically)
 *   &trip=37.4419,-122.143~37.3322,-121.8896           trip ends in Home coordinates ("none" = no trip)
 *   &tf=My+old+house&tt=School                          names of the trip's ends on Home
 *   &ts=Big+Ben&tl=Heathrow                             names of the Away spots the trip's start and end land on
 *   &rings=0                                           distance rings off (default on)
 *
 * Anything missing or malformed falls back to its default, and `incomplete` reports that it happened.
 */

const COORD_DIGITS = 5;
/** The map's own latitude limit as `point` writes it: rounding may carry it a hair past the limit. */
const MAX_LINK_LAT = Number(MAX_MERCATOR_LAT.toFixed(COORD_DIGITS));

function num(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

function point(p: LngLat): string {
  return `${num(p.lat, COORD_DIGITS)},${num(p.lng, COORD_DIGITS)}`;
}

function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%2C/gi, ',').replace(/%20/g, '+');
}

function samePoint(a: LngLat, b: LngLat): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

/** Whether a trip is, names and all, the one its place comes with, so that the link need not spell it out. */
function sameTrip(a: Trip | null, b: Trip | null): boolean {
  if (!a || !b) return a === b;
  return (
    samePoint(a.from, b.from) &&
    samePoint(a.to, b.to) &&
    a.fromName === b.fromName &&
    a.toName === b.toName &&
    !a.fromLanding &&
    !a.toLanding
  );
}

function encodePlace(place: Place): string {
  const preset = place.id ? presetPlace(place.id) : null;
  if (preset && samePoint(preset.center, place.center)) return preset.id as string;
  return `${point(place.center)},${encodeValue(tidyName(place.name))}`;
}

/** Serialises link state to a hash string (without the leading "#"). Defaults are left out. */
export function encodeLink(state: LinkState): string {
  const parts = [`home=${encodePlace(state.home)}`, `away=${encodePlace(state.away)}`];
  const centered = centeredRegistration(state.home, state.away);
  if (!samePoint(state.reg.overlayAnchor, centered.overlayAnchor) || !samePoint(state.reg.baseAnchor, centered.baseAnchor)) {
    parts.push(`pin=${point(state.reg.overlayAnchor)}~${point(state.reg.baseAnchor)}`);
  }
  const homeSpot = nameAt(state.spots.home, state.reg.overlayAnchor);
  const awaySpot = nameAt(state.spots.away, state.reg.baseAnchor);
  if (homeSpot) parts.push(`hs=${encodeValue(tidyName(homeSpot))}`);
  if (awaySpot) parts.push(`as=${encodeValue(tidyName(awaySpot))}`);
  const turn = Number(normalizeDegrees(state.reg.rotation).toFixed(1));
  if (turn !== 0) parts.push(`turn=${turn}`);
  if (state.view) parts.push(`view=${point(state.view.center)},${num(state.view.zoom, 2)}`);
  const fallbackTrip = defaultTripFor(state.home);
  if (!sameTrip(state.trip, fallbackTrip)) {
    parts.push(state.trip ? `trip=${point(state.trip.from)}~${point(state.trip.to)}` : 'trip=none');
    if (state.trip) {
      const { from, to, fromName, toName, fromLanding, toLanding } = state.trip;
      if (fromName) parts.push(`tf=${encodeValue(tidyName(fromName))}`);
      if (toName) parts.push(`tt=${encodeValue(tidyName(toName))}`);
      const startLanding = nameAt(fromLanding, overlayToBase(state.reg, from));
      if (startLanding) parts.push(`ts=${encodeValue(tidyName(startLanding))}`);
      const endLanding = nameAt(toLanding, overlayToBase(state.reg, to));
      if (endLanding) parts.push(`tl=${encodeValue(tidyName(endLanding))}`);
    }
  }
  if (!state.rings) parts.push('rings=0');
  return parts.join('&');
}

function parseNumber(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parsePoint(text: string | undefined): LngLat | null {
  if (!text) return null;
  const [latText, lngText, ...rest] = text.split(',');
  if (rest.length > 0) return null;
  const lat = parseNumber(latText);
  const lng = parseNumber(lngText);
  if (lat === null || lng === null || Math.abs(lat) > MAX_LINK_LAT || Math.abs(lng) > 180) return null;
  return { lat: clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT), lng };
}

function parsePointPair(text: string): [LngLat, LngLat] | null {
  const [first, second, ...rest] = text.split('~');
  if (rest.length > 0) return null;
  const a = parsePoint(first);
  const b = parsePoint(second);
  return a && b ? [a, b] : null;
}

function parsePlace(text: string): Place | null {
  const preset = presetPlace(text);
  if (preset) return preset;
  const [latText, lngText, ...nameParts] = text.split(',');
  const center = parsePoint(`${latText},${lngText}`);
  const name = tidyName(nameParts.join(','));
  if (!center || !name) return null;
  return { name, context: '', center };
}

function parseView(text: string): View | null {
  const [latText, lngText, zoomText, ...rest] = text.split(',');
  if (rest.length > 0) return null;
  const center = parsePoint(`${latText},${lngText}`);
  const zoom = parseNumber(zoomText);
  if (!center || zoom === null || zoom < 0 || zoom > 22) return null;
  return { center, zoom };
}

export interface DecodedLink {
  readonly state: LinkState;
  /** True when the hash named something that could not be understood, so a default was used instead. */
  readonly incomplete: boolean;
}

/** Parses a hash string (with or without the leading "#"). Never throws. */
export function decodeLink(hash: string): DecodedLink {
  const defaults = defaultLinkState();
  const text = hash.replace(/^#/, '');
  if (text.trim() === '') return { state: defaults, incomplete: false };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return { state: defaults, incomplete: true };
  }

  let incomplete = false;
  const read = <V>(key: string, parse: (value: string) => V | null, fallback: V): V => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const parsed = parse(raw);
    if (parsed === null) {
      incomplete = true;
      return fallback;
    }
    return parsed;
  };

  // A link must at least say which two places it shows.
  if (!params.has('home') || !params.has('away')) incomplete = true;
  const home = read('home', parsePlace, defaults.home);
  const away = read('away', parsePlace, defaults.away);

  const centered = centeredRegistration(home, away);
  const pin = read('pin', parsePointPair, [centered.overlayAnchor, centered.baseAnchor] as [LngLat, LngLat]);
  const turn = read('turn', parseNumber, 0);
  const view = read<View | null>('view', parseView, null);
  const rings = read('rings', (v) => (v === '0' ? false : v === '1' ? true : null), true);

  const reg = { overlayAnchor: pin[0], baseAnchor: pin[1], rotation: normalizeDegrees(turn) };
  /** A name from the link, or undefined when it is absent or empty. */
  const name = (key: string): string | undefined => tidyName(params.get(key) ?? '') || undefined;

  const fallbackTrip = defaultTripFor(home);
  const trip = read<Trip | null | 'none'>(
    'trip',
    (v) => {
      if (v === 'none') return 'none';
      const pair = parsePointPair(v);
      if (!pair) return null;
      const [from, to] = pair;
      const startLanding = name('ts');
      const endLanding = name('tl');
      return {
        from,
        to,
        ...(name('tf') ? { fromName: name('tf') } : {}),
        ...(name('tt') ? { toName: name('tt') } : {}),
        ...(startLanding ? { fromLanding: { name: startLanding, at: overlayToBase(reg, from) } } : {}),
        ...(endLanding ? { toLanding: { name: endLanding, at: overlayToBase(reg, to) } } : {}),
      };
    },
    fallbackTrip,
  );

  const homeSpot = name('hs');
  const awaySpot = name('as');
  return {
    state: {
      home,
      away,
      reg,
      spots: {
        home: homeSpot ? { name: homeSpot, at: reg.overlayAnchor } : null,
        away: awaySpot ? { name: awaySpot, at: reg.baseAnchor } : null,
      },
      view,
      trip: trip === 'none' ? null : trip,
      rings,
    },
    incomplete,
  };
}
