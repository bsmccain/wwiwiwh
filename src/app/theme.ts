import type { InkSetId, Theme, ThemeChoice } from './types';

/**
 * One printing of the sheet: a set of inks in its light or its dark version. This is the one place a
 * colour is written down. The map styles and the canvas-drawn images read it directly; the page reads
 * it as CSS custom properties, from src/styles/tokens.css for Classic (kept in step by hand) and from
 * the generated src/styles/ink-sets.css for every other set.
 */
export interface Inks {
  readonly set: InkSetId;
  readonly theme: Theme;
  /** Names this printing wherever one is needed: map style names, the images drawn for a style. */
  readonly id: string;
  /** The paper: page and map ground. */
  readonly sheet: string;
  /** The key ink: text, the pin, rings, the trip line. */
  readonly key: string;
  readonly key2: string;
  /** Home: the overprinted place you know. */
  readonly home: string;
  /** Away: the sheet underneath. */
  readonly away: string;
  /** Away lettering. Darker than Away on a light sheet, lighter on a dark one. */
  readonly awayDeep: string;
  /** Tints of the two map inks for words on a band of key ink. */
  readonly homeOnKey: string;
  readonly awayOnKey: string;
  /** The flat tints of land and water, set by hand. They print on whichever place has the ground. */
  readonly builtUp: string;
  readonly green: string;
  readonly water: string;
  readonly waterEdge: string;
}

type Colours = Omit<Inks, 'set' | 'theme' | 'id'>;

/** A kind of colour blindness: missing red, green or blue cones, or seeing no colour at all. */
export type ColourVision = 'protan' | 'deutan' | 'tritan' | 'mono';

interface InkSetSpec {
  /** What the More menu calls it. */
  readonly name: string;
  /** One or two sentences under the menu's swatches while this set is chosen. */
  readonly note: string;
  /**
   * The kinds of colour blindness under which Home, Away and the key ink still stand well apart.
   * src/app/theme.test.ts holds every set to what it claims here.
   */
  readonly holdsFor: readonly ColourVision[];
  readonly light: Colours;
  readonly dark: Colours;
}

const SPECS: Readonly<Record<InkSetId, InkSetSpec>> = {
  classic: {
    name: 'Classic',
    note: 'Red over blue. In the dark, orange over blue.',
    holdsFor: [],
    light: {
      sheet: '#F5F7F4', key: '#16202A', key2: '#47525E',
      home: '#C8102E', away: '#2A5CAA', awayDeep: '#1B3A6F',
      homeOnKey: '#FF9DA8', awayOnKey: '#A9C8F5',
      builtUp: '#E8ECEF', green: '#DDE8DB', water: '#CFDDEE', waterEdge: '#8FAFD8',
    },
    dark: {
      sheet: '#0F1C2E', key: '#F1EEE4', key2: '#B4BCC8',
      home: '#FF8F4A', away: '#5A88CF', awayDeep: '#A9C4EE',
      homeOnKey: '#A8340E', awayOnKey: '#1F4C96',
      builtUp: '#15263B', green: '#132C2E', water: '#17365C', waterEdge: '#3F6699',
    },
  },
  // Orange and blue differ along both axes of colour vision, so losing either one leaves the other.
  kingfisher: {
    name: 'Kingfisher',
    note: 'Orange over blue. Made to stay apart with red-green or blue-yellow colour blindness.',
    holdsFor: ['protan', 'deutan', 'tritan'],
    light: {
      sheet: '#F6F6F1', key: '#1A1F26', key2: '#4A525C',
      home: '#AA4C1A', away: '#2B6EC3', awayDeep: '#12305E',
      homeOnKey: '#FFB07A', awayOnKey: '#A3CBF7',
      builtUp: '#E9EBEA', green: '#DFE8D6', water: '#CDE0F2', waterEdge: '#86B0DE',
    },
    dark: {
      sheet: '#0E1A26', key: '#F3EFE6', key2: '#B5BDC6',
      home: '#F0981E', away: '#2BA4EB', awayDeep: '#9CC8F6',
      homeOnKey: '#8A4400', awayOnKey: '#0B5394',
      builtUp: '#152432', green: '#132B2A', water: '#123653', waterEdge: '#2F72A6',
    },
  },
  // The purple leans blue and the green leans yellow, which does the same job as orange and blue.
  thistle: {
    name: 'Thistle',
    note: 'Purple over green. It also stays apart with red-green or blue-yellow colour blindness.',
    holdsFor: ['protan', 'deutan', 'tritan'],
    light: {
      sheet: '#F6F4EE', key: '#1F1A26', key2: '#514A5C',
      home: '#A82FB5', away: '#3C7C1B', awayDeep: '#0D4508',
      homeOnKey: '#F0A3F5', awayOnKey: '#A8DB8C',
      builtUp: '#EAE8E6', green: '#DCE9D2', water: '#D3DFEA', waterEdge: '#93AFCB',
    },
    dark: {
      sheet: '#17131F', key: '#F1ECF2', key2: '#BDB5C6',
      home: '#EE73EF', away: '#608938', awayDeep: '#D0ECB9',
      homeOnKey: '#8E1F99', awayOnKey: '#2F6312',
      builtUp: '#201B2B', green: '#1A2A1C', water: '#1B2A47', waterEdge: '#4A6699',
    },
  },
  // No hue anywhere. Home takes the far end of the grey scale, the key ink sits between it and Away.
  newsprint: {
    name: 'Newsprint',
    note: 'No colour. Home prints black and Away grey, or white and grey in the dark, so every kind of colour vision sees the same map.',
    holdsFor: ['protan', 'deutan', 'tritan', 'mono'],
    light: {
      sheet: '#F4F4F2', key: '#333333', key2: '#5C5C5C',
      home: '#000000', away: '#6E6E6E', awayDeep: '#4A4A4A',
      homeOnKey: '#FFFFFF', awayOnKey: '#B8B8B8',
      builtUp: '#EAEAE8', green: '#E3E3E0', water: '#D7D7D5', waterEdge: '#A3A3A3',
    },
    dark: {
      sheet: '#121212', key: '#BDBDBD', key2: '#9A9A9A',
      home: '#FFFFFF', away: '#7A7A7A', awayDeep: '#A8A8A8',
      homeOnKey: '#000000', awayOnKey: '#404040',
      builtUp: '#1A1A1A', green: '#1F1F1F', water: '#262626', waterEdge: '#555555',
    },
  },
  parchment: {
    name: 'Parchment',
    note: 'Vermilion over slate blue on warm paper. In the dark, amber over teal.',
    holdsFor: [],
    light: {
      sheet: '#F2E8D5', key: '#2E2218', key2: '#5C4A3A',
      home: '#B8240F', away: '#24657B', awayDeep: '#0F3442',
      homeOnKey: '#FFA794', awayOnKey: '#A5D3DE',
      builtUp: '#E9DCC4', green: '#DCDDB5', water: '#C9D8CF', waterEdge: '#86A9A8',
    },
    dark: {
      sheet: '#211A14', key: '#F0E3CB', key2: '#BBAA90',
      home: '#EDA02C', away: '#2D95A3', awayDeep: '#9ADADB',
      homeOnKey: '#7E3F00', awayOnKey: '#1C5C63',
      builtUp: '#2B231B', green: '#262B19', water: '#1C3033', waterEdge: '#3F6E72',
    },
  },
  blueprint: {
    name: 'Blueprint',
    note: 'Red pencil over drafting blue. In the dark, yellow chalk on blueprint blue.',
    holdsFor: [],
    light: {
      sheet: '#EEF3FA', key: '#0F2350', key2: '#43568A',
      home: '#C2340A', away: '#4353C9', awayDeep: '#1E1D69',
      homeOnKey: '#FFA98A', awayOnKey: '#B5BEFF',
      builtUp: '#E0E7F3', green: '#D7E7E0', water: '#C9D6F2', waterEdge: '#8FA0DE',
    },
    dark: {
      sheet: '#0A2A66', key: '#F4F8FF', key2: '#B9CBEA',
      home: '#FFC233', away: '#5AA5F5', awayDeep: '#C2DFFB',
      homeOnKey: '#7A5200', awayOnKey: '#1E4FA0',
      builtUp: '#10337A', green: '#0E3B70', water: '#0C3F8F', waterEdge: '#4F86D6',
    },
  },
  // Pure black and white ground. Every ink that words are set in reaches 7:1 on the sheet.
  stark: {
    name: 'Stark',
    note: 'Pure black and white, with every ink at 7:1 or better against the sheet. For low vision, or a screen in sunlight.',
    holdsFor: [],
    light: {
      sheet: '#FFFFFF', key: '#000000', key2: '#3A3A3A',
      home: '#B0003A', away: '#0039C6', awayDeep: '#00237A',
      homeOnKey: '#FF9DB5', awayOnKey: '#9DBEFF',
      builtUp: '#EFEFEF', green: '#E1EEDD', water: '#D3E0F7', waterEdge: '#7FA0E6',
    },
    dark: {
      sheet: '#000000', key: '#FFFFFF', key2: '#C8C8C8',
      home: '#FFD60A', away: '#3D95F5', awayDeep: '#BFE0FF',
      homeOnKey: '#7A5F00', awayOnKey: '#0047B3',
      builtUp: '#141414', green: '#0C1F12', water: '#0A2147', waterEdge: '#3A72C4',
    },
  },
};

export interface InkSet {
  readonly id: InkSetId;
  readonly name: string;
  readonly note: string;
  readonly holdsFor: readonly ColourVision[];
  readonly light: Inks;
  readonly dark: Inks;
}

export const DEFAULT_INK_SET: InkSetId = 'classic';

const THEMES: readonly Theme[] = ['light', 'dark'];

/** The sets in the order the menu shows them. */
export const INK_SETS: readonly InkSet[] = (Object.keys(SPECS) as InkSetId[]).map((id) => {
  const spec = SPECS[id];
  const printing = (theme: Theme): Inks => ({ set: id, theme, id: `${id}-${theme}`, ...spec[theme] });
  return { id, name: spec.name, note: spec.note, holdsFor: spec.holdsFor, light: printing('light'), dark: printing('dark') };
});

/** Every printing there is: each set, light and dark. */
export const ALL_INKS: readonly Inks[] = INK_SETS.flatMap((set) => THEMES.map((theme) => set[theme]));

const SETS_BY_ID: ReadonlyMap<string, InkSet> = new Map(INK_SETS.map((set) => [set.id, set]));

export function isInkSetId(value: unknown): value is InkSetId {
  return typeof value === 'string' && SETS_BY_ID.has(value);
}

export function inkSet(id: InkSetId): InkSet {
  return SETS_BY_ID.get(id) as InkSet;
}

/** The same object every time for the same set and theme, so it can be compared by identity. */
export function inksFor(set: InkSetId, theme: Theme): Inks {
  return inkSet(set)[theme];
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'auto') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}
