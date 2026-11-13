import { distanceMeters } from '../geo/distance';
import { baseToOverlay, overlayToBase, type Registration } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { Sheet } from '../map/contracts';
import type { DrivenRoute, ReachLimit } from '../routing/valhalla';
import type { AppState, Drive, DriveEnd, DriveMatch } from './types';

/*
 * A drive, apart from asking the road service about it: how its ends are put down, where it lies on
 * the other map, and how much driving its reach there is drawn for. Pure functions, shared by the
 * controller, the instruments and the runner that does the asking.
 */

/** A drive shorter than this, in metres, is no drive at all (its two ends were the same spot). */
export const SHORTEST_DRIVE_METERS = 10;
/** What the other place is asked about until the person says otherwise: time is what a drive costs. */
export const DEFAULT_MATCH: DriveMatch = 'time';
/** A reach follows the roads this closely, as a share of the drive's length: a longer drive is drawn from further out. */
const REACH_DETAIL_SHARE = 1 / 200;

export function otherSheet(sheet: Sheet): Sheet {
  return sheet === 'home' ? 'away' : 'home';
}

/** Where a position on one map lies on the other: the spot drawn at the same point of the stage. */
export function onOtherSheet(registration: Registration, sheet: Sheet, at: LngLat): LngLat {
  return sheet === 'home' ? overlayToBase(registration, at) : baseToOverlay(registration, at);
}

/** A position on either map as an Away position, which is what the camera is aimed with. */
export function onAway(registration: Registration, sheet: Sheet, at: LngLat): LngLat {
  return sheet === 'home' ? overlayToBase(registration, at) : at;
}

/** The two ends of a drive as Away positions; none without a drive. */
export function driveOnAway(drive: Drive | null, registration: Registration): LngLat[] {
  return drive ? [onAway(registration, drive.on, drive.from), onAway(registration, drive.on, drive.to)] : [];
}

/** The drive between two ends on one map, or null when they are the same spot. */
export function driveBetween(on: Sheet, from: DriveEnd, to: DriveEnd, match: DriveMatch): Drive | null {
  if (distanceMeters(from.at, to.at) < SHORTEST_DRIVE_METERS) return null;
  return {
    on,
    from: from.at,
    to: to.at,
    ...(from.name ? { fromName: from.name } : {}),
    ...(to.name ? { toName: to.name } : {}),
    match,
  };
}

/**
 * What changes when a drive is set: it takes the place of any straight line (there is one journey
 * on the map at a time), and setting it is finished.
 */
export function startDrive(drive: Drive): Pick<AppState, 'drive' | 'trip' | 'tripDraft' | 'driveSide' | 'driveDraft' | 'mode'> {
  return { drive, trip: null, tripDraft: null, driveSide: drive.on, driveDraft: null, mode: 'browse' };
}

/**
 * What a press on the map does while a drive is being set: the first puts down its start, the
 * second its end. Null when the press changes nothing (the end would lie on the start).
 */
export function placeDriveEnd(state: Pick<AppState, 'drive' | 'driveSide' | 'driveDraft'>, end: DriveEnd): Partial<AppState> | null {
  if (!state.driveDraft) return { driveDraft: end };
  const drive = driveBetween(state.driveSide, state.driveDraft, end, state.drive?.match ?? DEFAULT_MATCH);
  return drive ? startDrive(drive) : null;
}

/** How much driving the reach on the other place is drawn for: as long as the route takes, or as far as it goes. */
export function reachLimitOf(route: DrivenRoute, match: DriveMatch): ReachLimit {
  return match === 'time' ? { by: 'time', minutes: route.seconds / 60 } : { by: 'distance', kilometres: route.meters / 1000 };
}

/** How closely the reach of a route is asked to follow the roads, in metres. */
export function reachDetailMeters(route: DrivenRoute): number {
  return route.meters * REACH_DETAIL_SHARE;
}
