import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { ALL_INKS, inksFor, type Inks } from '../../app/theme';
import { NO_DRAWING, type Sheet, type SheetDrawing } from '../contracts';
import { drawingLayers, drawingSources, REACH_SOURCE_ID, reachData, ROUTE_SOURCE_ID, routeData, withDrawing } from './drawing';
import { createStyles } from './index';

const LIGHT = inksFor('classic', 'light');
const DARK = inksFor('classic', 'dark');
const SHEETS: readonly Sheet[] = ['home', 'away'];
const route = [
  { lat: 51.5, lng: -0.12 },
  { lat: 51.51, lng: -0.1 },
  { lat: 51.52, lng: -0.11 },
];
const ring = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
  { lat: 0, lng: 0 },
];
const drawing: SheetDrawing = { route, reach: [[ring, ring], [ring]] };

function drawn(inks: Inks, sheet: Sheet, zoomOffset: number, what: SheetDrawing): StyleSpecification {
  const styles = createStyles(inks);
  const style = sheet === 'home' ? styles.overlay(zoomOffset) : styles.base;
  return withDrawing(style, styles.drawing(sheet, zoomOffset), what);
}

describe('a sheet with its drawing on top', () => {
  const cases = [LIGHT, DARK].flatMap((inks) => SHEETS.flatMap((sheet) => [0, 0.35, -1.2].map((offset) => ({ inks, id: inks.id, sheet, offset }))));

  it.each(cases)('passes the MapLibre style validator: $sheet, $id, offset $offset', ({ inks, sheet, offset }) => {
    for (const what of [NO_DRAWING, drawing]) {
      expect(validateStyleMin(drawn(inks, sheet, offset, what)).map((error) => error.message)).toEqual([]);
    }
  });

  it('keeps every layer of the sheet, in order, underneath', () => {
    const styles = createStyles(LIGHT);
    const style = drawn(LIGHT, 'away', 0, drawing);
    const sheetIds = styles.base.layers.map((layer) => layer.id);
    expect(style.layers.slice(0, sheetIds.length).map((layer) => layer.id)).toEqual(sheetIds);
    expect(style.layers.slice(sheetIds.length).map((layer) => layer.id)).toEqual(['drive-reach-tint', 'drive-reach-edge', 'drive-route-casing', 'drive-route']);
    expect(new Set(style.layers.map((layer) => layer.id)).size).toBe(style.layers.length);
  });

  it('leaves the sheet’s own style as it was', () => {
    const styles = createStyles(DARK);
    const before = JSON.stringify(styles.base);
    drawn(DARK, 'away', 0, drawing);
    withDrawing(styles.base, styles.drawing('away', 0), drawing);
    expect(JSON.stringify(styles.base)).toBe(before);
  });

  it('carries the drawing in the style itself, so that a restyle cannot drop it', () => {
    const style = drawn(LIGHT, 'home', 0, drawing);
    expect(style.sources[ROUTE_SOURCE_ID]).toEqual({ type: 'geojson', data: routeData(route) });
    expect(style.sources[REACH_SOURCE_ID]).toEqual({ type: 'geojson', data: reachData(drawing.reach) });
  });
});

describe('the layers of a drawing', () => {
  it.each(ALL_INKS)('prints the route in the sheet’s own ink, cased in the key ink: $id', (inks) => {
    for (const sheet of SHEETS) {
      const layers = drawingLayers(inks, sheet);
      const paint = (id: string): Record<string, unknown> => layers.find((layer) => layer.id === id)?.paint as Record<string, unknown>;
      expect(paint('drive-route')['line-color']).toBe(sheet === 'home' ? inks.home : inks.away);
      expect(paint('drive-route-casing')['line-color']).toBe(inks.key);
    }
  });

  it('prints Home’s reach in the Home ink and Away’s in the ink Away is lettered in', () => {
    const tint = (sheet: Sheet): unknown => (drawingLayers(LIGHT, sheet)[0]?.paint as Record<string, unknown>)['fill-color'];
    expect(tint('home')).toBe(LIGHT.home);
    expect(tint('away')).toBe(LIGHT.awayDeep);
  });

  it('moves the zoom stops of the route’s width with Home’s zoom offset, so it is as heavy on either sheet', () => {
    const width = (zoomOffset: number): unknown[] => {
      const paint = drawingLayers(LIGHT, 'home', zoomOffset).find((layer) => layer.id === 'drive-route')?.paint as Record<string, unknown>;
      return paint['line-width'] as unknown[];
    };
    const flat = width(0);
    const shifted = width(0.5);
    // ["interpolate", curve, ["zoom"], stop, width, stop, width]
    expect(shifted[3]).toBe((flat[3] as number) + 0.5);
    expect(shifted[4]).toBe(flat[4]);
    expect(shifted[5]).toBe((flat[5] as number) + 0.5);
  });

  it('asks the style factory for Away’s layers without any offset', () => {
    const styles = createStyles(LIGHT);
    expect(styles.drawing('away', 0.8)).toEqual(drawingLayers(LIGHT, 'away', 0));
    expect(styles.drawing('home', 0.5)).toEqual(drawingLayers(LIGHT, 'home', 0.5));
  });
});

describe('a drawing as map data', () => {
  it('writes a route as one line, longitude first', () => {
    expect(routeData(route)).toEqual({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.12, 51.5],
          [-0.1, 51.51],
          [-0.11, 51.52],
        ],
      },
    });
  });

  it('writes a reach as its areas, holes and all', () => {
    const data = reachData(drawing.reach) as { geometry: { type: string; coordinates: number[][][][] } };
    expect(data.geometry.type).toBe('MultiPolygon');
    expect(data.geometry.coordinates.map((polygon) => polygon.length)).toEqual([2, 1]);
    expect(data.geometry.coordinates[0]?.[0]?.[1]).toEqual([1, 0]);
  });

  it('writes nothing as an empty collection, never as a shape without points', () => {
    const nothing = { type: 'FeatureCollection', features: [] };
    expect(routeData(null)).toEqual(nothing);
    expect(routeData([route[0] as (typeof route)[number]])).toEqual(nothing);
    expect(reachData(null)).toEqual(nothing);
    expect(reachData([])).toEqual(nothing);
    expect(drawingSources(NO_DRAWING)).toEqual({ [ROUTE_SOURCE_ID]: { type: 'geojson', data: nothing }, [REACH_SOURCE_ID]: { type: 'geojson', data: nothing } });
  });
});
