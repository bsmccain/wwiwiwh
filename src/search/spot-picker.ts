import type { Place } from '../app/types';
import type { LngLat } from '../geo/types';
import { type BothSheets, shareBetweenSheets } from './both-sheets';
import type { PlacePicker } from './picker';
import { recentSpotsNear, rememberSpot } from './recent-spots';
import { createPhotonMemory } from './remote-search';
import { type Ink, openSearchPicker, type RowLook, type Section } from './search-picker';
import { searchSpots, searchSpotsInBoth, SPOT_SEARCH_MANNERS, type SpotHit } from './spots';

export interface SpotPickerOptions {
  /** Which end of the pin is being chosen: the spot of Home that goes under it, or the spot of Away it is put on. */
  sheet: 'home' | 'away';
  /** The place the spot is looked for in and around. */
  place: Place;
  /**
   * How the other end of the pin reads now, for the line under the heading: words that can follow "on"
   * and can begin a sentence ("central London", "10 Downing Street", "a spot near Watford"). Null
   * when it cannot be described.
   */
  otherSpot: string | null;
  /** The control the picker belongs to; see `PlacePickerOptions.anchor`. */
  anchor: HTMLElement;
  /** Called when a spot is chosen; the picker closes straight after. The place's centre has no name of its own. */
  onPick(spot: { name: string | null; position: LngLat }): void;
  /** Called exactly once, however the picker closes. */
  onClose(): void;
}

export interface TripTargetPickerOptions {
  home: Place;
  away: Place;
  /** Positions the line cannot go to (it would start there): rows within 30 m of one are left out. */
  skip?: { home?: readonly LngLat[]; away?: readonly LngLat[] };
  /** False when the line starts from a spot the person clicked while measuring rather than from the pin. True when left out. */
  fromPin?: boolean;
  /** The control the picker belongs to; see `PlacePickerOptions.anchor`. */
  anchor: HTMLElement;
  /** Called when a spot is chosen, with the map it was found on; the picker closes straight after. */
  onPick(sheet: 'home' | 'away', spot: { name: string; position: LngLat }): void;
  /** Called exactly once, however the picker closes. */
  onClose(): void;
}

const PLACEHOLDER = 'Address, landmark or neighbourhood';
const ROWS_ARE = { list: 'Spots', one: 'spot', many: 'spots' } as const;
const UNAVAILABLE = "Search isn't answering right now. Try again.";
const ADVICE = 'Check the spelling, or try a street or a landmark.';
const RECENT_SHOWN = 6;

/** A spot as a row shows it: one that was found, or one that was picked before. */
interface ListedSpot {
  readonly name: string;
  readonly context: string;
  readonly position: LngLat;
}

/** A spot in the picker that lists both places: which map it is on matters as much as where it is. */
interface Target {
  readonly sheet: Ink;
  readonly spot: ListedSpot;
}

/** Answers outlive one opening of a picker, so that looking again costs the server nothing. */
const spotAnswers = createPhotonMemory<SpotHit[]>();
const targetAnswers = createPhotonMemory<BothSheets<SpotHit[]>>();

const scopeOf = (place: Place): string => `${place.center.lat},${place.center.lng}`;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `sheet` is the map the row is listed with, where the list holds rows of both. */
function lookOf({ name, context, position }: ListedSpot, sheet?: RowLook['sheet']): RowLook {
  const key = [sheet?.ink ?? '', name, context, position.lat, position.lng].join('|');
  return { key, name, context, ...(sheet ? { sheet } : {}) };
}

function remember({ name, context, position }: ListedSpot): void {
  rememberSpot({ name, context, position });
}

/**
 * Opens the picker for one end of the pin: an address, a landmark or a neighbourhood in or near the
 * place, the place's own centre, or a spot picked before. It looks and behaves as the place picker
 * does, and like it closes any picker that is already open.
 */
export function openSpotPicker(options: SpotPickerOptions): PlacePicker {
  const { sheet, place, otherSpot } = options;
  const copy =
    sheet === 'home'
      ? {
          lead: `Pin which spot of ${place.name}?`,
          line: otherSpot ? `It goes under the pin, on ${otherSpot}.` : 'It goes under the pin.',
        }
      : {
          lead: `Put the pin on which spot of ${place.name}?`,
          line: `${otherSpot ? capitalize(otherSpot) : 'Home'} moves there with it.`,
        };
  /** The one row that is not a spot with a name of its own. */
  const centre: ListedSpot = { name: `The centre of ${place.name}`, context: '', position: place.center };
  const recent = recentSpotsNear(place.center, RECENT_SHOWN);

  return openSearchPicker<ListedSpot, SpotHit[]>({
    anchor: options.anchor,
    heading: { ink: sheet, lead: copy.lead },
    line: copy.line,
    placeholder: PLACEHOLDER,
    rowsAre: ROWS_ARE,
    unavailable: UNAVAILABLE,
    noMatch: (query) => `No spot matches “${query}” in or near ${place.name}. ${ADVICE}`,
    browse: () => [{ rows: [centre] }, { label: 'Recent', rows: recent }],
    remote: {
      ...SPOT_SEARCH_MANNERS,
      search: (query, signal) => searchSpots(query, place.center, signal),
      memory: spotAnswers,
      scope: scopeOf(place),
    },
    answers: (_query, state) => (state.status === 'done' ? [{ rows: state.answer }] : []),
    look: (spot) => lookOf(spot),
    onPick(spot) {
      if (spot === centre) {
        options.onPick({ name: null, position: centre.position });
        return;
      }
      remember(spot);
      options.onPick({ name: spot.name, position: spot.position });
    },
    onClose: () => options.onClose(),
  });
}

/**
 * Opens the picker for where a trip should go: an address or a landmark in or near either place,
 * listed by place, or a spot picked before. The spot the trip starts from is not offered. It looks
 * and behaves as the place picker does.
 */
export function openTripTargetPicker(options: TripTargetPickerOptions): PlacePicker {
  const { home, away, skip, fromPin = true } = options;
  const places: BothSheets<Place> = { home, away };
  const centres: BothSheets<LngLat> = { home: home.center, away: away.center };
  const recent: BothSheets<readonly ListedSpot[]> = {
    home: recentSpotsNear(home.center, RECENT_SHOWN),
    away: recentSpotsNear(away.center, RECENT_SHOWN),
  };

  const listBySheet = (label: (place: Place) => string, spots: BothSheets<readonly ListedSpot[]>): Section<Target>[] => {
    const shown = shareBetweenSheets(spots, centres, skip);
    return (['home', 'away'] as const).map((sheet) => ({
      label: label(places[sheet]),
      rows: shown[sheet].map((spot) => ({ sheet, spot })),
    }));
  };

  return openSearchPicker<Target, BothSheets<SpotHit[]>>({
    anchor: options.anchor,
    heading: { lead: fromPin ? 'Measure from the pin to where?' : 'Measure to where?' },
    line: `An address or landmark in ${home.name} or in ${away.name}.`,
    placeholder: PLACEHOLDER,
    rowsAre: ROWS_ARE,
    unavailable: UNAVAILABLE,
    noMatch: (query, found) =>
      found.home.length + found.away.length > 0
        ? `Everything that matches “${query}” is where the line starts. Try another address or landmark.`
        : `No spot matches “${query}” in or near ${home.name} or ${away.name}. ${ADVICE}`,
    browse: () => listBySheet((place) => `Recent in ${place.name}`, recent),
    remote: {
      ...SPOT_SEARCH_MANNERS,
      async search(query, signal) {
        const [inHome, inAway] = await searchSpotsInBoth(query, [home.center, away.center], signal);
        return { home: inHome, away: inAway };
      },
      memory: targetAnswers,
      scope: `${scopeOf(home)};${scopeOf(away)}`,
    },
    answers: (_query, state) => (state.status === 'done' ? listBySheet((place) => `In ${place.name}`, state.answer) : []),
    look: ({ sheet, spot }) => lookOf(spot, { ink: sheet, place: places[sheet].name }),
    onPick({ sheet, spot }) {
      remember(spot);
      options.onPick(sheet, { name: spot.name, position: spot.position });
    },
    onClose: () => options.onClose(),
  });
}
