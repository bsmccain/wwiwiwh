/** Small DOM builders for the shell. */

type Child = Node | string | false | null | undefined;
type Attributes = Readonly<Record<string, string>>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  attributes: Attributes = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children.filter((child): child is Node | string => child !== false && child !== null && child !== undefined));
  return node;
}

export function button(className: string, attributes: Attributes = {}, children: readonly Child[] = []): HTMLButtonElement {
  return el('button', className, { type: 'button', ...attributes }, children);
}

/** A button that shows only an icon: its name is spoken to assistive technology and shown as a tooltip. */
export function iconButton(className: string, name: string, icon: Node): HTMLButtonElement {
  return button(className, { 'aria-label': name, title: name }, [icon]);
}

/** A link that leaves the app: it opens in a new tab, says so to screen readers, and cannot reach back into this one. */
export function externalLink(href: string, text: string): HTMLAnchorElement {
  return el('a', '', { href, target: '_blank', rel: 'noopener' }, [text, el('span', 'visually-hidden', {}, [' (opens in a new tab)'])]);
}

/** Writes text only when it differs, so unchanged readouts cost nothing and are not re-announced. */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

let ids = 0;

/** An id for wiring labels to what they label. */
export function uniqueId(prefix: string): string {
  ids += 1;
  return `${prefix}-${ids}`;
}
