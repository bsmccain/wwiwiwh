import './type-plate.css';
import type { Store } from '../app/store';
import type { AppState } from '../app/types';
import { createTextMeasurer, onFontsLoaded, PLATE_FAMILY } from '../dom/text-width';
import { clamp } from '../geo/mercator';
import { zoomOffset } from '../geo/registration';
import type { LngLat } from '../geo/types';
import type { DualMap, ScreenBox, ScreenPoint, Sheet } from '../map/contracts';
import { LAST_WORLD_RANK, type PlaceCandidate, type PlaceClass } from './candidates';
import { collisionOrder, placeLabels, type Contender, type LabelBox } from './collide';
import {
  classesAtZoom,
  MAX_PER_PATCH,
  namesPerPatch,
  namesWanted,
  rankPlaces,
  type RankedPlace,
  type StageSize,
} from './density';
import { createLabelLayer, HOP_PX, type LabelSpec } from './label-layer';
import { nearestPlace, type NearestPlace } from './nearest';
import { createPlaceReader } from './place-reader';

export type { NearestPlace } from './nearest';

export interface TypePlateOptions {
  container: HTMLElement;
  dual: DualMap;
  store: Store<AppState>;
  /**
   * Stage boxes no name may lie on (the pin, the trip's plaque and ends, ring labels, the turn knob).
   * Asked on every map frame and after every change to the app's state, so it must be cheap and must
   * never read layout.
   */
  reserved?: () => readonly ScreenBox[];
}

export interface TypePlate {
  nearestPlace(sheet: Sheet, at: LngLat): NearestPlace | null;
  onPlacesChange(listener: () => void): () => void;
  /**
   * Tells the plate that a reserved box appeared, moved or went away without a map frame or a change
   * to the app's state (the turn knob coming up under the pointer, say).
   */
  reservedChanged(): void;
  destroy(): void;
}

/** How a kind of label is set. Mirrors type-plate.css: change them together. */
interface Lettering {
  readonly weight: number;
  readonly size: number;
  /** Padding left and right of the word inside the label's box. */
  readonly padX: number;
  /** Height of the label's box. */
  readonly height: number;
  /** What is drawn outside the box on every side: a tag's outline, a plain name's halo. */
  readonly bleed: number;
}

const LETTERING: Readonly<Record<Sheet, { readonly city: Lettering; readonly other: Lettering }>> = {
  home: {
    city: { weight: 600, size: 15.5, padX: 5, height: 21, bleed: 1.25 },
    other: { weight: 600, size: 12.5, padX: 5, height: 18, bleed: 1.25 },
  },
  away: {
    city: { weight: 600, size: 15.5, padX: 0, height: 15.5, bleed: 2 },
    other: { weight: 500, size: 12.5, padX: 0, height: 12.5, bleed: 2 },
  },
};

/** Clear space kept between any two labels, and between a label and a reserved box. */
const LABEL_GAP_PX = 4;
/** The furthest a label is moved off its place to get out of the way of another name. */
const MAX_SHIFT_PX = 40;
/**
 * The furthest it is moved when a reserved box lies on its place. The names of the two places that
 * meet under the pin are what the picture is about: both must find room beside the pin, one under
 * the other when a ring label has taken the spot above it.
 */
const MAX_SHIFT_OFF_RESERVED_PX = 72;
/** Labels are laid out this far beyond the stage, so they are already in place when panned into view. */
const STAGE_MARGIN_PX = 96;
/** The collision pass runs at most this often while the maps move. */
const PASS_INTERVAL_MS = 150;

/** The places of a sheet in lettering order, kept until its places, the zoom band or the zoom level change. */
interface Ranking {
  readonly live: readonly PlaceCandidate[];
  readonly classes: ReadonlySet<PlaceClass>;
  readonly level: number;
  readonly ranked: readonly RankedPlace[];
}

/** How thinly a sheet is lettered. */
interface Density {
  /** The zoom level whose patches the count is for. */
  readonly level: number;
  /** Names lettered per patch of ground. */
  readonly perPatch: number;
  /** Picked with all of the sheet's places in hand. Until then it is a stopgap, picked anew at every chance. */
  readonly firm: boolean;
}

/** What one sheet brings to a collision pass. */
interface SheetPlan {
  readonly sheet: Sheet;
  readonly ranked: readonly RankedPlace[];
  /** Stage positions already worked out in this pass. */
  readonly points: ReadonlyMap<PlaceCandidate, ScreenPoint>;
  readonly perPatch: number;
  /** The places of a part of the world new to the sheet have just become complete. */
  readonly newlyComplete: boolean;
}

/** A place that asks for a label in one collision pass. */
interface PlateContender extends Contender {
  readonly label: Omit<LabelSpec, 'shift'>;
  readonly box: LabelBox;
}

/**
 * Letters the place names of both sheets on one plate above the two map canvases.
 *
 * MapLibre cannot keep the labels of two maps out of each other's way, and Away's names would be
 * struck through by Home's line-work. So every place name is a DOM element here, and one collision
 * pass decides for both sheets which names are shown.
 *
 * The plate fills `container`, which the caller stacks at the same size above the map pair and above
 * whatever else is drawn over the maps: a ring or a trip line passes under the names. What must not
 * be covered by a name is given as `reserved` boxes. Destroy the plate before the pair.
 */
export function createTypePlate(options: TypePlateOptions): TypePlate {
  const { dual, store } = options;
  const reserved = options.reserved ?? (() => []);

  const root = document.createElement('div');
  root.className = 'mapz-plate';
  // The names are lettering on a picture. What they say reaches assistive technology through the
  // readouts built on `nearestPlace`.
  root.setAttribute('aria-hidden', 'true');
  options.container.append(root);

  const fontOf = (lettering: Lettering): string => `${lettering.weight} ${lettering.size}px ${PLATE_FAMILY}`;
  const measurer = createTextMeasurer();
  const layer = createLabelLayer(root, dual);

  const rankings: Partial<Record<Sheet, Ranking>> = {};
  const densityInUse: Partial<Record<Sheet, Density>> = {};
  /** The generation of each sheet's places that has been laid out from nothing once complete. */
  const laidOut: Partial<Record<Sheet, number>> = {};
  let passTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPassAt = -Infinity;
  /** A slide or turn of Home is in progress. */
  let homeHeld = false;
  /** When set, the next pass treats no label as already on show. */
  let startAfresh = false;
  let destroyed = false;

  /** While this holds, the picture is in flux and the plate changes as little as it can. */
  const isMoving = (): boolean => homeHeld || dual.isMoving();

  const reader = createPlaceReader({ dual, isMoving, onRead: requestPass });

  // --- the collision pass ---

  function rankingOf(sheet: Sheet, sheetZoom: number, awayZoom: number): readonly RankedPlace[] {
    const live = reader.books[sheet].live;
    const classes = classesAtZoom(awayZoom);
    const level = Math.floor(sheetZoom);
    const kept = rankings[sheet];
    if (kept && kept.live === live && kept.classes === classes && kept.level === level) return kept.ranked;
    const ranked = rankPlaces(live, awayZoom, sheetZoom).filter(({ standing }) => standing <= MAX_PER_PATCH);
    rankings[sheet] = { live, classes, level, ranked };
    return ranked;
  }

  function project(sheet: Sheet, place: PlaceCandidate): ScreenPoint {
    return sheet === 'home' ? dual.projectHome(place.position) : dual.projectAway(place.position);
  }

  /** Decides how thinly a sheet is lettered in this pass. */
  function planFor(sheet: Sheet, sheetZoom: number, awayZoom: number, stage: StageSize, moving: boolean): SheetPlan {
    const ranked = rankingOf(sheet, sheetZoom, awayZoom);
    const points = new Map<PlaceCandidate, ScreenPoint>();
    const level = Math.floor(sheetZoom);
    // The places in hand are the whole story only at rest, once the tiles are all in and read.
    const sure = !moving && reader.isComplete(sheet);

    let density = densityInUse[sheet];
    if (density && density.level !== level) {
      // One zoom level in, a patch is a quarter of what it was, so a quarter as many names per patch
      // keeps the same names on the stage. That carries the density across until it can be judged.
      const perPatch = clamp(Math.round(density.perPatch * 4 ** (density.level - level)), 1, MAX_PER_PATCH);
      density = { ...density, level, perPatch };
    }
    // The number of names per patch is judged at rest with every place in hand. In motion, or with
    // tiles still coming in, judging it would add or drop a whole layer of names in the middle of the
    // stage on half the facts. Only the very first number, a stopgap, is picked on what there is.
    if (!density || sure || (!moving && !density.firm)) {
      const standingsOnStage: number[] = [];
      for (const { place, standing } of ranked) {
        const point = project(sheet, place);
        points.set(place, point);
        if (point.x >= 0 && point.x <= stage.width && point.y >= 0 && point.y <= stage.height) {
          standingsOnStage.push(standing);
        }
      }
      const inUse = density?.firm ? density.perPatch : undefined;
      density = { level, perPatch: namesPerPatch(standingsOnStage, namesWanted(stage), inUse), firm: sure };
    }
    densityInUse[sheet] = density;

    const generation = reader.books[sheet].generation;
    const newlyComplete = sure && laidOut[sheet] !== generation;
    if (newlyComplete) laidOut[sheet] = generation;
    return { sheet, ranked, points, perPatch: density.perPatch, newlyComplete };
  }

  function contendersOf(plan: SheetPlan, stage: StageSize): PlateContender[] {
    const { sheet } = plan;
    const contenders: PlateContender[] = [];
    for (const { place, standing } of plan.ranked) {
      if (standing > plan.perPatch) continue;
      const point = plan.points.get(place) ?? project(sheet, place);
      const city = place.placeClass === 'city';
      const lettering = LETTERING[sheet][city ? 'city' : 'other'];
      const textWidth = measurer.width(fontOf(lettering), place.name);
      // A tag's box is a whole number of pixels wide, so both its edges are crisp.
      const width = lettering.padX > 0 ? Math.ceil(textWidth) + 2 * lettering.padX : textWidth;
      const reachX = width / 2 + lettering.bleed + STAGE_MARGIN_PX;
      const reachY = lettering.height / 2 + lettering.bleed + STAGE_MARGIN_PX;
      if (point.x < -reachX || point.x > stage.width + reachX || point.y < -reachY || point.y > stage.height + reachY) {
        continue;
      }
      const key = `${sheet}|${place.id}`;
      const shownAt = layer.shiftOf(key);
      const box = {
        x: point.x,
        y: point.y,
        width: width + 2 * lettering.bleed,
        height: lettering.height + 2 * lettering.bleed,
      };
      contenders.push({
        label: {
          key,
          sheet,
          name: place.name,
          position: place.position,
          city,
          width,
          height: lettering.height,
          bleed: lettering.bleed,
        },
        box: shownAt === undefined ? box : { ...box, shownAt },
        major: place.rank <= LAST_WORLD_RANK,
        shown: shownAt !== undefined && !startAfresh,
      });
    }
    return contenders;
  }

  function runPass(): void {
    if (passTimer !== null) clearTimeout(passTimer);
    passTimer = null;
    lastPassAt = performance.now();
    const stage = dual.getSize();
    if (destroyed || stage.width <= 0 || stage.height <= 0) return;

    const moving = isMoving();
    const awayZoom = dual.getView().zoom;
    const homeZoom = awayZoom + zoomOffset(dual.getRegistration());
    const homePlan = store.get().homeHidden ? null : planFor('home', homeZoom, awayZoom, stage, moving);
    const awayPlan = planFor('away', awayZoom, awayZoom, stage, moving);
    // Names put up while the tiles of a new city were still arriving got their spots in the order the
    // tiles came. Once its places are complete everything is laid out again from nothing, so the
    // picture at rest does not depend on that order.
    if (homePlan?.newlyComplete || awayPlan.newlyComplete) startAfresh = true;
    const order = collisionOrder(homePlan ? contendersOf(homePlan, stage) : [], contendersOf(awayPlan, stage));
    startAfresh = false;

    const shifts = placeLabels(
      order.map((contender) => contender.box),
      reserved(),
      {
        gap: LABEL_GAP_PX,
        maxShift: MAX_SHIFT_PX,
        maxShiftOffReserved: MAX_SHIFT_OFF_RESERVED_PX,
        ...(moving ? { creep: HOP_PX } : {}),
      },
    );
    const labels: LabelSpec[] = [];
    order.forEach((contender, index) => {
      const shift = shifts[index];
      if (shift !== null && shift !== undefined) labels.push({ ...contender.label, shift });
    });
    layer.show(labels);
  }

  /** Asks for a collision pass soon: at once after a quiet spell, otherwise when the interval is up. */
  function requestPass(): void {
    if (passTimer !== null || destroyed) return;
    const wait = Math.max(0, PASS_INTERVAL_MS - (performance.now() - lastPassAt));
    passTimer = setTimeout(runPass, wait);
  }

  /**
   * Takes off at once any name a reserved box has come to lie on, in motion as at rest: the names
   * are drawn above the pin and its kin, so a name left there until the next pass would cover them.
   * That pass then finds the name another spot, or leaves it off.
   */
  function keepReservedClear(): void {
    layer.hideOn(reserved());
    requestPass();
  }

  // --- wiring ---

  /** Widths measured before a font arrived were those of its stand-in. */
  function onFontsChanged(): void {
    measurer.reset();
    requestPass();
  }
  for (const lettering of [LETTERING.home.other, LETTERING.away.other]) {
    void document.fonts.load(fontOf(lettering)).then(onFontsChanged, () => undefined);
  }

  const unsubscribe = [
    dual.on('frame', () => {
      layer.follow();
      keepReservedClear();
    }),
    dual.on('idle', () => {
      // With tiles still to be read the pass waits for them: the reader asks for it when it is done.
      if (reader.readAtIdle()) runPass();
    }),
    // The camera has come to rest, perhaps long before the last tile is in: time to settle the plate.
    dual.on('viewchange', requestPass),
    dual.on('gesture', ({ phase }) => {
      homeHeld = phase === 'start';
      if (!homeHeld) requestPass();
    }),
    // Anything in the app's state may move a reserved box (a new trip, other units on its plaque).
    store.subscribe(keepReservedClear),
    store.select(
      (state) => state.homeHidden,
      () => {
        // With Home out of the picture Away is lettered as if alone; when Home returns, both start level.
        startAfresh = true;
        runPass();
      },
    ),
    onFontsLoaded(onFontsChanged),
  ];

  // The pair may already be showing tiles: letter what is there without waiting for the next frame.
  runPass();

  return {
    nearestPlace: (sheet, at) => nearestPlace(reader.books[sheet].all(), at),
    onPlacesChange: (listener) => reader.onChange(listener),
    reservedChanged: keepReservedClear,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const stop of unsubscribe) stop();
      if (passTimer !== null) clearTimeout(passTimer);
      reader.destroy();
      layer.destroy();
      root.remove();
    },
  };
}
