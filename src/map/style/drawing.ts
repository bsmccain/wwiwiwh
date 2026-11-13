import type { GeoJSONSourceSpecification, LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import { INKS } from '../../app/theme';
import type { Theme } from '../../app/types';
import type { LngLat, Outline } from '../../geo/types';
import type { Sheet, SheetDrawing } from '../contracts';
import { widthByZoom } from './expressions';
import { shiftLayerZoom } from './zoom';

/*
 * What is drawn on a sheet besides its streets: the road a drive takes, and the area a drive
 * reaches. Both belong to one place and lie on its roads, so they are printed by that place's own
 * map, in its ink, and move, turn and hide with it. They are kept out of the two sheet styles
 * themselves (see index.ts), which describe the printed map and nothing that comes and goes.
 */

export const ROUTE_SOURCE_ID = 'drive-route';
export const REACH_SOURCE_ID = 'drive-reach';

/**
 * The route is a line of the place's ink inside a casing of key ink: the ink says whose road it is,
 * and the casing sets it apart from every road of that ink, the freeway it runs along included.
 */
const ROUTE_WIDTH = widthByZoom([[8, 2.5], [14, 4]]);
const ROUTE_CASING_WIDTH = widthByZoom([[8, 5.5], [14, 8]]);
/** Light enough that the streets under the reach still read; the edge is what says where it ends. */
const REACH_TINT_OPACITY = 0.13;

/** Shapes as a map source takes them. */
type Shapes = Exclude<GeoJSONSourceSpecification['data'], string>;

const NOTHING: Shapes = { type: 'FeatureCollection', features: [] };

const pair = ({ lng, lat }: LngLat): [number, number] => [lng, lat];

/** A route as the map's own data. Nothing at all is an empty collection, never a line without points. */
export function routeData(route: readonly LngLat[] | null): Shapes {
  if (!route || route.length < 2) return NOTHING;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map(pair) } };
}

export function reachData(reach: Outline | null): Shapes {
  if (!reach || reach.length === 0) return NOTHING;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: reach.map((polygon) => polygon.map((ring) => ring.map(pair))) },
  };
}

export function drawingSources(drawing: SheetDrawing): Record<string, SourceSpecification> {
  return {
    [ROUTE_SOURCE_ID]: { type: 'geojson', data: routeData(drawing.route) },
    [REACH_SOURCE_ID]: { type: 'geojson', data: reachData(drawing.reach) },
  };
}

/**
 * The layers a sheet's drawing is printed with, to go on top of everything else on that sheet. Home's
 * reach is in the Home ink; Away's is in the deeper Away ink its names are lettered in, which its
 * roads never use. Every zoom is an AWAY zoom: `zoomOffset` is how far above Away the sheet's own map runs
 * (nothing for Away itself), so that a route is as heavy on either sheet.
 */
export function drawingLayers(theme: Theme, sheet: Sheet, zoomOffset = 0): LayerSpecification[] {
  const inks = INKS[theme];
  const ink = sheet === 'home' ? inks.home : inks.awayDeep;
  const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
  const layers: LayerSpecification[] = [
    {
      id: 'drive-reach-tint',
      type: 'fill',
      source: REACH_SOURCE_ID,
      // An antialiased fill gets an outline pass, which would lay a second coat of the tint along the edge.
      paint: { 'fill-color': ink, 'fill-opacity': REACH_TINT_OPACITY, 'fill-antialias': false },
    },
    {
      id: 'drive-reach-edge',
      type: 'line',
      source: REACH_SOURCE_ID,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ink, 'line-width': 1.6, 'line-dasharray': [3, 2] },
    },
    { id: 'drive-route-casing', type: 'line', source: ROUTE_SOURCE_ID, layout: round, paint: { 'line-color': inks.key, 'line-width': ROUTE_CASING_WIDTH } },
    { id: 'drive-route', type: 'line', source: ROUTE_SOURCE_ID, layout: round, paint: { 'line-color': sheet === 'home' ? inks.home : inks.away, 'line-width': ROUTE_WIDTH } },
  ];
  return layers.map((layer) => shiftLayerZoom(layer, zoomOffset));
}

/** A sheet's style with its drawing on top: what the map is actually given. */
export function withDrawing(style: StyleSpecification, layers: readonly LayerSpecification[], drawing: SheetDrawing): StyleSpecification {
  return {
    ...style,
    sources: { ...style.sources, ...drawingSources(drawing) },
    layers: [...style.layers, ...layers],
  };
}
