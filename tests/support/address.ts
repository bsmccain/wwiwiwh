import { expect } from '@playwright/test';
import { distanceMeters } from '../../src/geo/distance';
import type { LngLat } from '../../src/geo/types';
import type { WwiwiwhApp } from './app';

/**
 * Reading the link in the address bar (see src/app/url.ts for its parts), and waiting for it to
 * catch up: the app rewrites it a moment after things have stopped changing, and may write a
 * passing state on the way there, so each wait here is for the address to name what is on screen now.
 */

/** A link keeps five decimals of a degree, which is about a metre. */
const SAME_POSITION_METERS = 2;
const CATCH_UP_MS = 10_000;

/** The value of one part of the link, or null when the link does not have it. */
function part(hash: string, key: string): string | null {
  return new RegExp(`[#&]${key}=([^&]*)`).exec(hash)?.[1] ?? null;
}

function position(text: string | undefined): LngLat {
  const [lat, lng] = (text ?? '').split(',').map(Number);
  return { lat: lat ?? NaN, lng: lng ?? NaN };
}

/** Waits until the address names, as `pin=`, the Home and Away spots the pin now holds together. */
export async function expectPinInAddress(app: WwiwiwhApp): Promise<void> {
  await expect(async () => {
    const { reg } = await app.state();
    const [home, away] = (part(await app.hash(), 'pin') ?? '').split('~');
    expect(distanceMeters(position(home), reg.overlayAnchor)).toBeLessThan(SAME_POSITION_METERS);
    expect(distanceMeters(position(away), reg.baseAnchor)).toBeLessThan(SAME_POSITION_METERS);
  }).toPass({ timeout: CATCH_UP_MS });
}

/** Waits until the address names, as `view=`, the view that is now on screen. */
export async function expectViewInAddress(app: WwiwiwhApp): Promise<void> {
  await expect(async () => {
    const { camera } = await app.state();
    const [lat, lng, zoom] = (part(await app.hash(), 'view') ?? '').split(',');
    expect(distanceMeters(position(`${lat},${lng}`), camera.center)).toBeLessThan(SAME_POSITION_METERS);
    expect(Number(zoom)).toBeCloseTo(camera.zoom, 2);
  }).toPass({ timeout: CATCH_UP_MS });
}
