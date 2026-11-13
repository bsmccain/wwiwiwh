import type { ExpressionSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import { SOURCE_ID } from '../contracts';
import { FIRST_REF, IS_LINE, LATIN_NAME, classIs, linearByZoom } from './expressions';

/*
 * Lettering MapLibre draws itself: street names and route numbers. Place names are not here; the type
 * plate draws those for both cities above the maps.
 *
 * OpenFreeMap serves exactly three font stacks, each on its own, so every `text-font` below is a
 * one-element array naming one of them. (The style-spec default stack does not exist there.)
 */
const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

/** Streets are lettered from zoom 14, where the tiles first name most of them; side streets wait a level. */
const STREET_NAMES_FROM = 14;
const SIDE_STREET_NAMES_FROM = 15;

export interface LetteringInk {
  readonly text: string;
  /** Knocks the line-work out behind the letters. */
  readonly halo: string;
}

function streetNames(id: string, classes: string[], from: number, ink: LetteringInk): SymbolLayerSpecification {
  return {
    id,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'transportation_name',
    minzoom: from,
    filter: ['all', IS_LINE, classIs(...classes), ['has', 'name']],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 380,
      'text-field': LATIN_NAME,
      'text-font': REGULAR,
      'text-size': linearByZoom([[14, 10.5], [17, 12.5]]),
      'text-letter-spacing': 0.04,
      'text-max-angle': 30,
      'text-padding': 8,
    },
    paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.6 },
  };
}

/** Names along the streets, the main roads a zoom level before the side streets. */
export function streetNameLayers(ink: LetteringInk): SymbolLayerSpecification[] {
  return [
    streetNames('street-names-minor', ['minor'], SIDE_STREET_NAMES_FROM, ink),
    streetNames('street-names', ['trunk', 'primary', 'secondary', 'tertiary'], STREET_NAMES_FROM, ink),
  ];
}

export interface RouteNumbers {
  /** Which roads get a number, as a filter on `transportation_name`. */
  readonly roads: ExpressionSpecification;
  readonly from: number;
  /** Id of the plate image the number sits on. */
  readonly plate: string;
  readonly numerals: string;
  /** Pixels between repeats of a number along its road. */
  readonly spacing: number;
}

/** Route numbers on their plates, repeated along the road and kept upright however the sheet is turned. */
export function routeNumberLayer({ roads, from, plate, numerals, spacing }: RouteNumbers): SymbolLayerSpecification {
  return {
    id: 'route-numbers',
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'transportation_name',
    minzoom: from,
    // From zoom 10 the layer also holds junction points (exit numbers); numbers belong on lines only.
    filter: ['all', IS_LINE, ['has', 'ref'], roads],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': spacing,
      // Where two numbers want the same spot, the bigger road keeps its number.
      'symbol-sort-key': ['match', ['get', 'class'], 'motorway', 0, 1],
      'text-field': FIRST_REF,
      'text-font': BOLD,
      'text-size': 10,
      'text-rotation-alignment': 'viewport',
      'icon-image': plate,
      'icon-text-fit': 'both',
      'icon-rotation-alignment': 'viewport',
      'text-padding': 10,
    },
    paint: { 'text-color': numerals },
  };
}
