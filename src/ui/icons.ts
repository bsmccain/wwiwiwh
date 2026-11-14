/**
 * The shell's line icons: drawn on a 24-unit grid in the current text colour, with a round stroke
 * that stays 1.5 px wide at whatever size the icon is shown (the stroke of the pin and the rings).
 * An icon sits next to a word or inside a named button, so it is hidden from assistive technology.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One shape of a drawing: its SVG tag and attributes. */
type Shape = readonly [tag: 'path' | 'circle' | 'rect', attributes: Readonly<Record<string, string>>];

const path = (d: string, className?: string): Shape => ['path', className ? { d, class: className } : { d }];
const circle = (cx: number, cy: number, r: number, extra: Readonly<Record<string, string>> = {}): Shape => [
  'circle',
  { cx: String(cx), cy: String(cy), r: String(r), ...extra },
];
const dot = (cx: number, cy: number, r: number): Shape => circle(cx, cy, r, { class: 'icon__dot' });

const ICONS = {
  slide: [path('M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3')],
  measure: [path('M5.6 18.4 18.4 5.6M9.5 11.5l3 3'), circle(4, 20, 2.2), circle(20, 4, 2.2)],
  // The same two ends as Measure, joined the way a road joins them.
  drive: [path('M4.9 17.9C6.5 7.5 17.5 16.5 19.1 6.1'), circle(4, 20, 2.2), circle(20, 4, 2.2)],
  rings: [circle(12, 12, 9.5, { 'stroke-dasharray': '1.5 3' }), circle(12, 12, 5.5, { 'stroke-dasharray': '1.5 3' }), dot(12, 12, 1)],
  hide: [path('M4 5h16v9l-6 6H4zM20 14h-6v6')],
  link: [
    path('M10 14a4 4 0 0 0 5.7 0l3.5-3.5a4 4 0 0 0-5.7-5.7L12 6.3M14 10a4 4 0 0 0-5.7 0l-3.5 3.5a4 4 0 0 0 5.7 5.7l1.5-1.5'),
  ],
  more: [dot(5, 12, 1.4), dot(12, 12, 1.4), dot(19, 12, 1.4)],
  swap: [path('M8 20V4M4.5 7.5 8 4l3.5 3.5M16 4v16M12.5 16.5 16 20l3.5-3.5')],
  chevron: [path('m6.5 9.5 5.5 5.5 5.5-5.5')],
  turnLeft: [path('M4 4.5v5.5h5.5M5.8 15a7.5 7.5 0 1 0 1.7-7.8L4 10')],
  turnRight: [path('M20 4.5v5.5h-5.5M18.2 15a7.5 7.5 0 1 1-1.7-7.8L20 10')],
  squareUp: [path('M5 5h14v14H5zM5 13.5h5.5V19')],
  close: [path('M6 6l12 12M18 6 6 18')],
  plus: [path('M12 5v14M5 12h14')],
  minus: [path('M5 12h14')],
  lineUp: [circle(12, 12, 5), path('M12 3v18M3 12h18')],
  search: [circle(10.5, 10.5, 6.5), path('M20 20l-4.9-4.9')],
  viewCentre: [path('M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4'), circle(12, 12, 3), dot(12, 12, 0.9)],
  nudgeLeft: [path('M19 12H5M10.5 6.5 5 12l5.5 5.5')],
  nudgeRight: [path('M5 12h14M13.5 6.5 19 12l-5.5 5.5')],
  nudgeUp: [path('M12 19V5M6.5 10.5 12 5l5.5 5.5')],
  nudgeDown: [path('M12 5v14M6.5 13.5 12 19l5.5-5.5')],
} as const satisfies Readonly<Record<string, readonly Shape[]>>;

export type IconName = keyof typeof ICONS;

function drawing(className: string, viewBox: string, shapes: readonly Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

export function icon(name: IconName, className = ''): SVGSVGElement {
  return drawing(className ? `icon ${className}` : 'icon', '0 0 24 24', ICONS[name]);
}

/**
 * The legend's ink swatches: a piece of each map as it is printed. Home is heavy warm line-work;
 * Away is light cool line-work. The flat tints of land and water are on whichever place has the
 * ground (collar.css hides the other place's by the root's `data-ground`).
 */
const groundTints = (): Shape[] => [
  ['rect', { class: 'swatch__land', width: '44', height: '22' }],
  path('M0 15c10-6 22 5 44-3v10H0z', 'swatch__water'),
];
const SWATCHES = {
  home: [...groundTints(), path('M0 16C14 16 18 5 44 5', 'swatch__home-major'), path('M8 0l12 22M30 0v22', 'swatch__home-minor')],
  away: [
    ...groundTints(),
    path('M0 7c16-3 26 3 44-1', 'swatch__away-major'),
    path('M14 0l4 22M34 0l-4 22', 'swatch__away-minor'),
  ],
} as const satisfies Readonly<Record<string, readonly Shape[]>>;

export function inkSwatch(role: 'home' | 'away', className: string): SVGSVGElement {
  return drawing(`swatch swatch--${role} ${className}`, '0 0 44 22', SWATCHES[role]);
}
