import type { Controller } from '../app/controller';
import { createScaleBar } from '../instruments/scale-bar';
import type { DualMap } from '../map/contracts';
import type { Layout } from './layout';

/** The bar scale drawn on the map (where the collar has no room for it) is at most this wide, lettering included. */
const MAP_SCALE_ROOM_PX = 170;

const SCALE_NOTE = {
  /** The pin is in view: its scale is the one both maps share. */
  atPin: 'Both maps are drawn at this scale',
  /** The pin is out of view, where its scale no longer describes what is on screen. */
  atCenter: 'Scale at the middle of this view',
} as const;

/**
 * Draws the two-unit bar scale and keeps it true: in the collar where that has room for it,
 * otherwise on the map. While the pin is on the stage the bar shows the ground scale at the pin,
 * where the two maps match. Once the pin has left the stage that scale describes neither map on
 * screen, so the bar shows the scale at the middle of the view instead, and the collar says so.
 */
export function placeScaleBars(deps: {
  dual: DualMap;
  controller: Pick<Controller, 'pinIsOnStage'>;
  layout: Layout;
  collarHost: HTMLElement;
  mapHost: HTMLElement;
  /** Receives the line that goes under the collar's bar. */
  setNote: (text: string) => void;
}): void {
  const { dual, controller, layout, collarHost } = deps;
  const collarScale = createScaleBar(collarHost);
  const mapScale = createScaleBar(deps.mapHost);
  let collarRoom = collarHost.clientWidth;
  let noted: string | null = null;

  // Runs inside every map frame, so it writes to the page only when something has changed.
  const draw = (): void => {
    const pinInView = controller.pinIsOnStage();
    const metersPerPixel = dual.metersPerPixel(pinInView ? dual.getRegistration().baseAnchor : undefined);
    if (layout.collarIsFull()) collarScale.update(metersPerPixel, collarRoom);
    else mapScale.update(metersPerPixel, MAP_SCALE_ROOM_PX);
    const note = pinInView ? SCALE_NOTE.atPin : SCALE_NOTE.atCenter;
    if (note !== noted) {
      noted = note;
      deps.setNote(note);
    }
  };

  // The room is measured when the collar is laid out, never inside a map frame.
  new ResizeObserver(() => {
    collarRoom = collarHost.clientWidth;
    draw();
  }).observe(collarHost);
  dual.on('frame', draw);
  layout.onChange(draw);
  // The pair fires no frame until something moves.
  draw();
}
