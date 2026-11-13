import { metroToPlace } from '../app/defaults';
import type { Place } from '../app/types';
import { METROS } from '../data/metros';
import { samePlace } from './place';
import { fold } from './text';

/** Shown before anything is typed, in this order; also the tie-break between equally good matches. */
const WELL_KNOWN_IDS: readonly string[] = [
  'san-jose',
  'san-francisco',
  'los-angeles',
  'new-york',
  'chicago',
  'seattle',
  'london',
  'paris',
  'berlin',
  'tokyo',
  'sydney',
  'mexico-city',
];

interface Alias {
  readonly spelling: string;
  readonly folded: string;
}

interface Preset {
  readonly place: Place;
  /** Folded name. */
  readonly name: string;
  readonly aliases: readonly Alias[];
  /** Folded "name context", so "san jose ca" and "paris france" find their place. */
  readonly nameWithContext: string;
  /** Position among the well-known places, or past the end for the rest. */
  readonly prominence: number;
}

const PRESETS: readonly Preset[] = METROS.map((metro) => {
  const wellKnownAt = WELL_KNOWN_IDS.indexOf(metro.id);
  return {
    place: metroToPlace(metro),
    name: fold(metro.name),
    aliases: (metro.aliases ?? []).map((spelling) => ({ spelling, folded: fold(spelling) })),
    nameWithContext: fold(`${metro.name} ${metro.context}`),
    prominence: wellKnownAt === -1 ? WELL_KNOWN_IDS.length : wellKnownAt,
  };
});

export const WELL_KNOWN: readonly Place[] = WELL_KNOWN_IDS.flatMap((id) => {
  const preset = PRESETS.find((candidate) => candidate.place.id === id);
  return preset ? [preset.place] : [];
});

export interface PresetMatch {
  readonly place: Place;
  /**
   * The nickname or member town the query matched ("South Bay", "Palo Alto") when the place's own name
   * did not match, so the row can say why it is listed.
   */
  readonly via?: string;
}

/** Substring matches on one or two letters are noise ("la" is inside Atlanta, Dallas, Portland …). */
const MIN_INSIDE_LENGTH = 3;

interface RankedMatch extends PresetMatch {
  readonly rank: number;
  readonly preset: Preset;
}

function startsAWord(text: string, part: string): boolean {
  return ` ${text}`.includes(` ${part}`);
}

/** An alias is worth naming in the row unless it is plainly the same name: "Greater London", "NYC", "L.A.". */
function saysSomethingNew(alias: Alias, preset: Preset): boolean {
  const isInitialism = /^[\p{Lu}\p{N}.]{2,5}$/u.test(alias.spelling);
  return !isInitialism && !alias.folded.includes(preset.name);
}

/**
 * Ranks one preset against a folded query, lower is better: whole name, whole alias, start of name,
 * start of alias, start of "name context", start of a later word, every query word starting some word
 * of "name context", and last anywhere inside the name or an alias.
 */
function rankPreset(preset: Preset, query: string): RankedMatch | null {
  const queryWords = query.split(' ');
  const stages: readonly { readonly text: (text: string) => boolean; readonly context?: () => boolean }[] = [
    { text: (text) => text === query },
    { text: (text) => text.startsWith(query), context: () => preset.nameWithContext.startsWith(query) },
    {
      text: (text) => startsAWord(text, query),
      context: () => queryWords.every((word) => startsAWord(preset.nameWithContext, word)),
    },
    { text: (text) => query.length >= MIN_INSIDE_LENGTH && text.includes(query) },
  ];
  for (const [index, stage] of stages.entries()) {
    const rank = index * 3;
    if (stage.text(preset.name)) return { place: preset.place, preset, rank };
    const alias = preset.aliases.find((candidate) => stage.text(candidate.folded));
    if (alias) {
      const via = saysSomethingNew(alias, preset) ? { via: alias.spelling } : {};
      return { place: preset.place, preset, rank: rank + 1, ...via };
    }
    if (stage.context?.()) return { place: preset.place, preset, rank: rank + 2 };
  }
  return null;
}

/** Instant local matches over the curated presets, best first. */
export function matchPresets(query: string, limit = 6): PresetMatch[] {
  const folded = fold(query);
  if (!folded) return [];
  return PRESETS.flatMap((preset) => rankPreset(preset, folded) ?? [])
    .sort((a, b) => a.rank - b.rank || a.preset.prominence - b.preset.prominence)
    .slice(0, limit)
    .map(({ place, via }) => (via === undefined ? { place } : { place, via }));
}

export function searchPresets(query: string, limit = 6): Place[] {
  return matchPresets(query, limit).map((match) => match.place);
}

/** The curated preset that a searched place really is (same name, a few kilometres apart at most), if any. */
export function presetFor(place: Place): Place | null {
  return PRESETS.find((preset) => samePlace(preset.place, place))?.place ?? null;
}
