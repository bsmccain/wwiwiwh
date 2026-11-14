import type { Registration } from '../geo/registration';
import type { LngLat, Outline } from '../geo/types';
import type { Units } from '../geo/units';
import type { Sheet } from '../map/contracts';
import type { DrivenRoute } from '../routing/valhalla';

/**
 * Vocabulary used across the app:
 *  - "Home" is the place the person knows by heart. It is the OVERLAY map: line-work drawn on top.
 *  - "Away" is the place they are curious about. It is the BASE map: always north-up, never tilted.
 *  - "the pin" is the one spot where a Home position and an Away position are held together
 *    (`Registration.overlayAnchor` on Home, `Registration.baseAnchor` on Away). Home turns about it and
 *    ground scale is exact there.
 */

export interface Place {
  /** Preset id from `METROS` when this place is one of the curated presets. */
  readonly id?: string;
  readonly name: string;
  /** Disambiguating context such as "California, USA". Empty when unknown. */
  readonly context: string;
  /** The spot locals mean by "the centre". */
  readonly center: LngLat;
}

/**
 * A spot the person named by picking an address or a landmark, kept together with where it is. The
 * name is used only while the thing it named (an end of the pin, where a trip lands) is still at
 * that position; see `nameAt` in spots.ts.
 */
export interface NamedSpot {
  readonly name: string;
  readonly at: LngLat;
}

/** The names given to the two spots the pin holds together: one position on Home, one on Away. */
export interface PinSpots {
  readonly home: NamedSpot | null;
  readonly away: NamedSpot | null;
}

/** A straight line the person knows, stored in HOME coordinates so it rides along when Home is slid or turned. */
export interface Trip {
  readonly from: LngLat;
  readonly to: LngLat;
  /** Names of the two ends on Home when they are known (curated trips, or an address that was picked). */
  readonly fromName?: string;
  readonly toName?: string;
  /**
   * Named spots on AWAY that the two ends lie on, when they are known (the far end was aimed at an
   * address there, or the places were swapped and these were the ends' own names). Each names where
   * its end lands for as long as it still lands there (Home has not been slid or turned since).
   */
  readonly fromLanding?: NamedSpot;
  readonly toLanding?: NamedSpot;
}

/** What the other place is asked about a drive: how far the same time gets there, or the same distance. */
export type DriveMatch = 'time' | 'distance';

/**
 * A drive along real roads on ONE of the two places. Its ends are positions on that place's map and
 * it follows that place's roads, so unlike a trip it does not ride along when Home is slid or turned
 * under Away: only the spot its start lands on, on the other place, moves.
 */
export interface Drive {
  /** The map whose roads it is driven on. */
  readonly on: Sheet;
  readonly from: LngLat;
  readonly to: LngLat;
  /** Names of the two ends when they are known (an address that was picked). */
  readonly fromName?: string;
  readonly toName?: string;
  /** What the reach drawn on the other place is matched to. */
  readonly match: DriveMatch;
}

/** One end of a drive: where it is and, when it was picked by address, what it is called. */
export interface DriveEnd {
  readonly at: LngLat;
  readonly name?: string;
}

/**
 * What the road service has said about the drive.
 *  - finding     : asked, not answered yet.
 *  - no-road     : the two ends are not joined by road, or one of them is nowhere near one.
 *  - too-far     : a longer drive than the service works out.
 *  - unavailable : the service did not answer.
 */
export type RouteFinding =
  | { readonly status: 'finding' }
  | { readonly status: 'found'; readonly route: DrivenRoute }
  | { readonly status: 'no-road' }
  | { readonly status: 'too-far' }
  | { readonly status: 'unavailable' };

/**
 * What the road service has said about how far the drive's time or distance gets on the other place,
 * from the spot the drive's start lands on.
 *  - finding     : being worked out, or waiting for Home to come to rest.
 *  - no-road     : no road is near that spot (it is out at sea, say).
 *  - beyond      : more driving than the service draws a reach for.
 *  - unavailable : the service did not answer.
 */
export type ReachFinding =
  | { readonly status: 'finding' }
  | { readonly status: 'found'; readonly outline: Outline }
  | { readonly status: 'no-road' }
  | { readonly status: 'beyond' }
  | { readonly status: 'unavailable' };

/** The Away camera. Away is always north-up, so centre and zoom are the whole camera. */
export interface View {
  readonly center: LngLat;
  readonly zoom: number;
}

/**
 * browse  : dragging moves both maps together (the default).
 * slide   : dragging slides Home on its own; the pin jumps to wherever Home is grabbed.
 * measure : the next two taps draw a trip line.
 * drive   : the next two taps set the ends of a drive, on the map `driveSide` says.
 */
export type Mode = 'browse' | 'slide' | 'measure' | 'drive';

export type Theme = 'light' | 'dark';
export type ThemeChoice = 'auto' | Theme;

/** Everything a shared link restores. */
export interface LinkState {
  readonly home: Place;
  readonly away: Place;
  readonly reg: Registration;
  /** What the person called the spots under the pin, if they chose them by address. */
  readonly spots: PinSpots;
  /** `null` means "frame it automatically". */
  readonly view: View | null;
  readonly trip: Trip | null;
  /** A drive along the roads of one of the places. There is a trip or a drive, never both. */
  readonly drive: Drive | null;
  readonly rings: boolean;
}

export interface AppState extends LinkState {
  // --- this session only ---
  readonly mode: Mode;
  /** While measuring: the first end already placed (Home coordinates), or null. */
  readonly tripDraft: LngLat | null;
  /** The map the Drive tool puts a drive's ends on. */
  readonly driveSide: Sheet;
  /** While setting a drive: the start already placed (a position on `driveSide`), or null. */
  readonly driveDraft: DriveEnd | null;
  /** What the road service has said about the drive; null without one. Never part of a link: it is asked again. */
  readonly route: RouteFinding | null;
  /** What it has said about the drive's reach on the other place; null until there is a route to match. */
  readonly reach: ReachFinding | null;
  readonly homeHidden: boolean;
  // --- the viewer's own preferences (localStorage, never in the link) ---
  readonly units: Units;
  readonly themeChoice: ThemeChoice;
  /** The theme actually in effect (themeChoice resolved against the system setting). */
  readonly theme: Theme;
  /** The place whose land and water are shaded in (and which lies underneath); the other is drawn as streets only. */
  readonly ground: Sheet;
  /** Whether single-letter keyboard shortcuts (S, M, X ...) are listened for. */
  readonly shortcutsOn: boolean;
  /** The one-time hint about sliding Home has been seen or made redundant. */
  readonly slideHintDone: boolean;
}
