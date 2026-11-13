import { INKS } from '../../app/theme';
import type { Theme } from '../../app/types';
import type { RoadClass } from './roads';

/**
 * Every colour the two map styles print with. The inks come from src/app/theme.ts; the flat tints of
 * the Away sheet are set by hand per theme, and everything else is an ink mixed toward the sheet.
 */
export interface Palette {
  /** The paper. Also what lettering is haloed with and what Home's route numbers are lettered in. */
  readonly sheet: string;
  readonly away: {
    readonly builtUp: string;
    readonly green: string;
    readonly water: string;
    readonly waterEdge: string;
    readonly road: Readonly<Record<RoadClass, string>>;
    /** Roads underground: the same class, printed fainter. */
    readonly roadTunnel: Readonly<Record<RoadClass, string>>;
    readonly rail: string;
    readonly railTunnel: string;
    readonly lettering: string;
  };
  readonly home: {
    readonly ink: string;
  };
}

/** Share of the Away ink in each road class; the rest is sheet. (Home prints every class at full strength.) */
export const AWAY_ROAD_STRENGTH: Readonly<Record<RoadClass, number>> = {
  motorway: 1,
  trunk: 1,
  primary: 0.78,
  secondary: 0.55,
  tertiary: 0.5,
  minor: 0.38,
};
const AWAY_RAIL_STRENGTH = 0.5;
/** How much of its strength an Away line keeps underground. */
const TUNNEL_STRENGTH = 0.45;

const AWAY_TINTS: Readonly<Record<Theme, Pick<Palette['away'], 'builtUp' | 'green' | 'water' | 'waterEdge'>>> = {
  light: { builtUp: '#E8ECEF', green: '#DDE8DB', water: '#CFDDEE', waterEdge: '#8FAFD8' },
  dark: { builtUp: '#15263B', green: '#132C2E', water: '#17365C', waterEdge: '#3F6699' },
};

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * `share` of `ink` over `ground`, as an opaque colour. Road classes are mixed this way instead of
 * being drawn translucent, so two faint lines that cross do not add up to a darker spot.
 */
export function mix(ink: string, ground: string, share: number): string {
  const top = channels(ink);
  const bottom = channels(ground);
  const mixed = top.map((channel, index) => Math.round(channel * share + (bottom[index] ?? 0) * (1 - share)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function tintEachClass(tint: (share: number) => string, scale = 1): Record<RoadClass, string> {
  const tints = Object.entries(AWAY_ROAD_STRENGTH).map(([cls, share]) => [cls, tint(share * scale)]);
  return Object.fromEntries(tints) as Record<RoadClass, string>;
}

export function paletteFor(theme: Theme): Palette {
  const inks = INKS[theme];
  const awayTint = (share: number) => mix(inks.away, inks.sheet, share);
  return {
    sheet: inks.sheet,
    away: {
      ...AWAY_TINTS[theme],
      road: tintEachClass(awayTint),
      roadTunnel: tintEachClass(awayTint, TUNNEL_STRENGTH),
      rail: awayTint(AWAY_RAIL_STRENGTH),
      railTunnel: awayTint(AWAY_RAIL_STRENGTH * TUNNEL_STRENGTH),
      lettering: inks.awayDeep,
    },
    home: { ink: inks.home },
  };
}
