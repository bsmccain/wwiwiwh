import type { LayerSpecification } from 'maplibre-gl';

/** MapLibre accepts layer zoom limits in this range only. */
const MIN_LAYER_ZOOM = 0;
const MAX_LAYER_ZOOM = 24;

const INTERPOLATIONS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab']);

/** Keeps shifted stops free of floating-point dust (10.4 + 0.35 would otherwise read 10.750000000000002). */
function tidy(zoom: number): number {
  return Math.round(zoom * 1000) / 1000;
}

function isZoomInput(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom';
}

function shiftStops(expression: readonly unknown[], firstStop: number, by: number): unknown[] {
  return expression.map((part, index) => {
    if (index < firstStop) return part;
    const isStop = (index - firstStop) % 2 === 0;
    return isStop && typeof part === 'number' ? tidy(part + by) : shiftZoomStops(part, by);
  });
}

/**
 * Moves every zoom stop inside a style value by `by` zoom levels, however deeply the zoom curve is
 * nested. A value written as "2.7 px at zoom 9.5" becomes "2.7 px at zoom 9.5 + by".
 *
 * Only `interpolate*` and `step` expressions whose input is `["zoom"]` are touched; data-driven curves
 * keep their stops. Anything that is not an expression is returned as it is.
 */
export function shiftZoomStops<T>(value: T, by: number): T {
  if (!Array.isArray(value)) return value;
  const [operator] = value;
  // A literal holds plain data (a dash pattern, a font stack), never a zoom curve.
  if (operator === 'literal') return value;
  if (INTERPOLATIONS.has(operator) && isZoomInput(value[2])) return shiftStops(value, 3, by) as T;
  // ["step", input, base output, stop, output, ...]: the first stop comes after the base output.
  if (operator === 'step' && isZoomInput(value[1])) {
    const shifted = shiftStops(value, 3, by);
    shifted[2] = shiftZoomStops(value[2], by);
    return shifted as T;
  }
  return value.map((part) => shiftZoomStops(part, by)) as T;
}

function shiftProperties<T extends object>(properties: T, by: number): T {
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, shiftZoomStops(value, by)])) as T;
}

function clampLayerZoom(zoom: number): number {
  return Math.min(MAX_LAYER_ZOOM, Math.max(MIN_LAYER_ZOOM, tidy(zoom)));
}

/**
 * Re-expresses a layer written for one map's zoom in another map's zoom: its zoom range and every
 * zoom stop in its paint and layout move by `by` levels. Filters are left alone (MapLibre evaluates
 * zoom in filters at whole zooms only, so the styles never put zoom there).
 */
export function shiftLayerZoom<L extends LayerSpecification>(layer: L, by: number): L {
  const shifted: L = { ...layer };
  if (layer.minzoom !== undefined) shifted.minzoom = clampLayerZoom(layer.minzoom + by);
  if (layer.maxzoom !== undefined) shifted.maxzoom = clampLayerZoom(layer.maxzoom + by);
  if (layer.paint) shifted.paint = shiftProperties(layer.paint, by);
  if (layer.layout) shifted.layout = shiftProperties(layer.layout, by);
  return shifted;
}
