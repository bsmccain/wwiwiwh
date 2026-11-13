import { METROS } from '../data/metros';
import { distanceMeters } from '../geo/distance';
import { normalizeDegrees } from '../geo/registration';
import type { LngLat } from '../geo/types';
import { formatDistance, type Units } from '../geo/units';
import type { Place } from './types';

/**
 * The words the app says about what is on screen: where a spot is, what the pin holds together,
 * and how a familiar trip lands on the other place. Pure functions so the wording is testable.
 */

/** A named place near some position (structurally the type plate's `NearestPlace`). */
export interface NearbyPlace {
  readonly name: string;
  readonly distanceMeters: number;
  /** Compass bearing from the named place to the position, in degrees. */
  readonly bearingDeg: number;
}

/** How a position is referred to in a sentence. */
export interface Spot {
  readonly text: string;
  /** True when the text names the spot itself ("Watford"), false when it only places it ("near Watford"). */
  readonly exact: boolean;
}

/** A spot that is known by name. */
export function namedSpot(name: string): Spot {
  return { text: name, exact: true };
}

/** A run of text, optionally in one of the two map inks or set as a figure. */
export interface Span {
  readonly text: string;
  readonly ink?: 'home' | 'away' | 'figure';
}

/** Closer than this to a place's own centre point counts as being at that centre. */
const AT_CENTER_METERS = 400;
/** Closer than this to a named place reads as being that place. */
const AT_PLACE_METERS = 800;
/** Closer than this reads as "near" it; beyond, a distance and direction are given. */
const NEAR_PLACE_METERS = 5000;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

export function compassWord(bearingDeg: number): string {
  const index = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index] as string;
}

/** "downtown San Jose" in North America, "central London" elsewhere, the bare name for other places. */
export function centerName(place: Place): string {
  const metro = place.id ? METROS.find((m) => m.id === place.id) : undefined;
  if (!metro) return place.name;
  return metro.country === 'US' || metro.country === 'CA' ? `downtown ${place.name}` : `central ${place.name}`;
}

/** A distance in the viewer's units with the other unit in brackets: "15.8 mi (25.4 km)". */
export function bothUnits(meters: number, units: Units): string {
  const other: Units = units === 'mi' ? 'km' : 'mi';
  return `${formatDistance(meters, units)} (${formatDistance(meters, other)})`;
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

/**
 * How to refer to a position: the place's own centre, a nearby named place ("Watford",
 * "near Watford", "4 mi north-west of Watford"), or null when nothing is known about it.
 */
export function describeSpot(at: LngLat, place: Place, nearby: NearbyPlace | null, units: Units): Spot | null {
  if (distanceMeters(at, place.center) <= AT_CENTER_METERS) return namedSpot(centerName(place));
  if (!nearby) return null;
  // The nearest name can be the city's own label; a spot a few miles from it is not "near London", it is
  // near the middle of London.
  const name = sameName(nearby.name, place.name) ? centerName(place) : nearby.name;
  if (nearby.distanceMeters <= AT_PLACE_METERS) return namedSpot(name);
  if (nearby.distanceMeters <= NEAR_PLACE_METERS) return { text: `near ${name}`, exact: false };
  return {
    text: `${formatDistance(nearby.distanceMeters, units)} ${compassWord(nearby.bearingDeg)} of ${name}`,
    exact: false,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface TripWords {
  readonly meters: number;
  readonly units: Units;
  /** The trip's two ends on Home, when they can be named. */
  readonly homeFrom: Spot | null;
  readonly homeTo: Spot | null;
  /** The spots on Away that the two ends land on, when they can be named. */
  readonly awayFrom: Spot | null;
  readonly awayTo: Spot | null;
  readonly awayName: string;
  /** Say it in as few words as possible (small screens): one unit, no "laid on". */
  readonly compact?: boolean;
}

/**
 * "Palo Alto to San Jose is 16.7 mi (26.9 km) in a straight line. Laid on London, that runs from
 * near Rickmansworth to central London."
 *
 * Compact: "Palo Alto to San Jose is 16.7 mi in a straight line. On London: near Rickmansworth to
 * central London."
 */
export function tripSentence(words: TripWords): Span[] {
  const distance = words.compact ? formatDistance(words.meters, words.units) : bothUnits(words.meters, words.units);
  const spans: Span[] = [];
  if (words.homeFrom && words.homeTo) {
    // "Near Cupertino to San Jose is…" reads as if the trip were near Cupertino; "From near Cupertino to…" does not.
    const lead = words.homeFrom.exact ? capitalize(words.homeFrom.text) : `From ${words.homeFrom.text}`;
    spans.push({ text: `${lead} to ${words.homeTo.text}`, ink: 'home' }, { text: ' is ' });
  } else {
    spans.push({ text: 'This line is ' });
  }
  spans.push({ text: distance, ink: 'figure' }, { text: ' in a straight line.' });
  if (words.awayFrom && words.awayTo) {
    spans.push(
      { text: words.compact ? ` On ${words.awayName}: ` : ` Laid on ${words.awayName}, that runs from ` },
      { text: `${words.awayFrom.text} to ${words.awayTo.text}`, ink: 'away' },
      { text: '.' },
    );
  }
  return spans;
}

/**
 * What the pin holds together: "Downtown San Jose sits on central London.", "Palo Alto sits near Ealing.",
 * "A spot near Mountain View sits 4 mi north-west of Watford." Null until both spots can be described.
 */
export function pinSentence(home: Spot | null, away: Spot | null): Span[] | null {
  if (!home || !away) return null;
  return [
    { text: home.exact ? capitalize(home.text) : `A spot ${home.text}`, ink: 'home' },
    { text: away.exact ? ' sits on ' : ' sits ' },
    { text: away.text, ink: 'away' },
    { text: '.' },
  ];
}

/** Whether Home is turned at all, however slightly. */
export function isTurned(rotationDeg: number): boolean {
  return normalizeDegrees(rotationDeg) !== 0;
}

/** The size of a turn as a figure: whole degrees, or one decimal below a degree so a slight turn never reads as none. */
function turnFigure(rotationDeg: number): { size: string; clockwise: boolean; upsideDown: boolean } | null {
  const turn = normalizeDegrees(rotationDeg);
  if (turn === 0) return null;
  const magnitude = Math.abs(turn);
  const size = magnitude < 0.95 ? String(Math.max(0.1, Number(magnitude.toFixed(1)))) : String(Math.round(magnitude));
  return { size, clockwise: turn > 0, upsideDown: Math.round(magnitude) === 180 };
}

/** "not turned", "turned 28° right" (clockwise), "turned 28° left", "turned upside down". */
export function turnWords(rotationDeg: number): string {
  const figure = turnFigure(rotationDeg);
  if (!figure) return 'not turned';
  if (figure.upsideDown) return 'turned upside down';
  return `turned ${figure.size}° ${figure.clockwise ? 'right' : 'left'}`;
}

/** For screen readers, where the degree sign and "right" are less clear than plain words. */
export function turnWordsSpoken(rotationDeg: number): string {
  const figure = turnFigure(rotationDeg);
  if (!figure) return 'not turned';
  if (figure.upsideDown) return 'turned upside down';
  const unit = figure.size === '1' ? 'degree' : 'degrees';
  return `turned ${figure.size} ${unit} ${figure.clockwise ? 'clockwise' : 'counterclockwise'}`;
}

export function spansToText(spans: readonly Span[]): string {
  return spans.map((s) => s.text).join('');
}

export function pageTitle(home: Place, away: Place): string {
  return `${home.name} over ${away.name} at the same scale | wwiwiwh`;
}
