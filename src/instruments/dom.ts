/**
 * Small DOM helpers for the instruments. The writers remember what they last wrote to an element, so
 * laying everything out again on a frame that changed nothing touches nothing, and no layout is
 * ever read back.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

type Attributes = Readonly<Record<string, string | number>>;

function applyAttributes(element: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
}

export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Attributes = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  applyAttributes(element, attributes);
  return element;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly SVGElement[] = [],
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  applyAttributes(element, attributes);
  element.append(...children);
  return element;
}

/** A drawing that is decoration to assistive tech and never takes focus. */
export function drawing(className: string, attributes: Attributes, children: readonly SVGElement[]): SVGSVGElement {
  return svg('svg', { class: className, 'aria-hidden': 'true', focusable: 'false', ...attributes }, children);
}

/**
 * Gives a focusable element a focus ring `across` px wide overall: one that hugs what is drawn, not
 * the much larger pointer target, and so stays inside the box that place names keep clear of.
 * The stylesheet turns --wwiwiwh-focus-across into the outline's offset.
 */
export function hugFocus(element: HTMLElement, across: number): void {
  element.style.setProperty('--wwiwiwh-focus-across', `${across}px`);
}

const written = new WeakMap<Element, Map<string, string>>();

/** True when `value` differs from what was last written to `element` under `key`, which it then records. */
function isNews(element: Element, key: string, value: string): boolean {
  let record = written.get(element);
  if (!record) {
    record = new Map();
    written.set(element, record);
  }
  if (record.get(key) === value) return false;
  record.set(key, value);
  return true;
}

/** Two decimals: finer than any screen shows, short enough to compare cheaply. */
export function px(value: number): string {
  return value.toFixed(2);
}

export function setAttribute(element: Element, name: string, value: string): void {
  if (isNews(element, name, value)) element.setAttribute(name, value);
}

export function setTransform(element: HTMLElement, transform: string): void {
  if (isNews(element, 'style.transform', transform)) element.style.transform = transform;
}

/** Centres an element (laid out at the stage's top-left corner) on a stage position. */
export function centerOn(element: HTMLElement, x: number, y: number): void {
  setTransform(element, `translate(${px(x)}px, ${px(y)}px) translate(-50%, -50%)`);
}

export function setText(element: Element, text: string): void {
  if (isNews(element, 'text', text)) element.textContent = text;
}

export function setHidden(element: Element, hidden: boolean): void {
  if (isNews(element, 'hidden', hidden ? '1' : '0')) element.toggleAttribute('hidden', hidden);
}

export function setClass(element: Element, className: string, on: boolean): void {
  if (isNews(element, `class.${className}`, on ? '1' : '0')) element.classList.toggle(className, on);
}
