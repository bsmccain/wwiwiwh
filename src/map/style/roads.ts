import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';
import { SOURCE_ID } from '../contracts';
import { classIs, fadeIn, widthByZoom, type ZoomStops } from './expressions';

/** The road classes both sheets draw, in drawing order: the first is printed first and lies lowest. */
export const ROAD_CLASSES = ['minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

/**
 * The lowest zoom at which the tiles carry each class. Tile zoom is the whole part of the map zoom, so
 * no style can draw a class any earlier than this.
 */
export const ROAD_DATA_FROM: Readonly<Record<RoadClass, number>> = {
  motorway: 4,
  trunk: 4,
  primary: 7,
  secondary: 9,
  tertiary: 11,
  minor: 12,
};

/** When a kind of road joins the sheet and how heavy it is drawn, in pixels at Away zooms. */
export interface RoadWeight {
  readonly from: number;
  readonly width: ZoomStops;
}

export interface RoadWeights extends Readonly<Record<RoadClass, RoadWeight>> {
  /** Slip roads of every class. The tiles carry them from zoom 9, where they would blot out each junction. */
  readonly ramp: RoadWeight;
}

/** Away: thin line-work that leaves room for Home on top. */
export const AWAY_ROAD_WEIGHTS: RoadWeights = {
  motorway: { from: 4, width: [[6, 0.8], [9, 1.7], [12, 2.8], [15, 6], [18, 14]] },
  trunk: { from: 5, width: [[6, 0.5], [9, 1.15], [12, 2.1], [15, 5], [18, 12]] },
  primary: { from: 7.5, width: [[8, 0.5], [10, 0.95], [12, 1.7], [15, 4], [18, 10]] },
  secondary: { from: 9, width: [[9, 0.35], [11, 0.7], [13, 1.3], [15, 3.2], [18, 8.5]] },
  tertiary: { from: 11, width: [[11, 0.4], [13, 0.9], [15, 2.6], [18, 7.5]] },
  minor: { from: 12.5, width: [[12.5, 0.3], [14, 0.8], [16, 2.4], [18, 6]] },
  ramp: { from: 12, width: [[12, 0.6], [14, 1.3], [16, 3], [18, 7]] },
};

/**
 * Home: about 1.6 times Away's weight class for class, counting weight as width times ink strength.
 * Home prints every class at full strength where Away thins its ink class by class, so only the
 * freeways are also drawn wider; the streets match Away's widths or sit just under them. Each class
 * joins a little later than on Away, so the freeways read as Home's skeleton before the streets fill in.
 */
export const HOME_ROAD_WEIGHTS: RoadWeights = {
  motorway: { from: 4, width: [[6, 1.3], [9.5, 2.7], [12, 4.2], [15, 8.5], [18, 20]] },
  trunk: { from: 6, width: [[7, 0.8], [9.5, 1.6], [12, 2.8], [15, 6], [18, 15]] },
  primary: { from: 8.5, width: [[8.5, 0.5], [10, 1], [12, 1.9], [15, 4.5], [18, 12]] },
  secondary: { from: 10.4, width: [[10.4, 0.45], [12, 1], [14, 2], [16, 4.2], [18, 10]] },
  tertiary: { from: 12, width: [[12, 0.5], [14, 1.2], [16, 3], [18, 8]] },
  minor: { from: 13, width: [[13, 0.4], [15, 1.2], [17, 3], [18, 4.5]] },
  ramp: { from: 12, width: [[12, 1], [14, 2.1], [16, 4.8], [18, 11]] },
};

export type RoadColor = string | ExpressionSpecification;

const IS_RAMP: ExpressionSpecification = ['==', ['get', 'ramp'], 1];
// Roads that are not ramps carry no `ramp` attribute at all, so test for "not 1" rather than "0".
const NOT_RAMP: ExpressionSpecification = ['!=', ['get', 'ramp'], 1];
/** Alleys, driveways and parking aisles are tagged `service` on an otherwise ordinary class. */
const NOT_SERVICE_WAY: ExpressionSpecification = ['!', ['has', 'service']];
const CLASSES_WITH_RAMPS: RoadClass[] = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];

function roadLine(
  id: string,
  filter: ExpressionSpecification,
  weight: RoadWeight,
  color: RoadColor,
): LineLayerSpecification {
  return {
    id,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: weight.from,
    filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': color,
      'line-width': widthByZoom(weight.width),
      // Zoom alone, never mixed with feature data: MapLibre evaluates a mixed expression at whole zooms
      // only and interpolates between them, which would smear this short fade across a full zoom level.
      'line-opacity': fadeIn(weight.from),
    },
  };
}

/**
 * One line layer per road class, lowest class first, with no casings: two networks will be printed
 * across each other and casings would double the number of edges on the sheet.
 */
export function roadLayers(
  weights: RoadWeights,
  colorOf: (kind: RoadClass | 'ramp') => RoadColor,
): LineLayerSpecification[] {
  const rampFilter: ExpressionSpecification = ['all', classIs(...CLASSES_WITH_RAMPS), IS_RAMP];
  return ROAD_CLASSES.flatMap((cls) => {
    const filter: ExpressionSpecification = ['all', classIs(cls), NOT_RAMP, NOT_SERVICE_WAY];
    const mainline = roadLine(`road-${cls}`, filter, weights[cls], colorOf(cls));
    if (cls !== 'trunk') return [mainline];
    // Ramps go under the two classes they mostly feed, so the mainline closes over each join.
    return [roadLine('road-ramps', rampFilter, weights.ramp, colorOf('ramp')), mainline];
  });
}
