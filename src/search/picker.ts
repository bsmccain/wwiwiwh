import type { Place } from '../app/types';
import { searchPlaces } from './photon';
import { samePlace } from './place';
import { matchPresets, presetFor, WELL_KNOWN } from './presets';
import { recentPlaces, rememberPlace } from './recent';
import { createPhotonMemory, type RemoteState } from './remote-search';
import { openSearchPicker, type RowLook, type SearchPicker, type Section, type Standing } from './search-picker';

export interface PlacePickerOptions {
  role: 'home' | 'away';
  /**
   * The control the picker belongs to, normally a legend row in the collar. Focus returns to it on close,
   * and a press on it is left to the caller, so that it can toggle. On wide screens the popover lines up
   * with its left edge and rises above it, or above its closest ancestor marked `data-picker-edge` (the
   * collar) so that neither legend row is covered.
   */
  anchor: HTMLElement;
  /** The place this role holds now; its row is marked. */
  current: Place;
  /** The place the other role holds; its row cannot be picked here (that is what Swap is for). */
  other: Place;
  /** Called when a place is chosen, with the page already back in reach; the picker closes straight after. */
  onPick(place: Place): void;
  /** Called exactly once, however the picker closes. */
  onClose(): void;
}

/** A picker that is open: the place picker, or one of the spot pickers that share its looks. */
export type PlacePicker = SearchPicker;

const HEADINGS = {
  home: { lead: 'Home:', rest: 'the place you know by heart' },
  away: { lead: 'Away:', rest: "the place you're curious about" },
} as const;
const PLACEHOLDER = 'Search a city, town or neighbourhood';
const UNAVAILABLE = "Search isn't answering right now. Pick a well-known place below, or try again.";
const noMatch = (query: string): string =>
  `No place matches “${query}”. Check the spelling or try a nearby city.`;
const PRESET_MATCHES_SHOWN = 5;

interface Row {
  readonly place: Place;
  readonly standing: Standing;
  /** Why the row is here or what is special about it, shown at its right end. */
  readonly note?: string;
}

/** Answers outlive one opening of the picker, so that looking again costs the server nothing. */
const placeAnswers = createPhotonMemory<Place[]>();

function lookOf({ place, standing, note }: Row): RowLook {
  const { id, name, context, center } = place;
  const key = [id ?? '', name, context, center.lat, center.lng].join('|');
  return { key, name, context, standing, ...(note === undefined ? {} : { note }) };
}

/**
 * Opens the place picker for one role: a popover rising from the anchor where there is room, a bottom
 * sheet on phones, upright or on their side. Only one picker is open at a time; opening another
 * closes the first.
 */
export function openPlacePicker(options: PlacePickerOptions): PlacePicker {
  const { role, current, other } = options;
  const toRow = (place: Place, via?: string): Row => {
    if (samePlace(place, current)) return { place, standing: 'current', note: 'Current' };
    if (samePlace(place, other)) return { place, standing: 'taken', note: 'Already the other place' };
    return via === undefined ? { place, standing: 'free' } : { place, standing: 'free', note: `Matches ${via}` };
  };

  const wellKnownBeyond = (listed: readonly Place[]): Row[] =>
    WELL_KNOWN.filter((place) => !listed.some((shown) => samePlace(shown, place))).map((place) => toRow(place));

  const answers = (query: string, state: RemoteState<Place[]>): Section<Row>[] => {
    const presets = matchPresets(query, PRESET_MATCHES_SHOWN);
    const listed = presets.map((match) => match.place);
    const rows = presets.map((match) => toRow(match.place, match.via));
    if (state.status === 'done') {
      for (const found of state.answer) {
        // A hit that is really one of the presets is shown as the preset, with its curated centre.
        const place = presetFor(found) ?? found;
        if (listed.some((shown) => samePlace(shown, place))) continue;
        listed.push(place);
        rows.push(toRow(place));
      }
    }
    return state.status === 'unavailable'
      ? [{ rows }, { label: 'Well-known places', rows: wellKnownBeyond(listed), offered: true }]
      : [{ rows }];
  };

  return openSearchPicker<Row, Place[]>({
    anchor: options.anchor,
    heading: { ink: role, ...HEADINGS[role] },
    placeholder: PLACEHOLDER,
    rowsAre: { list: 'Places', one: 'place', many: 'places' },
    unavailable: UNAVAILABLE,
    noMatch,
    // Read afresh each time the list is drawn, so that what another tab cleared goes from here too.
    browse: () => {
      const recent = recentPlaces();
      return [
        { label: 'Recent', rows: recent.map((place) => toRow(place)) },
        { label: 'Well-known places', rows: wellKnownBeyond(recent) },
      ];
    },
    remote: { search: searchPlaces, memory: placeAnswers },
    answers,
    look: lookOf,
    onPick(row) {
      rememberPlace(row.place);
      options.onPick(row.place);
    },
    onClose: () => options.onClose(),
  });
}
