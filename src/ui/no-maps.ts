import { savePrefs } from '../app/prefs';
import type { Store } from '../app/store';
import { inksFor, resolveTheme, type Inks } from '../app/theme';
import type { AppState } from '../app/types';
import type { MapUnavailableError } from '../map/engine';
import { createCollar, type Collar, type CollarActions } from './collar';
import type { MoreMenuOptions } from './more-menu';
import type { Overlays } from './overlays';
import type { Stage } from './stage';

const nothing = (): void => undefined;

/** Every map tool is disabled where the maps could not start, so none of these is ever called. */
const NO_MAP_ACTIONS: CollarActions = {
  pickPlace: nothing,
  swap: nothing,
  turnBy: nothing,
  squareUp: nothing,
  slideBy: nothing,
  toggleSlide: nothing,
  toggleMeasure: nothing,
  toggleDrive: nothing,
  toggleRings: nothing,
  setHomeHidden: nothing,
};

/**
 * What is left when the maps cannot be drawn: the stage says why, and the collar still shows the two
 * places with its map tools off. Only the viewer's own settings still work, and they are kept here,
 * since the controller that otherwise keeps them needs the maps.
 */
export function startWithoutMaps(deps: {
  error: MapUnavailableError;
  stage: Stage;
  store: Store<AppState>;
  overlays: Overlays;
  systemPrefersDark: () => boolean;
  applyInks: (inks: Inks) => void;
  openMenu: (anchor: HTMLElement, actions: MoreMenuOptions['actions'], mapReady: boolean, onPinByAddress: () => void) => void;
}): Collar {
  const { error, store } = deps;
  deps.stage.showUnavailable(error.message);

  const settings: MoreMenuOptions['actions'] = {
    lineUpAgain: nothing,
    setUnits: (units) => store.set({ units }),
    setShortcutsOn: (shortcutsOn) => store.set({ shortcutsOn }),
    setGround: (ground) => store.set({ ground }),
    setThemeChoice(themeChoice) {
      const theme = resolveTheme(themeChoice, deps.systemPrefersDark());
      store.set({ themeChoice, theme });
      deps.applyInks(inksFor(store.get().inkSet, theme));
    },
    setInkSet(inkSet) {
      store.set({ inkSet });
      deps.applyInks(inksFor(inkSet, store.get().theme));
    },
  };
  store.subscribe(({ units, themeChoice, ground, inkSet, shortcutsOn, slideHintDone }) =>
    savePrefs({ units, themeChoice, ground, inkSet, shortcutsOn, slideHintDone }),
  );

  const collar: Collar = createCollar({
    store,
    actions: NO_MAP_ACTIONS,
    overlays: deps.overlays,
    readouts: null,
    onCopy: nothing,
    onMore: () => deps.openMenu(collar.share.moreButton, settings, false, nothing),
    onSpot: nothing,
    onLeaveMode: nothing,
  });
  return collar;
}
