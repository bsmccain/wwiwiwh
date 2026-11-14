import { describe, expect, it } from 'vitest';
import { mix } from '../map/style/palette';
import { apart, contrast } from './testing/colour';
import { ALL_INKS, DEFAULT_INK_SET, INK_SETS, inkSet, inksFor, isInkSetId, resolveTheme, type ColourVision, type Inks } from './theme';

const DICHROMACIES: readonly ColourVision[] = ['protan', 'deutan', 'tritan'];
/** Below this two inks can pass for one another in thin lines. No set goes under it for any dichromacy. */
const NEVER_CLOSER = 0.1;
/** What a set promises for the kinds of colour blindness it names in `holdsFor`. */
const WELL_APART = 0.2;

/** The pairs that must not be mistaken: Home's lines for Away's lines or lettering, and either map for the pin and rings. */
function closestPair(inks: Inks, vision: ColourVision | 'full'): number {
  const pairs = [[inks.home, inks.away], [inks.home, inks.awayDeep], [inks.home, inks.key], [inks.away, inks.key]] as const;
  return Math.min(...pairs.map(([a, b]) => apart(a, b, vision)));
}

describe('the ink sets', () => {
  it('start with the default and have names of their own', () => {
    expect(INK_SETS[0]?.id).toBe(DEFAULT_INK_SET);
    expect(INK_SETS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(INK_SETS.map((set) => set.name)).size).toBe(INK_SETS.length);
    for (const set of INK_SETS) expect(set.note, set.id).not.toBe('');
  });

  it('have ids that public/theme.js will pass on to the style sheet', () => {
    for (const set of INK_SETS) expect(set.id).toMatch(/^[a-z]+$/);
  });

  it('hand out one object per set and theme', () => {
    expect(inksFor('thistle', 'dark')).toBe(inkSet('thistle').dark);
    expect(inksFor('thistle', 'dark')).toMatchObject({ set: 'thistle', theme: 'dark', id: 'thistle-dark' });
    expect(new Set(ALL_INKS.map((inks) => inks.id)).size).toBe(INK_SETS.length * 2);
  });

  it('tell a set from anything else found in storage', () => {
    expect(isInkSetId('newsprint')).toBe(true);
    for (const other of ['sepia', 'toString', '', 3, null, undefined]) expect(isInkSetId(other), String(other)).toBe(false);
  });
});

describe.each(ALL_INKS)('$id', (inks) => {
  it('is a light sheet in light and a dark one in dark', () => {
    const lighterThanKey = contrast(inks.sheet, '#000000') > contrast(inks.key, '#000000');
    expect(lighterThanKey).toBe(inks.theme === 'light');
  });

  it('sets words that read on the sheet in every ink words are set in', () => {
    expect(contrast(inks.key, inks.sheet)).toBeGreaterThanOrEqual(7);
    // Home's name, Away's name (app.css sets it in the Away ink in light and in the lettering ink in dark) and the map's own lettering.
    for (const ink of [inks.key2, inks.home, inks.theme === 'light' ? inks.away : inks.awayDeep, inks.awayDeep]) {
      expect(contrast(ink, inks.sheet), ink).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('prints Away’s heaviest roads and the outlines of controls at 3:1 or better', () => {
    expect(contrast(inks.away, inks.sheet)).toBeGreaterThanOrEqual(3);
    // --rule-control and --ink-disabled in app.css.
    expect(contrast(mix(inks.key, inks.sheet, 0.55), inks.sheet)).toBeGreaterThanOrEqual(3);
  });

  it('has tints of both map inks that read on a band of key ink, under a pointer too', () => {
    // caption.css lays a tenth of the sheet colour over the band where the pointer is.
    const underPointer = mix(inks.sheet, inks.key, 0.1);
    for (const tint of [inks.homeOnKey, inks.awayOnKey]) {
      expect(contrast(tint, inks.key), tint).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tint, underPointer), tint).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('edges water in something that shows against it', () => {
    expect(contrast(inks.waterEdge, inks.water)).toBeGreaterThanOrEqual(1.5);
  });

  it.each(DICHROMACIES)('keeps Home, Away and the key ink from passing for one another: %s', (vision) => {
    expect(closestPair(inks, vision)).toBeGreaterThan(NEVER_CLOSER);
  });
});

describe('what the sets say of themselves', () => {
  const claims = INK_SETS.flatMap((set) => set.holdsFor.map((vision) => ({ set, name: set.name, vision })));

  it.each(claims)('$name keeps its inks well apart in light and in dark: $vision', ({ set, vision }) => {
    expect(closestPair(set.light, vision)).toBeGreaterThanOrEqual(WELL_APART);
    expect(closestPair(set.dark, vision)).toBeGreaterThanOrEqual(WELL_APART);
  });

  it('Kingfisher is the one to offer for red-green colour blindness: it does better there than Classic', () => {
    for (const vision of ['protan', 'deutan'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        expect(closestPair(inksFor('kingfisher', theme), vision), `${vision}, ${theme}`).toBeGreaterThan(closestPair(inksFor('classic', theme), vision));
      }
    }
  });

  it('Newsprint prints in greys alone', () => {
    for (const inks of [inkSet('newsprint').light, inkSet('newsprint').dark]) {
      for (const ink of [inks.key, inks.key2, inks.home, inks.away, inks.awayDeep, inks.homeOnKey, inks.awayOnKey, inks.waterEdge]) {
        expect(ink, inks.id).toMatch(/^#([0-9A-F]{2})\1\1$/);
      }
    }
  });

  it('Stark reaches 7:1 against the sheet in every ink words are set in', () => {
    for (const inks of [inkSet('stark').light, inkSet('stark').dark]) {
      for (const ink of [inks.key, inks.key2, inks.home, inks.theme === 'light' ? inks.away : inks.awayDeep, inks.awayDeep]) {
        expect(contrast(ink, inks.sheet), `${inks.id} ${ink}`).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe('resolveTheme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
