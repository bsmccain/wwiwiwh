import type { ExpressionSpecification } from 'maplibre-gl';

/** Pairs of [zoom, value], lowest zoom first. */
export type ZoomStops = readonly (readonly [zoom: number, value: number])[];

/** Zoom levels over which a layer fades in after its first zoom, so nothing pops onto the sheet. */
const FADE_IN_ZOOMS = 0.4;

/** A width that grows with zoom the way the ground does (base 1.5 between stops), flat outside them. */
export function widthByZoom(stops: ZoomStops): ExpressionSpecification {
  return ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];
}

/** A value read off straight lines between the stops. */
export function linearByZoom(stops: ZoomStops): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flat()];
}

/** Opacity that rises from nothing at `from` to `full` shortly after. */
export function fadeIn(from: number, full = 1): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], from, 0, from + FADE_IN_ZOOMS, full];
}

export function classIs(...classes: string[]): ExpressionSpecification {
  const [only] = classes;
  return classes.length === 1 && only !== undefined
    ? ['==', ['get', 'class'], only]
    : ['match', ['get', 'class'], classes, true, false];
}

export const IS_TUNNEL: ExpressionSpecification = ['==', ['get', 'brunnel'], 'tunnel'];
export const NOT_TUNNEL: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
/** Dry most of the year: washes, seasonal ponds. */
export const NOT_INTERMITTENT: ExpressionSpecification = ['!=', ['get', 'intermittent'], 1];
export const IS_LINE: ExpressionSpecification = ['==', ['geometry-type'], 'LineString'];

/**
 * A feature's name in Latin letters where the tiles have one: `name_en` is the English exonym or the
 * local spelling, `name:latin` the romanised local name, `name` whatever is left.
 */
export const LATIN_NAME: ExpressionSpecification = [
  'coalesce',
  ['get', 'name_en'],
  ['get', 'name:latin'],
  ['get', 'name'],
];

/** The first route number of a road that carries several ("E16;16" reads "E16"). */
export const FIRST_REF: ExpressionSpecification = [
  'let',
  'cut',
  ['index-of', ';', ['get', 'ref']],
  ['case', ['>=', ['var', 'cut'], 0], ['slice', ['get', 'ref'], 0, ['var', 'cut']], ['get', 'ref']],
];
