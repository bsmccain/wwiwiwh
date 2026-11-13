import type { LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { shiftLayerZoom, shiftZoomStops } from './zoom';

describe('shiftZoomStops', () => {
  it('moves the stops of a zoom interpolation and leaves the values alone', () => {
    const width = ['interpolate', ['exponential', 1.5], ['zoom'], 6, 1.3, 9.5, 2.7, 12, 4.2];
    const shifted = ['interpolate', ['exponential', 1.5], ['zoom'], 6.35, 1.3, 9.85, 2.7, 12.35, 4.2];
    expect(shiftZoomStops(width, 0.35)).toEqual(shifted);
  });

  it('moves stops down for a negative offset', () => {
    expect(shiftZoomStops(['interpolate', ['linear'], ['zoom'], 13, 0, 13.4, 1], -1.2)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      11.8,
      0,
      12.2,
      1,
    ]);
  });

  it('moves the stops of a zoom step but not its base output', () => {
    const dash = ['step', ['zoom'], ['literal', [2, 2]], 12, ['literal', [4, 2]], 15, ['literal', [6, 2]]];
    const shifted = ['step', ['zoom'], ['literal', [2, 2]], 13, ['literal', [4, 2]], 16, ['literal', [6, 2]]];
    expect(shiftZoomStops(dash, 1)).toEqual(shifted);
  });

  it('keeps numeric outputs of a step as they are', () => {
    expect(shiftZoomStops(['step', ['zoom'], 0, 10, 1, 13, 2], 0.5)).toEqual(['step', ['zoom'], 0, 10.5, 1, 13.5, 2]);
  });

  it('finds a zoom curve nested inside another expression', () => {
    const byTunnel = ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.5, 1];
    const opacity = ['*', byTunnel, ['interpolate', ['linear'], ['zoom'], 9, 0, 9.4, 1]];
    expect(shiftZoomStops(opacity, 1)).toEqual(['*', byTunnel, ['interpolate', ['linear'], ['zoom'], 10, 0, 10.4, 1]]);
  });

  it('shifts zoom curves used as the outputs of a zoom curve', () => {
    const nested = ['interpolate', ['linear'], ['zoom'], 8, ['step', ['zoom'], 1, 9, 2], 12, 4];
    const shifted = ['interpolate', ['linear'], ['zoom'], 10, ['step', ['zoom'], 1, 11, 2], 14, 4];
    expect(shiftZoomStops(nested, 2)).toEqual(shifted);
  });

  it('leaves curves over feature data alone', () => {
    const byRank = ['interpolate', ['linear'], ['get', 'rank'], 1, 16, 10, 11];
    expect(shiftZoomStops(byRank, 3)).toEqual(byRank);
    const byLength = ['step', ['get', 'ref_length'], 'a', 3, 'b'];
    expect(shiftZoomStops(byLength, 3)).toEqual(byLength);
  });

  it('leaves literals and plain values alone', () => {
    expect(shiftZoomStops(['literal', ['interpolate', ['linear'], ['zoom'], 1, 2]], 1)).toEqual([
      'literal',
      ['interpolate', ['linear'], ['zoom'], 1, 2],
    ]);
    expect(shiftZoomStops(['Noto Sans Regular'], 1)).toEqual(['Noto Sans Regular']);
    expect(shiftZoomStops([6, 2], 1)).toEqual([6, 2]);
    expect(shiftZoomStops(0.6, 1)).toBe(0.6);
    expect(shiftZoomStops('#C8102E', 1)).toBe('#C8102E');
  });

  it('does not change its input', () => {
    const width = ['interpolate', ['linear'], ['zoom'], 6, 1, 9, 2];
    const copy = structuredClone(width);
    shiftZoomStops(width, 0.35);
    expect(width).toEqual(copy);
  });

  it('writes stops without floating-point dust', () => {
    expect(shiftZoomStops(['interpolate', ['linear'], ['zoom'], 10.4, 0, 12, 1], 0.35)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      10.75,
      0,
      12.35,
      1,
    ]);
  });

  it('is undone by the opposite shift', () => {
    const width = ['interpolate', ['exponential', 1.5], ['zoom'], 6, 1.3, 9.5, 2.7, 12, 4.2];
    expect(shiftZoomStops(shiftZoomStops(width, 0.35), -0.35)).toEqual(width);
  });
});

describe('shiftLayerZoom', () => {
  const road: LineLayerSpecification = {
    id: 'road-secondary',
    type: 'line',
    source: 'omt',
    'source-layer': 'transportation',
    minzoom: 10.4,
    maxzoom: 20,
    filter: ['==', ['get', 'class'], 'secondary'],
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': '#C8102E',
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10.4, 0.45, 12, 1],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.4, 0, 10.8, 1],
    },
  };

  it('moves the zoom range and every zoom stop in paint', () => {
    const shifted = shiftLayerZoom(road, 0.35);
    expect(shifted.minzoom).toBe(10.75);
    expect(shifted.maxzoom).toBe(20.35);
    expect(shifted.paint).toEqual({
      'line-color': '#C8102E',
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10.75, 0.45, 12.35, 1],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.75, 0, 11.15, 1],
    });
  });

  it('moves zoom stops in layout too', () => {
    const names: SymbolLayerSpecification = {
      id: 'street-names',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'transportation_name',
      minzoom: 14,
      layout: {
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 17, 12.5],
      },
    };
    expect(shiftLayerZoom(names, -1).layout).toEqual({
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 16, 12.5],
    });
    expect(shiftLayerZoom(names, -1).minzoom).toBe(13);
  });

  it('keeps the filter, the source and the id', () => {
    const shifted = shiftLayerZoom(road, 1);
    expect(shifted.filter).toEqual(road.filter);
    expect(shifted.id).toBe(road.id);
    expect(shifted['source-layer']).toBe('transportation');
  });

  it('keeps the zoom range inside what MapLibre accepts', () => {
    expect(shiftLayerZoom({ ...road, minzoom: 0.5 }, -1.2).minzoom).toBe(0);
    expect(shiftLayerZoom({ ...road, maxzoom: 23.5 }, 1.2).maxzoom).toBe(24);
  });

  it('does not invent a zoom range the layer did not have', () => {
    const shoreline: LineLayerSpecification = { id: 'shoreline', type: 'line', source: 'omt', 'source-layer': 'water' };
    const shifted = shiftLayerZoom(shoreline, 0.35);
    expect(shifted).toEqual(shoreline);
    expect('minzoom' in shifted).toBe(false);
  });

  it('does not change its input', () => {
    const copy = structuredClone(road);
    shiftLayerZoom(road, 0.35);
    expect(road).toEqual(copy);
  });
});
