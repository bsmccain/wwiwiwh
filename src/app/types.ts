import type { Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { Units } from '../geo/units';

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

/** The Away camera. Away is always north-up, so centre and zoom are the whole camera. */
export interface View {
  readonly center: LngLat;
  readonly zoom: number;
}

/**
 * browse  : dragging moves both maps together (the default).
 * slide   : dragging slides Home on its own; the pin jumps to wherever Home is grabbed.
 * measure : the next two taps draw a trip line.
 */
export type Mode = 'browse' | 'slide' | 'measure';

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
  readonly rings: boolean;
}

export interface AppState extends LinkState {
  // --- this session only ---
  readonly mode: Mode;
  /** While measuring: the first end already placed (Home coordinates), or null. */
  readonly tripDraft: LngLat | null;
  readonly homeHidden: boolean;
  // --- the viewer's own preferences (localStorage, never in the link) ---
  readonly units: Units;
  readonly themeChoice: ThemeChoice;
  /** The theme actually in effect (themeChoice resolved against the system setting). */
  readonly theme: Theme;
  /** Whether single-letter keyboard shortcuts (S, M, X ...) are listened for. */
  readonly shortcutsOn: boolean;
  /** The one-time hint about sliding Home has been seen or made redundant. */
  readonly slideHintDone: boolean;
}
