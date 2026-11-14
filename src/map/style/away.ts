import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';
import type { Theme } from '../../app/types';
import { SOURCE_ID } from '../contracts';
import {
  IS_TUNNEL,
  NOT_INTERMITTENT,
  NOT_TUNNEL,
  classIs,
  fadeIn,
  linearByZoom,
  widthByZoom,
  type ZoomStops,
} from './expressions';
import { routeImageId } from './images';
import { routeNumberLayer, streetNameLayers } from './lettering';
import type { Palette } from './palette';
import { AWAY_ROAD_WEIGHTS, roadLayers, type RoadClass } from './roads';

/*
 * Away is drawn in one cool ink with thin roads. By default it is also the sheet underneath and owns
 * every fill on the page (see `groundLayers`); when Home has the ground, Away is printed over it as
 * line-work only.
 */

const BUILT_UP_UNTIL = 14;
const RAIL_FROM = 10.5;
const RIVERS_FROM = 9;
const SMALL_WATERWAYS_FROM = 12.5;
const ROUTE_NUMBERS_FROM = 8;

const OPEN_WATER: ExpressionSpecification = [
  'all',
  classIs('ocean', 'lake', 'river', 'pond', 'dock'),
  NOT_INTERMITTENT,
  NOT_TUNNEL,
];

/**
 * Land that is built on. `residential` alone is in the tiles from the lowest zooms and shows how far a
 * city reaches; the rest join from zoom 9 and fill the holes it leaves where people work, shop and study.
 *
 * It is a tint for metro scale. At street scale everything in view is built on, and from zoom 14 the
 * tiles carry only scattered plots, so the tint bows out before then instead of breaking into patches.
 */
const BUILT_UP = [
  'residential',
  'commercial',
  'retail',
  'industrial',
  'school',
  'college',
  'university',
  'education',
  'kindergarten',
  'hospital',
  'library',
  'railway',
  'garages',
  'bus_station',
];

/** `landcover` grass that reads as a park on the ground. (The `park` source-layer is nature reserves, not parks.) */
const PARKLAND: ExpressionSpecification = [
  'match',
  ['get', 'subclass'],
  ['park', 'garden', 'golf_course', 'recreation_ground', 'village_green', 'heath', 'grassland', 'scrub'],
  true,
  false,
];

function tint(id: string, sourceLayer: string, filter: ExpressionSpecification, color: string): FillLayerSpecification {
  return { id, type: 'fill', source: SOURCE_ID, 'source-layer': sourceLayer, filter, paint: { 'fill-color': color } };
}

function waterLayers(palette: Palette): LayerSpecification[] {
  const { water, waterEdge } = palette.away;
  const waterway = (id: string, classes: string[], from: number, width: ZoomStops): LineLayerSpecification => ({
    id,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'waterway',
    minzoom: from,
    filter: ['all', classIs(...classes), NOT_TUNNEL, NOT_INTERMITTENT],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': waterEdge, 'line-width': widthByZoom(width), 'line-opacity': fadeIn(from) },
  });
  return [
    // Centre lines first: where a river is wide enough to have banks, its water covers the line.
    waterway('waterway-small', ['canal', 'stream'], SMALL_WATERWAYS_FROM, [[12.5, 0.4], [16, 1.4]]),
    waterway('waterway', ['river'], RIVERS_FROM, [[9, 0.5], [14, 2], [18, 5]]),
    tint('water', 'water', OPEN_WATER, water),
    waterEdgeLayer(palette),
  ];
}

function waterEdgeLayer(palette: Palette): LineLayerSpecification {
  return {
    id: 'water-edge',
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'water',
    filter: OPEN_WATER,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': palette.away.waterEdge, 'line-width': 0.6 },
  };
}

/**
 * The ground of the page: the paper, built-up land, woods and parks, and water, all in flat tints.
 * Exactly one of the two sheets prints it, and that sheet lies underneath. The layers are written in
 * Away zooms; Home shifts them like the rest of its style.
 */
export function groundLayers(palette: Palette): LayerSpecification[] {
  const { away } = palette;
  return [
    { id: 'sheet', type: 'background', paint: { 'background-color': palette.sheet } },
    {
      ...tint('built-up', 'landuse', classIs(...BUILT_UP), away.builtUp),
      maxzoom: BUILT_UP_UNTIL,
      paint: {
        'fill-color': away.builtUp,
        // Whole-layer opacity: the plots overlap, and per-feature opacity would print the overlaps twice.
        'fill-layer-opacity': linearByZoom([[BUILT_UP_UNTIL - 1, 1], [BUILT_UP_UNTIL, 0]]),
      },
    },
    tint('woods', 'landcover', classIs('wood'), away.green),
    tint('parks', 'landcover', ['all', classIs('grass'), PARKLAND], away.green),
    ...waterLayers(palette),
  ];
}

function railLayer(palette: Palette): LineLayerSpecification {
  return {
    id: 'rail',
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'transportation',
    minzoom: RAIL_FROM,
    // Sidings and yards carry a `service` tag; the sheet shows running lines only.
    filter: ['all', classIs('rail'), ['!', ['has', 'service']]],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': ['case', IS_TUNNEL, palette.away.railTunnel, palette.away.rail],
      'line-width': widthByZoom([[10.5, 0.7], [14, 1.1], [18, 2.4]]),
      'line-dasharray': [6, 2],
      'line-opacity': fadeIn(RAIL_FROM),
    },
  };
}

/**
 * The Away style. With the ground (`withGround`, the default) it is the sheet underneath; without it,
 * it keeps only the edge of its water, as a line, and has no paper, so the sheet below shows through.
 */
export function awayLayers(palette: Palette, theme: Theme, withGround = true): LayerSpecification[] {
  const { away } = palette;
  const classColor = (cls: RoadClass): ExpressionSpecification => [
    'case',
    IS_TUNNEL,
    away.roadTunnel[cls],
    away.road[cls],
  ];
  const rampColor: ExpressionSpecification = [
    'match',
    ['get', 'class'],
    ['motorway', 'trunk'],
    away.road.motorway,
    'primary',
    away.road.primary,
    'secondary',
    away.road.secondary,
    away.road.tertiary,
  ];
  return [
    ...(withGround ? groundLayers(palette) : [waterEdgeLayer(palette)]),
    railLayer(palette),
    ...roadLayers(AWAY_ROAD_WEIGHTS, (kind) => (kind === 'ramp' ? rampColor : classColor(kind))),
    ...streetNameLayers({ text: away.lettering, halo: palette.sheet }),
    routeNumberLayer({
      roads: ['all', classIs('motorway'), ['<=', ['get', 'ref_length'], 6]],
      from: ROUTE_NUMBERS_FROM,
      plate: routeImageId('away', theme),
      numerals: away.lettering,
      spacing: 420,
    }),
  ];
}
