import { distanceMeters } from '../geo/distance';
import type { LngLat } from '../geo/types';
import type { NamedSpot } from './types';

/** Two positions closer than this are the same spot (a link rounds coordinates to about a metre). */
export const SAME_SPOT_METERS = 2;

export function sameSpot(a: LngLat, b: LngLat): boolean {
  return distanceMeters(a, b) <= SAME_SPOT_METERS;
}

/**
 * The name the person gave a spot, as long as the thing it named (an end of the pin, the landing of
 * a trip) is still there. Once that has moved the name no longer describes it, and null is returned.
 */
export function nameAt(spot: NamedSpot | null | undefined, at: LngLat): string | null {
  return spot && sameSpot(spot.at, at) ? spot.name : null;
}

/** Half of a character pair on its own, which cannot be written into a link. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Control characters, and the invisible marks that override the direction text runs in. */
const UNPRINTABLE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Characters that take up no room: a name made only of these would be a name nobody can see or press. */
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const LONGEST_NAME = 80;

/**
 * A name as it is kept and shown. Names arrive from a search service and from links anyone can
 * write, so besides being trimmed they are made safe: nothing invisible that could rearrange the
 * sentence around them, no broken characters (which cannot be put into a link at all), and never so
 * long that they break a sentence. Cut by whole characters, so an emoji is kept or dropped, never halved.
 */
export function tidyName(name: string): string {
  const clean = name.replace(LONE_SURROGATE, '').replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim();
  if (clean.replace(INVISIBLE, '').trim() === '') return '';
  return Array.from(clean).slice(0, LONGEST_NAME).join('').trim();
}
