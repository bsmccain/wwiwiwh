import { describe, expect, it } from 'vitest';
import { ALL_INKS } from '../../app/theme';
import { mix, paletteFor } from './palette';
import { ROAD_CLASSES } from './roads';

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const linear = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe('mix', () => {
  it('returns the ink at full share and the ground at none', () => {
    expect(mix('#2A5CAA', '#F5F7F4', 1)).toBe('#2a5caa');
    expect(mix('#2A5CAA', '#F5F7F4', 0)).toBe('#f5f7f4');
  });

  it('mixes channel by channel', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#0000ff', 0.25)).toBe('#4000bf');
  });

  it('always writes six hex digits', () => {
    expect(mix('#000000', '#0a0a0a', 0.5)).toBe('#050505');
  });
});

describe.each(ALL_INKS)('$id palette', (inks) => {
  const palette = paletteFor(inks);

  it('takes its inks and its flat tints from the printing', () => {
    expect(palette.sheet).toBe(inks.sheet);
    expect(palette.home.ink).toBe(inks.home);
    expect(palette.away.lettering).toBe(inks.awayDeep);
    expect(palette.away.road.motorway).toBe(inks.away.toLowerCase());
    expect(palette.away.road.trunk).toBe(inks.away.toLowerCase());
    expect(palette.away).toMatchObject({ builtUp: inks.builtUp, green: inks.green, water: inks.water, waterEdge: inks.waterEdge });
  });

  it('weakens Away roads class by class toward the sheet', () => {
    const heaviestFirst = [...ROAD_CLASSES].reverse();
    const contrasts = heaviestFirst.map((cls) => contrast(palette.away.road[cls], palette.sheet));
    expect(contrasts).toEqual([...contrasts].sort((a, b) => b - a));
    expect(contrasts[contrasts.length - 1]).toBeGreaterThan(1.4);
  });

  it('prints tunnels fainter than the same road above ground', () => {
    for (const cls of ROAD_CLASSES) {
      const aboveGround = contrast(palette.away.road[cls], palette.sheet);
      expect(contrast(palette.away.roadTunnel[cls], palette.sheet), cls).toBeLessThan(aboveGround);
    }
    expect(contrast(palette.away.railTunnel, palette.sheet)).toBeLessThan(contrast(palette.away.rail, palette.sheet));
  });

  it('keeps the flat tints quieter than the faintest road', () => {
    const faintestRoad = contrast(palette.away.road.minor, palette.sheet);
    for (const tint of [palette.away.builtUp, palette.away.green, palette.away.water]) {
      expect(contrast(tint, palette.sheet), tint).toBeLessThan(faintestRoad);
    }
  });

  it('sets Home apart from the bulk of Away in lightness as well as hue', () => {
    const home = luminance(inks.home);
    if (inks.theme === 'dark') {
      for (const cls of ROAD_CLASSES) expect(home, cls).toBeGreaterThan(luminance(palette.away.road[cls]));
      return;
    }
    // On the light sheet the full Away ink (motorway, trunk) is as dark as Home; weight and hue carry those.
    for (const cls of ['primary', 'secondary', 'tertiary', 'minor'] as const) {
      expect(home, cls).toBeLessThan(luminance(palette.away.road[cls]));
    }
  });
});
