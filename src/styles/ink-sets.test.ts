import { describe, expect, it } from 'vitest';
import { DEFAULT_INK_SET, inksFor } from '../app/theme';
import appCss from '../ui/app.css?raw';
import { INK_PROPERTIES, inkSetsCss } from './ink-sets';
import tokensCss from './tokens.css?raw';

describe('the inks as CSS', () => {
  it('ink-sets.css is what the inks in theme.ts generate (run `npm run inks` after changing them)', async () => {
    await expect(inkSetsCss()).toMatchFileSnapshot('./ink-sets.css');
  });

  it('the Classic colours written by hand in tokens.css and app.css are the ones in theme.ts', () => {
    const css = `${tokensCss}\n${appCss}`;
    for (const [property, ink] of INK_PROPERTIES) {
      const written = [...css.matchAll(new RegExp(`${property}: (#[0-9a-f]{6});`, 'g'))].map((match) => match[1]);
      const light = inksFor(DEFAULT_INK_SET, 'light')[ink].toLowerCase();
      const dark = inksFor(DEFAULT_INK_SET, 'dark')[ink].toLowerCase();
      // Once for light, then for dark twice: the chosen theme, and the system's before a script has run.
      expect(written, property).toEqual([light, dark, dark]);
    }
  });
});
