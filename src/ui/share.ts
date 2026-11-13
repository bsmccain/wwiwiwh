import { button, el, externalLink } from './dom';
import { icon } from './icons';

export interface Share {
  readonly element: HTMLElement;
  readonly moreButton: HTMLButtonElement;
}

const OPENSTREETMAP = 'https://www.openstreetmap.org/copyright';
const OPENFREEMAP = 'https://openfreemap.org';

/**
 * The end of the collar: the one filled button (copy a link to exactly this view), More, and the
 * credits the map data and tiles ask for. In this order in the page too, which is how they are laid
 * out wherever the credits show.
 */
export function createShare(options: { onCopy: () => void; onMore: () => void; copyDisabled: boolean }): Share {
  const copy = button('share__copy', {}, [
    icon('link'),
    // Only one of the two wordings is displayed at a time, so the button has one name.
    el('span', 'share__copy-long', {}, ['Copy link to this view']),
    el('span', 'share__copy-short', {}, ['Copy link']),
  ]);
  copy.disabled = options.copyDisabled;
  copy.addEventListener('click', options.onCopy);

  const moreButton = button('share__more', { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, [
    icon('more'),
    el('span', 'tool__word', {}, ['More']),
  ]);
  moreButton.addEventListener('click', options.onMore);

  // The same credit in two lengths; the stylesheet shows the one there is room for.
  const credits = el('p', 'share__credits', {}, [
    el('span', 'share__credits-long', {}, [
      'Map data © ',
      externalLink(OPENSTREETMAP, 'OpenStreetMap'),
      ' contributors. Tiles by ',
      externalLink(OPENFREEMAP, 'OpenFreeMap'),
      '.',
    ]),
    el('span', 'share__credits-short', {}, ['© ', externalLink(OPENSTREETMAP, 'OpenStreetMap'), ', ', externalLink(OPENFREEMAP, 'OpenFreeMap')]),
  ]);

  const element = el('section', 'collar__section share', { 'aria-label': 'Share and more' }, [copy, moreButton, credits]);
  return { element, moreButton };
}
