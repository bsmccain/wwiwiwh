import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { INKS } from '../../app/theme';
import type { Theme } from '../../app/types';
import { SOURCE_ID } from '../contracts';
import type { ZoomStops } from './expressions';
import { routeImageId } from './images';
import { createStyles } from './index';
import { AWAY_ROAD_STRENGTH } from './palette';
import { AWAY_ROAD_WEIGHTS, HOME_ROAD_WEIGHTS, ROAD_CLASSES, ROAD_DATA_FROM } from './roads';

const THEMES: readonly Theme[] = ['light', 'dark'];
const ZOOM_OFFSETS = [-1.2, 0, 0.35, 1.2];
/** The only font stacks OpenFreeMap serves. A stack of two names is a different, missing, file. */
const FONT_STACKS = [['Noto Sans Regular'], ['Noto Sans Bold'], ['Noto Sans Italic']];

interface Case {
  readonly label: string;
  readonly theme: Theme;
  readonly style: StyleSpecification;
}

const AWAY_STYLES: Case[] = THEMES.map((theme) => ({
  label: `away, ${theme}`,
  theme,
  style: createStyles(theme).base,
}));
const HOME_STYLES: Case[] = THEMES.flatMap((theme) =>
  ZOOM_OFFSETS.map((offset) => ({
    label: `home, ${theme}, offset ${offset}`,
    theme,
    style: createStyles(theme).overlay(offset),
  })),
);
/** The same pair with the ground handed to Home: Away becomes line-work, Home the sheet underneath. */
const AWAY_LINE_STYLES: Case[] = THEMES.map((theme) => ({
  label: `away without the ground, ${theme}`,
  theme,
  style: createStyles(theme, 'home').base,
}));
const HOME_GROUND_STYLES: Case[] = THEMES.flatMap((theme) =>
  ZOOM_OFFSETS.map((offset) => ({
    label: `home with the ground, ${theme}, offset ${offset}`,
    theme,
    style: createStyles(theme, 'home').overlay(offset),
  })),
);
const ALL_STYLES = [...AWAY_STYLES, ...HOME_STYLES, ...AWAY_LINE_STYLES, ...HOME_GROUND_STYLES];

function layer(style: StyleSpecification, id: string): LayerSpecification {
  const found = style.layers.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No layer "${id}"`);
  return found;
}

function sourceLayerOf(candidate: LayerSpecification): string | undefined {
  return 'source-layer' in candidate ? candidate['source-layer'] : undefined;
}

/** A paint value that is known to be an expression, as its parts. */
function paintExpression(candidate: LayerSpecification, property: string): unknown[] {
  const value = (candidate.paint as Record<string, unknown> | undefined)?.[property];
  if (!Array.isArray(value)) throw new Error(`"${candidate.id}" has no ${property} expression`);
  return value;
}

/** MapLibre's exponential interpolation between zoom stops, clamped at both ends. */
function widthAt(stops: ZoomStops, zoom: number, base = 1.5): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) throw new Error('No stops');
  if (zoom <= first[0]) return first[1];
  if (zoom >= last[0]) return last[1];
  const upper = stops.findIndex(([stop]) => stop > zoom);
  const [z0, w0] = stops[upper - 1] ?? first;
  const [z1, w1] = stops[upper] ?? last;
  const t = (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1);
  return w0 + (w1 - w0) * t;
}

describe.each(ALL_STYLES)('$label', ({ style }) => {
  it('passes the MapLibre style validator', () => {
    expect(validateStyleMin(style).map((error) => error.message)).toEqual([]);
  });

  it('draws from the one OpenFreeMap source', () => {
    expect(style.sources).toEqual({ [SOURCE_ID]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } });
    for (const candidate of style.layers) {
      if (candidate.type !== 'background') expect(candidate.source).toBe(SOURCE_ID);
    }
  });

  it('letters only in font stacks the glyph server has', () => {
    expect(style.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    const symbols = style.layers.filter((candidate) => candidate.type === 'symbol');
    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(FONT_STACKS, symbol.id).toContainEqual(symbol.layout?.['text-font']);
    }
  });

  it('leaves place names to the type plate', () => {
    expect(style.layers.map(sourceLayerOf)).not.toContain('place');
  });

  it('gives every layer its own id', () => {
    const ids = style.layers.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(AWAY_STYLES)('$label', ({ style, theme }) => {
  it('starts with the sheet', () => {
    const sheet = { id: 'sheet', type: 'background', paint: { 'background-color': INKS[theme].sheet } };
    expect(style.layers[0]).toEqual(sheet);
  });

  it('does not fill nature reserves as if they were parks', () => {
    expect(style.layers.map(sourceLayerOf)).not.toContain('park');
  });

  it('prints its two heaviest road classes in the full Away ink', () => {
    const away = INKS[theme].away.toLowerCase();
    for (const id of ['road-motorway', 'road-trunk']) {
      const road = layer(style, id);
      expect(JSON.stringify(road.paint).toLowerCase(), id).toContain(away);
    }
    expect(JSON.stringify(layer(style, 'road-minor').paint).toLowerCase()).not.toContain(away);
  });

  it('puts route numbers on the Away plate of its theme', () => {
    expect(layer(style, 'route-numbers').layout).toMatchObject({ 'icon-image': routeImageId('away', theme) });
  });
});

describe.each(HOME_STYLES)('$label', ({ style, theme }) => {
  it('has no ground, so Away shows through', () => {
    expect(style.layers.map((candidate) => candidate.type)).not.toContain('background');
  });

  it('is line-work, apart from the tint on the sea', () => {
    const fills = style.layers.filter((candidate) => candidate.type === 'fill');
    expect(fills.map((fill) => fill.id)).toEqual(['sea-tint']);
    expect(fills[0]?.paint?.['fill-opacity']).toBeLessThan(0.15);
  });

  it('prints every line in the Home ink', () => {
    const lines = style.layers.filter((candidate) => candidate.type === 'line');
    expect(lines.length).toBeGreaterThan(8);
    for (const line of lines) expect(line.paint?.['line-color'], line.id).toBe(INKS[theme].home);
  });

  it('leaves rail to Away', () => {
    expect(JSON.stringify(style.layers)).not.toContain('"rail"');
  });

  it('puts route numbers on the Home plate of its theme, lettered in the sheet colour', () => {
    const numbers = layer(style, 'route-numbers');
    expect(numbers.layout).toMatchObject({ 'icon-image': routeImageId('home', theme) });
    expect(numbers.paint).toMatchObject({ 'text-color': INKS[theme].sheet });
  });

  it('keeps the freeways on top of the other roads', () => {
    const roads = style.layers.map((candidate) => candidate.id).filter((id) => id.startsWith('road-'));
    expect(roads[roads.length - 1]).toBe('road-motorway');
    expect(roads[0]).toBe('road-minor');
  });
});

describe('the ground', () => {
  it('is on Away unless Home is given it', () => {
    expect(createStyles('light').ground).toBe('away');
    expect(createStyles('light', 'home').ground).toBe('home');
  });
});

describe.each(AWAY_LINE_STYLES)('$label', ({ style }) => {
  it('has no paper and no fills, so Home shows through', () => {
    const types = style.layers.map((candidate) => candidate.type);
    expect(types).not.toContain('background');
    expect(types).not.toContain('fill');
  });

  it('keeps the edge of its water as a line, and its roads and rail', () => {
    expect(layer(style, 'water-edge').type).toBe('line');
    expect(layer(style, 'rail').type).toBe('line');
    expect(layer(style, 'road-motorway').type).toBe('line');
  });
});

describe.each(HOME_GROUND_STYLES)('$label', ({ style, theme }) => {
  it('starts with the sheet and prints the tints of land and water before its own lines', () => {
    expect(style.layers[0]).toMatchObject({ id: 'sheet', type: 'background', paint: { 'background-color': INKS[theme].sheet } });
    const ids = style.layers.map((candidate) => candidate.id);
    for (const id of ['built-up', 'woods', 'parks', 'water']) {
      expect(layer(style, id).type, id).toBe('fill');
      expect(ids.indexOf(id), id).toBeLessThan(ids.indexOf('shoreline'));
      expect(ids.indexOf(id), id).toBeLessThan(ids.indexOf('road-minor'));
    }
  });

  it('drops the wash on the sea, which the water tint already covers', () => {
    expect(style.layers.map((candidate) => candidate.id)).not.toContain('sea-tint');
  });

  it('still prints its roads in the Home ink', () => {
    expect(layer(style, 'road-motorway').paint?.['line-color' as never]).toBe(INKS[theme].home);
  });
});

describe('Home zoom offset', () => {
  const styles = createStyles('light');

  it.each([-1.2, 0.35, 1.2])('moves every zoom threshold by %f', (offset) => {
    const flat = styles.overlay(0);
    const shifted = styles.overlay(offset);
    expect(shifted.layers.map((candidate) => candidate.id)).toEqual(flat.layers.map((candidate) => candidate.id));
    // Not the motorways: the design draws them from the tiles' first zoom, so below Away they wait for data.
    for (const road of ['road-trunk', 'road-secondary', 'road-ramps', 'fresh-water', 'street-names', 'route-numbers']) {
      expect(layer(shifted, road).minzoom, road).toBeCloseTo((layer(flat, road).minzoom ?? 0) + offset, 6);
    }
  });

  it('moves the stops of the width curves with it', () => {
    const width = paintExpression(layer(styles.overlay(0.35), 'road-motorway'), 'line-width');
    const [first] = HOME_ROAD_WEIGHTS.motorway.width;
    const firstStop = (first?.[0] ?? 0) + 0.35;
    expect(width.slice(0, 5)).toEqual(['interpolate', ['exponential', 1.5], ['zoom'], firstStop, first?.[1]]);
  });

  it('starts fading each road class in exactly where the class joins', () => {
    for (const offset of ZOOM_OFFSETS) {
      for (const cls of ROAD_CLASSES) {
        const road = layer(styles.overlay(offset), `road-${cls}`);
        const opacity = paintExpression(road, 'line-opacity');
        expect(opacity[3], `${cls} at ${offset}`).toBe(road.minzoom);
        expect(opacity[4]).toBe(0);
      }
    }
  });

  it('never asks for a road class before the Home tiles carry it', () => {
    for (const offset of [-2, ...ZOOM_OFFSETS, 2]) {
      for (const cls of ROAD_CLASSES) {
        const homeZoom = layer(styles.overlay(offset), `road-${cls}`).minzoom ?? 0;
        expect(homeZoom, `${cls} at ${offset}`).toBeGreaterThanOrEqual(ROAD_DATA_FROM[cls]);
      }
    }
  });

  it('holds a class back only when its data is late', () => {
    // Home 1.2 levels below Away: minor streets exist from Home zoom 12, which is Away zoom 13.2,
    // later than the design's 13.
    expect(layer(styles.overlay(-1.2), 'road-minor').minzoom).toBe(ROAD_DATA_FROM.minor);
    // Home above Away: the data is there early, so the design's own threshold stands.
    expect(layer(styles.overlay(1.2), 'road-minor').minzoom).toBeCloseTo(HOME_ROAD_WEIGHTS.minor.from + 1.2, 6);
  });

  it('builds the same style for offsets that differ by a hair', () => {
    expect(styles.overlay(0.3501)).toEqual(styles.overlay(0.3499));
    expect(styles.overlay(0.35)).not.toEqual(styles.overlay(0.4));
  });

  it('builds a fresh style each time', () => {
    expect(styles.overlay(0.35)).not.toBe(styles.overlay(0.35));
    expect(styles.overlay(0.35)).toEqual(styles.overlay(0.35));
  });
});

describe('road weights', () => {
  it('prints Home about 1.6 times heavier than Away, class for class, once the class has joined', () => {
    for (const cls of ROAD_CLASSES) {
      for (const zoom of [8, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
        if (zoom < HOME_ROAD_WEIGHTS[cls].from + 0.5) continue;
        // Weight on the sheet is width times ink strength; Home's strength is always 1.
        const home = widthAt(HOME_ROAD_WEIGHTS[cls].width, zoom);
        const away = widthAt(AWAY_ROAD_WEIGHTS[cls].width, zoom) * AWAY_ROAD_STRENGTH[cls];
        expect(home / away, `${cls} at zoom ${zoom}`).toBeGreaterThan(1.15);
        expect(home / away, `${cls} at zoom ${zoom}`).toBeLessThan(2.4);
      }
    }
  });

  it('draws the Home freeways wider than the Away motorways at every zoom', () => {
    for (const zoom of [6, 8, 10, 12, 14, 16, 18]) {
      const ratio = widthAt(HOME_ROAD_WEIGHTS.motorway.width, zoom) / widthAt(AWAY_ROAD_WEIGHTS.motorway.width, zoom);
      expect(ratio, `zoom ${zoom}`).toBeGreaterThan(1.35);
    }
  });

  it('draws no line thinner than 0.3 px, which would shimmer while panning', () => {
    for (const weights of [AWAY_ROAD_WEIGHTS, HOME_ROAD_WEIGHTS]) {
      for (const [kind, weight] of Object.entries(weights)) {
        for (const [, width] of weight.width) expect(width, kind).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('orders each sheet from freeway down to side street at every zoom', () => {
    const heaviestFirst = [...ROAD_CLASSES].reverse();
    for (const weights of [AWAY_ROAD_WEIGHTS, HOME_ROAD_WEIGHTS]) {
      for (const zoom of [8, 10, 12, 14, 16]) {
        const joined = heaviestFirst.filter((cls) => zoom >= weights[cls].from);
        const widths = joined.map((cls) => widthAt(weights[cls].width, zoom));
        expect(widths, `zoom ${zoom}`).toEqual([...widths].sort((a, b) => b - a));
      }
    }
  });

  it('keeps ramps off both sheets until zoom 12', () => {
    expect(AWAY_ROAD_WEIGHTS.ramp.from).toBeGreaterThanOrEqual(12);
    expect(HOME_ROAD_WEIGHTS.ramp.from).toBeGreaterThanOrEqual(12);
    for (const { style } of ALL_STYLES) {
      for (const cls of ROAD_CLASSES) {
        expect(JSON.stringify(layer(style, `road-${cls}`)), cls).toContain('["!=",["get","ramp"],1]');
      }
    }
  });
});
