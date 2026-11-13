/**
 * Widths of lettering, measured on a canvas and remembered, so that sizing drawn text never asks the
 * DOM for a size (which would force a layout in the middle of a map frame).
 */

/**
 * The lettering face used on the map, spelled out because canvas fonts cannot use CSS custom
 * properties. Keep in step with --font-plate in src/styles/tokens.css.
 */
export const PLATE_FAMILY = '"Barlow Semi Condensed", "Barlow", system-ui, sans-serif';

export interface TextMeasurer {
  /** Width in CSS pixels of `text` set in `font` (a CSS font shorthand, as canvas takes it). */
  width(font: string, text: string): number;
  /** Forgets every width. Call when a font has finished loading: earlier widths were of a stand-in. */
  reset(): void;
}

/** Widths remembered per font before starting over, so a long session cannot grow without bound. */
const MAX_REMEMBERED = 4000;

/** Without a canvas a rough figure still lets things lay out: half an em per character. */
function roughWidth(font: string, text: string): number {
  const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 12);
  return text.length * size * 0.5;
}

export function createTextMeasurer(): TextMeasurer {
  const context = document.createElement('canvas').getContext('2d');
  // Kerning and ligatures as the page sets them, so the canvas agrees with laid-out text.
  if (context && 'textRendering' in context) context.textRendering = 'optimizeLegibility';
  const widthsByFont = new Map<string, Map<string, number>>();
  let fontInUse = '';

  return {
    width(font, text) {
      let widths = widthsByFont.get(font);
      if (!widths) widthsByFont.set(font, (widths = new Map()));
      const known = widths.get(text);
      if (known !== undefined) return known;

      let width: number;
      if (context) {
        if (fontInUse !== font) {
          context.font = font;
          fontInUse = font;
        }
        width = context.measureText(text).width;
      } else {
        width = roughWidth(font, text);
      }
      if (widths.size >= MAX_REMEMBERED) widths.clear();
      widths.set(text, width);
      return width;
    },
    reset() {
      widthsByFont.clear();
    },
  };
}

/**
 * Calls back when web fonts finish loading: widths measured before then were of a fallback face.
 * Returns a function that stops listening.
 */
export function onFontsLoaded(listener: () => void): () => void {
  const fonts = document.fonts;
  fonts.addEventListener('loadingdone', listener);
  return () => fonts.removeEventListener('loadingdone', listener);
}
