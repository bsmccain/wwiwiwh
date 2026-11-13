import { fromMercator, metersPerPixel, toMercator } from '../../geo/mercator';
import { baseToOverlay, overlayToBase, type Registration } from '../../geo/registration';
import type { LngLat } from '../../geo/types';
import type { DualMap, DualMapEvents, FitOptions, MapHealth, MapStyles, MoveOptions, ScreenPoint } from '../../map/contracts';
import type { View } from '../types';

type Listener<K extends keyof DualMapEvents> = (event: DualMapEvents[K]) => void;

/**
 * A stand-in for the real map pair in unit tests: the same camera and registration bookkeeping and
 * the same Mercator projection, with no WebGL and no tiles.
 */
export class FakeDualMap implements DualMap {
  readonly base = null as never;
  readonly overlay = null as never;
  view: View;
  registration: Registration;
  size = { width: 1440, height: 800 };
  slideMode = false;
  measureMode = false;
  homeHidden = false;
  health: MapHealth = { state: 'ok', sheets: [] };
  styles: MapStyles | null = null;
  readonly calls: string[] = [];
  private readonly listeners: { [K in keyof DualMapEvents]?: Set<Listener<K>> } = {};

  constructor(view: View, registration: Registration) {
    this.view = view;
    this.registration = registration;
  }

  emit<K extends keyof DualMapEvents>(type: K, event: DualMapEvents[K]): void {
    for (const listener of this.listeners[type] ?? []) (listener as Listener<K>)(event);
  }

  getSize() {
    return this.size;
  }
  getView() {
    return this.view;
  }
  setView(view: View, options?: MoveOptions) {
    this.calls.push('setView');
    this.view = view;
    this.emit('frame', undefined);
    this.emit('viewchange', { view, byUser: options?.asUser ?? false });
  }
  isMoving() {
    return false;
  }
  /** Simulates the person dragging or zooming the map. */
  userMoves(view: View) {
    this.view = view;
    this.emit('frame', undefined);
    this.emit('viewchange', { view, byUser: true });
  }
  fit(points: readonly LngLat[], options?: FitOptions) {
    this.calls.push('fit');
    const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
    this.view = { center: { lat, lng }, zoom: options?.maxZoom ?? 10 };
    this.emit('frame', undefined);
    this.emit('viewchange', { view: this.view, byUser: options?.asUser ?? false });
  }
  zoomBy(delta: number, options?: MoveOptions) {
    this.setView({ ...this.view, zoom: this.view.zoom + delta }, options);
  }
  panBy(dx: number, dy: number, options?: MoveOptions) {
    const { width, height } = this.size;
    this.setView({ ...this.view, center: this.unprojectAway({ x: width / 2 + dx, y: height / 2 + dy }) }, options);
  }
  getRegistration() {
    return this.registration;
  }
  setRegistration(registration: Registration, options?: { final?: boolean }) {
    this.registration = registration;
    // The same order as the real pair: who changed first, then the redraw.
    this.emit('registrationchange', { registration, final: options?.final ?? true });
    this.emit('frame', undefined);
  }
  claimClick() {
    this.calls.push('claimClick');
  }
  setSlideMode(on: boolean) {
    this.slideMode = on;
  }
  setMeasureMode(on: boolean) {
    this.measureMode = on;
  }
  setHomeHidden(hidden: boolean) {
    this.homeHidden = hidden;
  }
  passWheel() {}
  getHealth() {
    return this.health;
  }
  retry() {
    this.calls.push('retry');
  }
  setStyles(styles: MapStyles) {
    this.styles = styles;
  }
  private get pixelsPerUnit() {
    return 512 * 2 ** this.view.zoom;
  }
  projectAway(position: LngLat): ScreenPoint {
    const c = toMercator(this.view.center);
    const p = toMercator(position);
    return {
      x: (p.x - c.x) * this.pixelsPerUnit + this.size.width / 2,
      y: (p.y - c.y) * this.pixelsPerUnit + this.size.height / 2,
    };
  }
  projectHome(position: LngLat): ScreenPoint {
    return this.projectAway(overlayToBase(this.registration, position));
  }
  unprojectAway(point: ScreenPoint): LngLat {
    const c = toMercator(this.view.center);
    return fromMercator({
      x: c.x + (point.x - this.size.width / 2) / this.pixelsPerUnit,
      y: c.y + (point.y - this.size.height / 2) / this.pixelsPerUnit,
    });
  }
  unprojectHome(point: ScreenPoint): LngLat {
    return baseToOverlay(this.registration, this.unprojectAway(point));
  }
  metersPerPixel(at?: LngLat) {
    return metersPerPixel((at ?? this.view.center).lat, this.view.zoom);
  }
  on<K extends keyof DualMapEvents>(type: K, listener: Listener<K>): () => void {
    const set = (this.listeners[type] ??= new Set() as never) as Set<Listener<K>>;
    set.add(listener);
    return () => set.delete(listener);
  }
  resize() {}
  destroy() {}
}
