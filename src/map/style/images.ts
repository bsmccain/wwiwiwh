import type { Map as MapLibreMap, StyleImageMetadata } from 'maplibre-gl';
import { INKS } from '../../app/theme';
import type { Theme } from '../../app/types';
import type { Sheet } from '../contracts';

/**
 * Route-number plates. Away's motorway numbers sit in an outlined pill; Home's freeway numbers sit in a
 * solid box of Home ink. Each is one small image that MapLibre stretches around any number
 * (`icon-text-fit`), drawn here in the theme's inks because the styles carry no sprite sheet.
 */
interface Plate {
  /** Size of the unstretched image, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** Space kept between the numerals and the edge of the plate, in CSS pixels. */
  readonly padX: number;
  readonly padY: number;
  readonly draw: (context: CanvasRenderingContext2D, plate: Plate, theme: Theme) => void;
}

const OUTLINE = 1.25;

function roundedRect(context: CanvasRenderingContext2D, inset: number, plate: Plate): void {
  context.beginPath();
  context.roundRect(inset, inset, plate.width - 2 * inset, plate.height - 2 * inset, Math.max(0, plate.radius - inset));
}

const PLATES: Readonly<Record<Sheet, Plate>> = {
  away: {
    width: 22,
    height: 16,
    radius: 8,
    padX: 5.5,
    padY: 2,
    draw(context, plate, theme) {
      const inks = INKS[theme];
      roundedRect(context, OUTLINE / 2, plate);
      context.fillStyle = inks.sheet;
      context.fill();
      context.lineWidth = OUTLINE;
      context.strokeStyle = inks.awayDeep;
      context.stroke();
    },
  },
  home: {
    width: 16,
    height: 16,
    radius: 2,
    padX: 3.5,
    padY: 2,
    draw(context, plate, theme) {
      roundedRect(context, 0, plate);
      context.fillStyle = INKS[theme].home;
      context.fill();
    },
  },
};

const ID_PREFIX = 'mapz-route';
const THEMES: readonly Theme[] = ['light', 'dark'];
const SHEETS: readonly Sheet[] = ['away', 'home'];

/** The image a route-number layer of this sheet and theme asks for. */
export function routeImageId(sheet: Sheet, theme: Theme): string {
  return `${ID_PREFIX}-${sheet}-${theme}`;
}

const KNOWN_IMAGES: ReadonlyMap<string, { sheet: Sheet; theme: Theme }> = new Map(
  SHEETS.flatMap((sheet) => THEMES.map((theme) => [routeImageId(sheet, theme), { sheet, theme }] as const)),
);

/** Image pixels per CSS pixel: whole, so the stretch zones fall on pixel boundaries. */
function imageRatio(): number {
  return Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
}

function addRouteImage(map: MapLibreMap, id: string): void {
  const known = KNOWN_IMAGES.get(id);
  if (!known || map.hasImage(id)) return;
  const plate = PLATES[known.sheet];
  const ratio = imageRatio();
  const canvas = document.createElement('canvas');
  canvas.width = plate.width * ratio;
  canvas.height = plate.height * ratio;
  const context = canvas.getContext('2d');
  if (!context) {
    console.warn(`mapz: no 2D canvas, so route numbers on the ${known.sheet} sheet are drawn without their plate.`);
    return;
  }
  context.scale(ratio, ratio);
  plate.draw(context, plate, known.theme);

  // Only the middle of the plate stretches; the corners (the whole round end of a pill) keep their shape.
  const corner = Math.ceil(plate.radius);
  const middleY = plate.height / 2;
  const metadata: Partial<StyleImageMetadata> = {
    pixelRatio: ratio,
    stretchX: [[corner * ratio, (plate.width - corner) * ratio]],
    stretchY: [[Math.min(corner, middleY - 1) * ratio, Math.max(plate.height - corner, middleY + 1) * ratio]],
    content: [
      plate.padX * ratio,
      plate.padY * ratio,
      (plate.width - plate.padX) * ratio,
      (plate.height - plate.padY) * ratio,
    ],
  };
  map.addImage(id, context.getImageData(0, 0, canvas.width, canvas.height), metadata);
}

/**
 * Makes sure the map has the route-number plate its style asks for. Safe to call after every style
 * load: an image that is already there is left alone.
 *
 * It also installs the map's missing-image resolver, so a plate that a tile asks for before this has
 * run (for instance the other theme's, right after a theme switch) is drawn on demand instead of being
 * reported missing.
 */
export function registerRouteImages(map: MapLibreMap, sheet: Sheet, theme: Theme): void {
  addRouteImage(map, routeImageId(sheet, theme));
  map.setMissingStyleImageResolver((id) => addRouteImage(map, id));
}
