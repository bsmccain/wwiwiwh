import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { SOURCE_ID, type StyleFactory } from '../contracts';
import { awayLayers } from './away';
import { drawingLayers } from './drawing';
import { homeLayers } from './home';
import { registerRouteImages } from './images';
import { paletteFor } from './palette';

/** OpenFreeMap's TileJSON. The tile URL inside it changes with every planet build, so it is never hard-coded. */
const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Offsets closer than this build the same Home style, so a drifting pin does not restyle the map every frame. */
const ZOOM_OFFSET_STEP = 0.01;

function sheetStyle(name: string, layers: LayerSpecification[]): StyleSpecification {
  return {
    version: 8,
    name,
    glyphs: GLYPHS,
    sources: { [SOURCE_ID]: { type: 'vector', url: TILES } },
    // A restyle (new inks, new zoom offset) lands at once; the app decides what moves and when.
    transition: { duration: 0, delay: 0 },
    layers,
  };
}

/**
 * The two styles of the printed sheet in one set of inks: Away in one ink, Home as heavier line-work
 * in the other. The `ground` sheet also prints the flat tints of land and water and lies underneath;
 * by default that is Away, the quiet base with Home overprinted on it.
 */
export const createStyles: StyleFactory = (inks, ground = 'away') => {
  const palette = paletteFor(inks);
  const stepped = (zoomOffset: number): number => Math.round(zoomOffset / ZOOM_OFFSET_STEP) * ZOOM_OFFSET_STEP;
  return {
    ground,
    base: sheetStyle(`wwiwiwh away, ${inks.id}`, awayLayers(palette, inks, ground === 'away')),
    overlay: (zoomOffset) => sheetStyle(`wwiwiwh home, ${inks.id}`, homeLayers(palette, inks, stepped(zoomOffset), ground === 'home')),
    drawing: (sheet, zoomOffset) => drawingLayers(inks, sheet, sheet === 'home' ? stepped(zoomOffset) : 0),
    prepare: (map, sheet) => registerRouteImages(map, sheet, inks),
  };
};
