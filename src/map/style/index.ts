import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { SOURCE_ID, type StyleFactory } from '../contracts';
import { awayLayers } from './away';
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
    // A restyle (new theme, new zoom offset) lands at once; the app decides what moves and when.
    transition: { duration: 0, delay: 0 },
    layers,
  };
}

/**
 * The two styles of the printed sheet for a theme: Away as the quiet base in one cool ink with flat
 * tints, Home as warm line-work overprinted on it.
 */
export const createStyles: StyleFactory = (theme) => {
  const palette = paletteFor(theme);
  return {
    base: sheetStyle(`mapz away, ${theme}`, awayLayers(palette, theme)),
    overlay: (zoomOffset) => {
      const offset = Math.round(zoomOffset / ZOOM_OFFSET_STEP) * ZOOM_OFFSET_STEP;
      return sheetStyle(`mapz home, ${theme}`, homeLayers(palette, theme, offset));
    },
    prepare: (map, sheet) => registerRouteImages(map, sheet, theme),
  };
};
