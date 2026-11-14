import type { ExpressionSpecification, LayerSpecification, LineLayerSpecification } from 'maplibre-gl';
import type { Theme } from '../../app/types';
import { SOURCE_ID } from '../contracts';
import { NOT_INTERMITTENT, NOT_TUNNEL, classIs, fadeIn, linearByZoom, widthByZoom } from './expressions';
import { groundLayers } from './away';
import { routeImageId } from './images';
import { routeNumberLayer, streetNameLayers } from './lettering';
import type { Palette } from './palette';
import { HOME_ROAD_WEIGHTS, ROAD_CLASSES, ROAD_DATA_FROM, roadLayers, type RoadWeights } from './roads';
import { shiftLayerZoom } from './zoom';

/*
 * Home is overprinted on Away in one warm ink, as line-work only: no ground, no land fills. Its one
 * area mark is the sea, because a coastline is the shape a native knows best.
 *
 * Unless Home has the ground: then it is the sheet underneath, printing the paper and the flat tints
 * of land and water (see `groundLayers`), with its line-work on them and Away's over it all.
 *
 * Every zoom below is an AWAY zoom. The Home map runs `zoomOffset` levels above Away, so the finished
 * layers are shifted by that much at the end and the two sheets thicken and thin together.
 */

const FRESH_WATER_FROM = 9;
const ROUTE_NUMBERS_FROM = 7;

const SEA: ExpressionSpecification = classIs('ocean');

function seaLine(id: string, paint: LineLayerSpecification['paint']): LineLayerSpecification {
  const layout: LineLayerSpecification['layout'] = { 'line-join': 'round' };
  return { id, type: 'line', source: SOURCE_ID, 'source-layer': 'water', filter: SEA, layout, paint };
}

/**
 * A copy of the shoreline standing `pixels` out into the water. Below zoom 9 a whole bay is only a few
 * dozen pixels across, so the copies close up on the shore rather than filling it.
 */
function waterLining(id: string, ink: string, pixels: number, width: number, opacity: number): LineLayerSpecification {
  const offset = linearByZoom([[6, pixels / 2], [9, pixels]]);
  return seaLine(id, { 'line-color': ink, 'line-width': width, 'line-offset': offset, 'line-opacity': opacity });
}

/**
 * The sea, engraved: a firm shoreline and two fainter "water-lining" lines stepping out into the water,
 * over a light tint.
 *
 * The lining is the shoreline drawn again, offset to its water side. Sea polygons are cut 8 px outside
 * each tile, so those cuts would be drawn too if an offset line reached back inside the tile: the
 * outer line must stay nearer than 8 px.
 */
function seaLayers(ink: string, withGround: boolean): LayerSpecification[] {
  const lining = [
    waterLining('sea-lining-far', ink, 7, 0.6, 0.3),
    waterLining('sea-lining-near', ink, 3.5, 0.7, 0.55),
    seaLine('shoreline', { 'line-color': ink, 'line-width': widthByZoom([[12, 1.4], [16, 2.4]]) }),
  ];
  // On the ground the sea is already tinted as water; a wash of Home ink over it would only muddy it.
  if (withGround) return lining;
  return [
    {
      id: 'sea-tint',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'water',
      filter: SEA,
      // An antialiased fill gets an outline pass, which would lay a second coat of this tint along every edge.
      paint: { 'fill-color': ink, 'fill-opacity': 0.07, 'fill-antialias': false },
    },
    ...lining,
  ];
}

function freshWaterLayer(ink: string): LineLayerSpecification {
  return {
    id: 'fresh-water',
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'water',
    minzoom: FRESH_WATER_FROM,
    filter: ['all', classIs('lake', 'river'), NOT_INTERMITTENT, NOT_TUNNEL],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ink, 'line-width': 0.6, 'line-opacity': fadeIn(FRESH_WATER_FROM, 0.55) },
  };
}

/**
 * Tile data cannot be shifted: a class exists from a fixed tile zoom of the Home map. Where Home runs
 * far enough below Away that the design asks for a class before Home's tiles have it, the class joins
 * (and fades in) when its data does.
 */
function waitForData(weights: RoadWeights, zoomOffset: number): RoadWeights {
  const waiting = { ...weights };
  for (const cls of ROAD_CLASSES) {
    waiting[cls] = { ...weights[cls], from: Math.max(weights[cls].from, ROAD_DATA_FROM[cls] - zoomOffset) };
  }
  return waiting;
}

export function homeLayers(palette: Palette, theme: Theme, zoomOffset: number, withGround = false): LayerSpecification[] {
  const { ink } = palette.home;
  const layers: LayerSpecification[] = [
    ...(withGround ? groundLayers(palette) : []),
    ...seaLayers(ink, withGround),
    freshWaterLayer(ink),
    // Every road at full strength, tunnels included: to a native the freeway is one line whether or not it dives.
    ...roadLayers(waitForData(HOME_ROAD_WEIGHTS, zoomOffset), () => ink),
    ...streetNameLayers({ text: ink, halo: palette.sheet }),
    routeNumberLayer({
      // Freeways, plus the short numbers of trunk roads (a native knows "17" and "101"; county-route codes are noise).
      roads: [
        'any',
        ['all', classIs('motorway'), ['<=', ['get', 'ref_length'], 6]],
        ['all', classIs('trunk'), ['<=', ['get', 'ref_length'], 4]],
      ],
      from: ROUTE_NUMBERS_FROM,
      plate: routeImageId('home', theme),
      numerals: palette.sheet,
      spacing: 340,
    }),
  ];
  return layers.map((layer) => shiftLayerZoom(layer, zoomOffset));
}
