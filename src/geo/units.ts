export type Units = 'mi' | 'km';

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_FOOT = 0.3048;

/** Miles for the few countries that sign their roads in miles, kilometres everywhere else. */
export function defaultUnits(locale: string | undefined): Units {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? '')?.[1]?.toUpperCase();
  return region === 'US' || region === 'GB' || region === 'LR' || region === 'MM' ? 'mi' : 'km';
}

/**
 * One formatter for every lettered figure. `toLocaleString` may set up a new one on each call, which
 * is slow enough to show when figures are lettered inside a map frame.
 */
const FIGURES = new Intl.NumberFormat('en-US');

/** A number as it is lettered on the map and the bar scale: "1,000", "0.2". */
export function formatFigure(value: number): string {
  return FIGURES.format(value);
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, '');
}

/**
 * A short human distance: "850 ft", "0.4 mi", "12.5 mi", "140 mi" / "250 m", "3.2 km", "140 km".
 * Rounds to a precision that matches how people talk about trips of that length.
 */
export function formatDistance(meters: number, units: Units): string {
  const m = Math.abs(meters);
  if (units === 'mi') {
    const miles = m / METERS_PER_MILE;
    if (miles < 0.19) {
      const feet = m / METERS_PER_FOOT;
      return `${feet < 100 ? Math.round(feet) : Math.round(feet / 10) * 10} ft`;
    }
    if (miles < 99.95) return `${trimFixed(miles, 1)} mi`;
    return `${formatFigure(Math.round(miles))} mi`;
  }
  if (m < 995) return `${m < 100 ? Math.round(m) : Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  if (km < 99.95) return `${trimFixed(km, 1)} km`;
  return `${formatFigure(Math.round(km))} km`;
}

/**
 * A short human length of time, to the minute: "1 min", "22 min", "1 h", "1 h 5 min", "12 h 40 min".
 * Never less than a minute: an estimate of a drive is not known to the second.
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = formatFigure(Math.floor(minutes / 60));
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A round distance: 1, 2 or 5 times a power of ten, in the unit a road sign would give it in. */
export interface RoundDistance {
  readonly meters: number;
  /** The number as lettered: 5 for "5 mi", 0.2 for "0.2 mi". */
  readonly value: number;
  readonly unit: 'ft' | 'mi' | 'm' | 'km';
}

const ROUND_STEPS = [1, 2, 5] as const;

function rungs(unit: RoundDistance['unit'], metersPerUnit: number, from: number, to: number): RoundDistance[] {
  const found: RoundDistance[] = [];
  for (let exponent = Math.floor(Math.log10(from)); ; exponent++) {
    for (const step of ROUND_STEPS) {
      const value = Number((step * 10 ** exponent).toPrecision(1));
      if (value > to) return found;
      if (value >= from) found.push({ meters: value * metersPerUnit, value, unit });
    }
  }
}

/**
 * Feet hand over to miles at 0.2 mi (0.1 mi is all but 500 ft again), metres to kilometres at 1 km.
 * The far ends are beyond anything the map can show at its zoom limits.
 */
const LADDERS: Readonly<Record<Units, readonly RoundDistance[]>> = {
  mi: [...rungs('ft', METERS_PER_FOOT, 1, 500), ...rungs('mi', METERS_PER_MILE, 0.2, 5000)],
  km: [...rungs('m', 1, 1, 500), ...rungs('km', 1000, 1, 5000)],
};

/** Guards the comparisons below against a distance that should fit exactly missing by a rounding hair. */
const FIT_SLACK = 1 + 1e-9;

/** How many rungs of the ladder are no longer than `maxMeters`. */
function rungsWithin(ladder: readonly RoundDistance[], maxMeters: number): number {
  let count = 0;
  while (count < ladder.length && (ladder[count] as RoundDistance).meters <= maxMeters * FIT_SLACK) count++;
  return count;
}

/** The longest round distance in the given units that is not above `maxMeters`, or null when none is that short. */
export function longestRoundDistance(maxMeters: number, units: Units): RoundDistance | null {
  const ladder = LADDERS[units];
  return ladder[rungsWithin(ladder, maxMeters) - 1] ?? null;
}

/** Round distances already lettered. The rungs of the ladders are shared, so each is lettered once. */
const lettered = new WeakMap<RoundDistance, string>();

/** "5 mi", "500 ft", "0.2 mi", "1,000 km". */
export function formatRoundDistance(distance: RoundDistance): string {
  let text = lettered.get(distance);
  if (text === undefined) {
    text = `${formatFigure(distance.value)} ${distance.unit}`;
    lettered.set(distance, text);
  }
  return text;
}

export interface RingPlanOptions {
  /** How many rings to draw at most. Default 3. */
  readonly count?: number;
  /** Rings smaller than this many pixels are left out: they would sit on the pin itself. Default 0. */
  readonly minPixels?: number;
}

/**
 * Chooses the distance rings to draw about the pin: neighbouring round distances in the viewer's units
 * (5, 10 and 20 mi across a metro; 1, 2 and 5 closer in), the longest being the longest that still lies
 * within `reachPixels` of the pin. Innermost first; empty when nothing fits.
 */
export function planRings(
  metersPerPixel: number,
  reachPixels: number,
  units: Units,
  options: RingPlanOptions = {},
): readonly RoundDistance[] {
  const { count = 3, minPixels = 0 } = options;
  if (!(metersPerPixel > 0) || !(reachPixels > 0)) return [];
  const ladder = LADDERS[units];
  const end = rungsWithin(ladder, metersPerPixel * reachPixels);
  return ladder.slice(Math.max(0, end - count), end).filter((ring) => ring.meters * FIT_SLACK >= minPixels * metersPerPixel);
}
