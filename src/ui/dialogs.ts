import './dialogs.css';
import { button, el, externalLink, setText, uniqueId } from './dom';
import { icon } from './icons';
import type { Overlays } from './overlays';
import { KEYS_THAT_STAY, SHORTCUT_GROUPS } from './shortcuts';

export interface SheetDialog {
  open(): void;
}

/**
 * A modal dialog in the sheet style. The browser's own `<dialog>` keeps focus inside, closes on
 * Escape and hands focus back to whatever opened it. Its body can be scrolled from the keyboard when
 * it does not fit, which is why it takes focus itself.
 */
function createDialog(options: {
  className: string;
  title: string;
  body: readonly Node[];
  overlays: Overlays;
  /** Called each time the dialog is about to be shown. */
  onOpen?: () => void;
}): SheetDialog {
  const titleId = uniqueId('dialog-title');
  const close = button('dialog__close', {}, [icon('close'), 'Close']);
  const sheet = el('div', 'dialog__sheet', {}, [
    el('header', 'dialog__head', {}, [el('h2', 'dialog__title', { id: titleId }, [options.title]), close]),
    el('div', 'dialog__body', { tabindex: '0', role: 'region', 'aria-labelledby': titleId }, options.body),
  ]);
  const dialog = el('dialog', `dialog ${options.className}`, { 'aria-labelledby': titleId }, [sheet]);
  let closed: (() => void) | null = null;

  close.addEventListener('click', () => dialog.close());
  // The sheet fills the dialog's box, so a click on the dialog element itself landed on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    closed?.();
    closed = null;
  });

  return {
    open() {
      if (dialog.open) return;
      options.onOpen?.();
      if (!dialog.isConnected) document.body.append(dialog);
      dialog.showModal();
      closed = options.overlays.opened(() => dialog.close());
    },
  };
}

function keyCap(key: string): HTMLElement {
  return el('kbd', 'keys__cap', {}, [key]);
}

/** Chords are joined with "+", alternatives stand side by side. */
function keyCaps(keys: readonly (readonly string[])[]): Node[] {
  return keys.map((chord) =>
    el(
      'span',
      'keys__chord',
      {},
      chord.flatMap((key, index) => (index === 0 ? [keyCap(key)] : [el('span', 'keys__plus', {}, ['+']), keyCap(key)])),
    ),
  );
}

export function createShortcutsDialog(deps: { overlays: Overlays; singleKeysOn: () => boolean }): SheetDialog {
  const groups = SHORTCUT_GROUPS.map((group) =>
    el('section', 'keys__group', {}, [
      el('h3', 'keys__title', {}, [group.title]),
      el(
        'dl',
        'keys__list',
        {},
        group.entries.map((entry) =>
          el('div', 'keys__row', {}, [el('dt', 'keys__keys', {}, keyCaps(entry.keys)), el('dd', 'keys__does', {}, [entry.does])]),
        ),
      ),
    ]),
  );
  const note = el('p', 'keys__note');
  return createDialog({
    className: 'dialog--keys',
    title: 'Keyboard shortcuts',
    body: [note, el('div', 'keys', {}, groups)],
    overlays: deps.overlays,
    onOpen() {
      setText(
        note,
        deps.singleKeysOn()
          ? 'Keys pressed on their own can be switched off under More, Single-key shortcuts.'
          : `Single-key shortcuts are off; switch them on under More. ${KEYS_THAT_STAY}`,
      );
    },
  });
}

export function createAboutDialog(deps: { overlays: Overlays }): SheetDialog {
  const paragraph = (className: string, children: readonly (Node | string)[]): HTMLElement => el('p', className, {}, children);
  const credit = (children: readonly (Node | string)[]): HTMLElement => el('li', '', {}, children);

  return createDialog({
    className: 'dialog--about',
    title: 'About wwiwiwh',
    overlays: deps.overlays,
    body: [
      paragraph('about__lead', [
        'wwiwiwh (Where Was I When I Was Here) lays the street map of a place you know over a place you are curious about. Both are drawn at the same size, so your feel for distances at home carries over.',
      ]),
      paragraph('about__promise', [
        'Both maps are drawn at the same ground scale: matched at the pin, and within about 1% across a metro area. Measure gives straight lines. Drive follows the roads of one place, and shades how far the same time or distance of driving gets on the other; of the two rings about its start, the dashed one runs through its end, as far out as the end is in a straight line, and the other is as far out as the drive is long by road. Its times are estimates for a car, without traffic.',
      ]),
      paragraph('about__lead', [
        "Addresses you search for are sent to Photon to be looked up, and the two ends of a drive, with the spot its start lands on in the other place, are sent to the routing server. A link you copy carries the pin's position, any drive, and any names you gave their spots.",
      ]),
      paragraph('about__lead', [
        "The places and spots you pick, with their exact positions, are kept in this browser so the pickers can offer them again, and anyone using this browser can see them. Under More, Recent places and spots clears them or stops keeping them. That cannot take back a link already shared, or clear the browser's own history.",
      ]),
      el('h3', 'about__heading', {}, ['Credits and licences']),
      el('ul', 'about__credits', {}, [
        credit([
          'Map data © ',
          externalLink('https://www.openstreetmap.org/copyright', 'OpenStreetMap'),
          ' contributors, under the ',
          externalLink('https://opendatacommons.org/licenses/odbl/', 'Open Database License'),
          ' (ODbL).',
        ]),
        credit([
          'Tiles by ',
          externalLink('https://openfreemap.org', 'OpenFreeMap'),
          ', using the ',
          externalLink('https://openmaptiles.org', 'OpenMapTiles'),
          ' schema.',
        ]),
        credit(['Place search by ', externalLink('https://photon.komoot.io', 'Photon'), ', from komoot.']),
        credit([
          'Driving routes by ',
          externalLink('https://valhalla.github.io/valhalla/', 'Valhalla'),
          ', on a server run by ',
          externalLink('https://www.fossgis.de/', 'FOSSGIS'),
          '.',
        ]),
        credit(['Maps drawn with ', externalLink('https://maplibre.org', 'MapLibre GL JS'), '.']),
        credit([
          'Typefaces Barlow and Barlow Semi Condensed, under the ',
          externalLink('https://openfontlicense.org', 'SIL Open Font License'),
          '.',
        ]),
      ]),
    ],
  });
}
