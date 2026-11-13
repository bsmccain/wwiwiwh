import type { MapLibreMap } from 'maplibre-gl';
import { clamp } from '../geo/mercator';
import { ZOOM_RANGE } from './contracts';
import { wheelZoomChange } from './engine-math';

/** How long after the last turn of the wheel the view counts as come to rest. MapLibre's own wheel zoom waits as long. */
const REST_MS = 200;

/** Marks the camera moves made here, one per turn of the wheel, so they are not each taken for a view come to rest. */
export const BY_WHEEL_STEP = { wwiwiwhWheelStep: true } as const;

export interface WheelSteps {
  /** True from a turn of the wheel until the view has come to rest after it. */
  isTurning(): boolean;
  /** Something else moved the view since the wheel turned: its coming to rest is no longer the wheel's to report. */
  forget(): void;
  destroy(): void;
}

/**
 * Wheel zoom for people who asked for reduced motion. MapLibre eases every notch of the wheel over
 * 200ms whatever the preference says, so while the preference is on its scroll zoom is switched off
 * and each turn of the wheel zooms the map here, at once, about the pointer as usual. `onRest` is
 * called once the wheel has stopped turning.
 */
export function stepZoomOnWheel(map: MapLibreMap, reducedMotion: MediaQueryList, onRest: () => void): WheelSteps {
  const surface = map.getCanvasContainer();
  let lastTurnAt = -Infinity;
  let rest: ReturnType<typeof setTimeout> | null = null;

  const forget = (): void => {
    if (rest !== null) clearTimeout(rest);
    rest = null;
  };

  const followPreference = (): void => {
    if (reducedMotion.matches) map.scrollZoom.disable();
    else map.scrollZoom.enable();
  };

  const onWheel = (event: WheelEvent): void => {
    if (!reducedMotion.matches) return;
    // Also keeps a pinch on a trackpad (a wheel turn with Ctrl held) from zooming the page.
    event.preventDefault();
    const now = performance.now();
    const zoom = clamp(map.getZoom() + wheelZoomChange(event, now - lastTurnAt), ZOOM_RANGE.min, ZOOM_RANGE.max);
    lastTurnAt = now;
    if (zoom === map.getZoom()) return;

    const box = surface.getBoundingClientRect();
    const around = map.unproject([event.clientX - box.left, event.clientY - box.top]);
    map.zoomTo(zoom, { duration: 0, around }, BY_WHEEL_STEP);
    forget();
    rest = setTimeout(() => {
      rest = null;
      onRest();
    }, REST_MS);
  };

  followPreference();
  reducedMotion.addEventListener('change', followPreference);
  surface.addEventListener('wheel', onWheel, { passive: false });

  return {
    isTurning: () => rest !== null,
    forget,
    destroy() {
      forget();
      reducedMotion.removeEventListener('change', followPreference);
      surface.removeEventListener('wheel', onWheel);
    },
  };
}
