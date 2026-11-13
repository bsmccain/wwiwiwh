import { describeSpot, namedSpot, pinSentence, tripSentence, type NearbyPlace, type Span, type Spot } from '../app/readout';
import { nameAt, sameSpot } from '../app/spots';
import type { PinSpots, Place, Trip } from '../app/types';
import { distanceMeters } from '../geo/distance';
import { overlayToBase, type Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { Units } from '../geo/units';
import type { Sheet } from '../map/contracts';

/** What is on screen, as far as the sentences about it are concerned. */
export interface Scene {
  readonly home: Place;
  readonly away: Place;
  readonly registration: Registration;
  /** What the person called the spots under the pin, if they chose them by address. */
  readonly spots?: PinSpots;
  readonly trip: Trip | null;
  readonly units: Units;
}

/** Looks up the named place nearest to a position on one of the sheets (the type plate's `nearestPlace`). */
export type NearestLookup = (sheet: Sheet, at: LngLat) => NearbyPlace | null;

/** "Downtown San Jose sits on central London.", or null until both spots under the pin can be named. */
export function pinSpans(scene: Scene, nearest: NearestLookup): Span[] | null {
  return pinSentence(pinSpot(scene, 'home', nearest), pinSpot(scene, 'away', nearest));
}

/** How to refer to the spot under the pin on one sheet: by the name the person gave it, or by what is near. */
export function pinSpot(scene: Scene, sheet: Sheet, nearest: NearestLookup): Spot | null {
  const { registration, spots, units } = scene;
  const at = sheet === 'home' ? registration.overlayAnchor : registration.baseAnchor;
  const given = nameAt(spots?.[sheet], at);
  return given ? namedSpot(given) : describeSpot(at, scene[sheet], nearest(sheet, at), units);
}

/** A spot in words that can follow "on": "central London", "10 Downing Street", "a spot near Watford". */
export function spotWords(spot: Spot): string {
  return spot.exact ? spot.text : `a spot ${spot.text}`;
}

/** The same words standing on their own, as the pin sentence begins with them: "Central London", "A spot near Watford". */
export function spotLabel(spot: Spot): string {
  const words = spotWords(spot);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Whether two spots are referred to in the same words. */
export function sameWords(a: Spot | null, b: Spot | null): boolean {
  return a?.text === b?.text && a?.exact === b?.exact;
}

/**
 * The trip's length and where it runs on both places, or null when there is no trip.
 *
 * `compact` asks for the short wording used on small screens. There the ends on Home are named only
 * when both have a name of their own ("Palo Alto to San Jose"). A line drawn between two unnamed
 * spots is "This line": the person who drew it on the place they know needs no telling where it
 * runs there, and the room goes to where it lands on Away.
 */
export function tripSpans(scene: Scene, nearest: NearestLookup, compact = false): Span[] | null {
  const { home, away, registration, trip, units } = scene;
  if (!trip) return null;
  // An end that sits on the pin is the pin's spot, and goes by the same name.
  const onHome = (end: LngLat, known: string | undefined): Spot | null => {
    if (known) return namedSpot(known);
    if (sameSpot(end, registration.overlayAnchor)) return pinSpot(scene, 'home', nearest);
    return describeSpot(end, home, nearest('home', end), units);
  };
  const onAway = (end: LngLat, aimedAt: Trip['toLanding']): Spot | null => {
    const landed = overlayToBase(registration, end);
    const given = nameAt(aimedAt, landed);
    if (given) return namedSpot(given);
    if (sameSpot(landed, registration.baseAnchor)) return pinSpot(scene, 'away', nearest);
    return describeSpot(landed, away, nearest('away', landed), units);
  };
  const homeFrom = onHome(trip.from, trip.fromName);
  const homeTo = onHome(trip.to, trip.toName);
  // Two ends that go by the same words ("near Cupertino to near Cupertino") name nothing: a short
  // line inside one neighbourhood is "This line".
  const told = homeFrom?.text !== homeTo?.text;
  const nameHomeEnds = told && (!compact || (homeFrom?.exact === true && homeTo?.exact === true));
  return tripSentence({
    meters: distanceMeters(trip.from, trip.to),
    units,
    homeFrom: nameHomeEnds ? homeFrom : null,
    homeTo: nameHomeEnds ? homeTo : null,
    awayFrom: onAway(trip.from, trip.fromLanding),
    awayTo: onAway(trip.to, trip.toLanding),
    awayName: away.name,
    compact,
  });
}

/** Whether two runs of text would read and look the same. */
export function sameSpans(a: readonly Span[] | null, b: readonly Span[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((span, index) => span.text === b[index]?.text && span.ink === b[index]?.ink);
}
