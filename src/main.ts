import './styles/base.css';
import './ui/app.css';
import './styles/ink-sets.css';
import { createController, FRAMING_ZOOM, NARROW_STAGE_PX, type Controller } from './app/controller';
import { browserAddressBar, createLinkSync } from './app/link-sync';
import { loadPrefs } from './app/prefs';
import { pageTitle } from './app/readout';
import { createStore, type Store } from './app/store';
import { inksFor, resolveTheme, type Inks } from './app/theme';
import type { AppState } from './app/types';
import { decodeLink } from './app/url';
import { DRAG_END_EVENT, DRAG_START_EVENT } from './instruments/drag';
import { createInstruments, type Instruments } from './instruments/instruments';
import { createTypePlate, type TypePlate } from './labels/type-plate';
import { ZOOM_RANGE, type DualMap } from './map/contracts';
import { createDualMap, MapUnavailableError } from './map/engine';
import { createStyles } from './map/style';
import { createAnnouncer } from './ui/announcer';
import { createCaptioner, SPOKEN_CHANNELS, type Captioner, type SpokenChannel } from './ui/captioner';
import { createCollar } from './ui/collar';
import { runCommand } from './ui/commands';
import { createAboutDialog, createShortcutsDialog } from './ui/dialogs';
import { el } from './ui/dom';
import { offerSlideHint } from './ui/hint';
import { watchInput } from './ui/input-mode';
import { bindKeyboard } from './ui/keyboard';
import { createLayout } from './ui/layout';
import { keepStatusNote } from './ui/map-status';
import { openMoreMenu, type MoreMenu, type MoreMenuOptions } from './ui/more-menu';
import { startWithoutMaps } from './ui/no-maps';
import { createOverlays } from './ui/overlays';
import { createPinAddress, type PinAddress } from './ui/pin-address';
import { createReadouts } from './ui/readouts';
import { placeScaleBars } from './ui/scale-bars';
import { createStage } from './ui/stage';
import { createToasts } from './ui/toasts';

declare global {
  interface Window {
    /** The running app, for end-to-end tests. */
    __wwiwiwh?: { store: Store<AppState>; dual: DualMap; controller: Controller; typePlate: TypePlate; instruments: Instruments };
  }
}

/** Zoom levels closer to a limit than this count as at it. */
const ZOOM_LIMIT_SLACK = 0.001;

function applyInks(inks: Inks): void {
  const root = document.documentElement;
  root.dataset['theme'] = inks.theme;
  root.dataset['inks'] = inks.set;
  // The browser's own chrome continues the sheet, whichever scheme the system is in.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', inks.sheet);
}

function start(root: HTMLElement): void {
  const link = decodeLink(window.location.hash);
  const prefs = loadPrefs(navigator.language);
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = resolveTheme(prefs.themeChoice, systemDark.matches);
  const inks = inksFor(prefs.inkSet, theme);
  // Before anything is drawn, so neither the page nor the maps flash in other colours.
  applyInks(inks);

  const store = createStore<AppState>({
    ...link.state,
    mode: 'browse',
    tripDraft: null,
    driveSide: link.state.drive?.on ?? 'home',
    driveDraft: null,
    route: null,
    reach: null,
    homeHidden: false,
    units: prefs.units,
    themeChoice: prefs.themeChoice,
    theme,
    ground: prefs.ground,
    inkSet: prefs.inkSet,
    shortcutsOn: prefs.shortcutsOn,
    slideHintDone: prefs.slideHintDone,
  });
  const first = store.get();
  // Wherever a swatch of a map's ink is drawn, the tints of land and water go with the place that has the ground.
  const markGround = (ground: AppState['ground']): void => {
    document.documentElement.dataset.ground = ground;
  };
  store.select((s) => s.ground, markGround);
  markGround(first.ground);

  // --- the page around the maps: stage, margin, dialogs, More menu ---

  const layout = createLayout();
  const input = watchInput();
  const overlays = createOverlays();
  const aboutDialog = createAboutDialog({ overlays });
  const shortcutsDialog = createShortcutsDialog({ overlays, singleKeysOn: () => store.get().shortcutsOn });
  const stage = createStage({ onCredit: () => aboutDialog.open() });
  const toasts = createToasts(stage.toastHost);
  // The place picker and the More menu rise from the top edge of the margin (see app.css).
  const margin = el('div', 'margin', { 'data-picker-edge': '' });
  const skipLink = el('a', 'skip-link', { href: '#collar' }, ['Skip to the map key and tools']);
  // A fragment link would rewrite the hash, which holds the shared view, so focus is moved by hand.
  skipLink.addEventListener('click', (event) => {
    event.preventDefault();
    root.querySelector<HTMLElement>('.collar button:not(:disabled)')?.focus();
  });
  root.append(skipLink, stage.element, margin);

  const describePair = (): void => {
    const { home, away } = store.get();
    document.title = pageTitle(home, away);
    stage.setHeading(`${home.name} over ${away.name} at the same scale`);
  };
  store.subscribe((state, previous) => {
    if (state.home !== previous.home || state.away !== previous.away) describePair();
  });
  describePair();

  let menu: MoreMenu | null = null;
  const toggleMenu = (anchor: HTMLElement, actions: MoreMenuOptions['actions'], mapReady: boolean, onPinByAddress: () => void): void => {
    if (menu) {
      menu.close();
      return;
    }
    const closed = overlays.opened(() => menu?.close());
    menu = openMoreMenu({
      anchor,
      store,
      actions,
      mapReady,
      offerShortcuts: mapReady && !layout.touchOnly(),
      byKeyboard: input.mode() === 'keyboard',
      onPinByAddress,
      onShortcuts: () => shortcutsDialog.open(),
      onAbout: () => aboutDialog.open(),
      onRecentNotice: (message) => toasts.show(message),
      onClose: () => {
        menu = null;
        closed();
      },
    });
  };

  // Back and Forward change what is underneath; a sheet or dialog left open would describe the page before.
  for (const type of ['popstate', 'hashchange'] as const) window.addEventListener(type, () => overlays.closeAll());

  // --- the maps, and what is drawn over them ---

  let dual: DualMap;
  try {
    dual = createDualMap({
      container: stage.maps,
      registration: first.reg,
      view: first.view ?? {
        center: first.reg.baseAnchor,
        zoom: stage.element.clientWidth < NARROW_STAGE_PX ? FRAMING_ZOOM.narrow : FRAMING_ZOOM.wide,
      },
      styles: createStyles(inks, prefs.ground),
    });
  } catch (error) {
    if (!(error instanceof MapUnavailableError)) throw error;
    const collar = startWithoutMaps({
      error,
      stage,
      store,
      overlays,
      systemPrefersDark: () => systemDark.matches,
      applyInks,
      openMenu: toggleMenu,
    });
    collar.element.id = 'collar';
    // No caption band to reach up over.
    margin.classList.add('margin--bare');
    margin.append(collar.element);
    return;
  }

  const instruments = createInstruments({ container: stage.instruments, dual, store });
  // After the instruments, so their boxes are laid out before the plate reads them on each frame.
  const typePlate = createTypePlate({
    container: stage.plate,
    dual,
    store,
    reserved: () => {
      const onTheMap = stage.reservedBoxes();
      return onTheMap.length === 0 ? instruments.reservedBoxes() : [...instruments.reservedBoxes(), ...onTheMap];
    },
  });
  instruments.onReservedChange(() => typePlate.reservedChanged());
  stage.onReservedChange(() => typePlate.reservedChanged());

  const controller = createController({
    store,
    dual,
    styles: createStyles,
    systemTheme: {
      prefersDark: () => systemDark.matches,
      onChange(listener) {
        systemDark.addEventListener('change', listener);
        return () => systemDark.removeEventListener('change', listener);
      },
    },
    applyInks,
    pageUrl: () => window.location.href.replace(/#.*$/, ''),
  });

  const mapCanvas = dual.base.getCanvas();
  const nameMap = (): void => {
    const { home, away } = store.get();
    mapCanvas.setAttribute('aria-label', `Map of ${away.name} with ${home.name} laid over it`);
  };
  store.subscribe((state, previous) => {
    if (state.home !== previous.home || state.away !== previous.away) nameMap();
  });
  nameMap();

  stage.offerZoom((delta) => controller.zoomBy(delta));
  const showZoomRoom = (): void => {
    const { zoom } = dual.getView();
    stage.setZoomRoom({ in: zoom < ZOOM_RANGE.max - ZOOM_LIMIT_SLACK, out: zoom > ZOOM_RANGE.min + ZOOM_LIMIT_SLACK });
  };
  dual.on('viewchange', showZoomRoom);
  showZoomRoom();

  const readouts = createReadouts({
    store,
    dual,
    nearest: (sheet, at) => typePlate.nearestPlace(sheet, at),
    onPlacesChange: (listener) => typePlate.onPlacesChange(listener),
  });

  // --- caption and collar ---

  const copyLink = async (): Promise<void> => {
    linkSync.flush();
    const outcome = await controller.shareLink();
    if (outcome === 'copied') toasts.show('Link copied. It opens this exact view.');
    else if (outcome === 'failed') toasts.show("Couldn't copy. The link is in the address bar.", { alert: true });
  };

  const collar = createCollar({
    store,
    actions: controller,
    overlays,
    readouts,
    onCopy: () => void copyLink(),
    onMore() {
      // The pin menu rises from this button too when it is not opened from the pin; pressed again, the button closes it.
      if (!pinAddress.closeMenu()) toggleMenu(collar.share.moreButton, controller, true, () => pinAddress.openMenu('collar'));
    },
    onSpot: (sheet, part) => pinAddress.toggleSpotPicker(sheet, part),
    onLeaveMode: () => captioner.leaveMode(),
  });
  collar.element.id = 'collar';
  const { tools, legend } = collar;

  const knobHasFocus = (): boolean => {
    const focused = document.activeElement;
    return focused !== null && stage.instruments.contains(focused) && focused.getAttribute('role') === 'slider';
  };
  const announcer = createAnnouncer<SpokenChannel>(stage.element, {
    channels: SPOKEN_CHANNELS,
    // The turn knob is a slider: with focus on it, a screen reader reads out each new value itself.
    spokenElsewhere: (channel) => channel === 'turn' && knobHasFocus(),
  });
  let draggingHome = false;
  dual.on('gesture', ({ phase }) => {
    draggingHome = phase === 'start';
    announcer.hold('gesture', draggingHome);
  });
  // A trip end being dragged is no gesture of the map pair, but it rewords the trip all the same.
  // Held for as long as the drag itself, which can end without a release reaching the page (the
  // window loses focus, or the release goes missing).
  stage.instruments.addEventListener(DRAG_START_EVENT, () => announcer.hold('handle', true));
  stage.instruments.addEventListener(DRAG_END_EVENT, () => announcer.hold('handle', false));
  announcer.say('rings', first.rings ? 'Rings on.' : 'Rings off.');
  store.select(
    (state) => state.rings,
    (rings) => announcer.say('rings', rings ? 'Rings on.' : 'Rings off.'),
  );

  const pinAddress: PinAddress = createPinAddress({
    store,
    dual,
    controller,
    readouts,
    overlays,
    input,
    pinElement: () => instruments.pinElement(),
    collarAnchor: collar.share.moreButton,
    focusAfter: {
      spot: () => mapCanvas.focus({ preventScroll: true }),
      trip: () => tools.button('measure').focus({ preventScroll: true }),
      drive: () => tools.button('drive').focus({ preventScroll: true }),
    },
  });
  instruments.onPinActivate(() => pinAddress.pinActivated());

  const captioner: Captioner = createCaptioner({
    store,
    dual,
    controller,
    readouts,
    layout,
    input,
    announcer,
    pinAddress,
    focus: {
      mapHasFocus: () => document.activeElement === mapCanvas,
      focusMap: () => mapCanvas.focus({ preventScroll: true }),
      focusTool: (tool) => tools.button(tool).focus({ preventScroll: true }),
      focusSlideRow: () => collar.slideTools.focusDone(),
    },
  });
  stage.foot.append(captioner.element);
  margin.append(collar.element);

  placeScaleBars({ dual, controller, layout, collarHost: collar.scaleHost, mapHost: stage.mapScale, setNote: collar.setScaleNote });

  // --- first view ---

  // The collar has just taken its share of the page; the maps must know before framing.
  dual.resize();
  if (!first.view) controller.frame({ animate: false });

  const tellIncomplete = (): void => {
    const { home, away } = store.get();
    toasts.show(`That link was incomplete, so here is ${home.name} over ${away.name}.`);
  };
  const linkSync = createLinkSync({ store, controller, address: browserAddressBar(), onIncomplete: tellIncomplete });
  // The address should describe what is on screen, not what could not be understood.
  if (link.incomplete) linkSync.repair();

  // --- drawing, failures, the one-time hint ---

  keepStatusNote({
    store,
    dual,
    setNote: stage.setNote,
    // While a view is being drawn the sentences are reworded as place names arrive; they are spoken once, when it is drawn.
    onDrawing: (drawing) => announcer.hold('drawing', drawing),
    onFirstOutcome() {
      // Said now and not at start, so that its few seconds are spent where the person can see what it is about.
      if (link.incomplete) tellIncomplete();
    },
  });

  offerSlideHint({
    store,
    dual,
    controller,
    layout,
    overlays,
    host: stage.top,
    stage: stage.maps,
    focusAfterClose: () => tools.button('slide').focus({ preventScroll: true }),
  });

  // --- keyboard ---

  bindKeyboard({
    overlayIsOpen: () => overlays.isOpen(),
    draggingHome: () => draggingHome,
    // Enter drops an end at the centre for a drive as it does for a trip.
    measuring: () => store.get().mode === 'measure' || store.get().mode === 'drive',
    singleKeys: () => store.get().shortcutsOn,
    isHandle: (target) => stage.instruments.contains(target),
    isMap: (target) => stage.maps.contains(target),
    run: (command) =>
      runCommand(command, {
        controller,
        instruments,
        tools,
        legend,
        shortcutsDialog,
        pinAddress,
        copyLink: () => void copyLink(),
        leaveMode: captioner.leaveMode,
      }),
    releaseHideHome: () => tools.holdHideKey(false),
  });

  window.__wwiwiwh = { store, dual, controller, typePlate, instruments };
}

const root = document.querySelector<HTMLElement>('#app');
if (root) start(root);
