import { describe, expect, it } from 'vitest';
import { nameAt, sameSpot, tidyName } from './spots';

describe('tidyName', () => {
  it('trims and collapses white space', () => {
    expect(tidyName('  10   Downing\n Street ')).toBe('10 Downing Street');
  });

  it('cuts by whole characters at eighty', () => {
    const cut = tidyName(`${'a'.repeat(79)}🏠🏠`);
    expect(Array.from(cut)).toHaveLength(80);
    expect(cut.endsWith('🏠')).toBe(true);
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });

  it('drops halves of characters, controls and direction marks', () => {
    expect(tidyName('a\uD83Cb')).toBe('ab');
    expect(tidyName('\uDFE0house')).toBe('house');
    expect(tidyName('‮evil‬')).toBe('evil');
    expect(tidyName('tab\there\u0000')).toBe('tab here');
    expect(tidyName('⁦⁩')).toBe('');
  });

  it('has nothing to show for a name with nothing visible in it', () => {
    expect(tidyName('\u200B\u200D\u2060')).toBe('');
    expect(tidyName(' \u00AD \uFEFF ')).toBe('');
    // Joiners inside a real name are part of how it is written.
    expect(tidyName('نام\u200Cخانه')).toBe('نام\u200Cخانه');
  });

  it('leaves real names alone, whatever their script', () => {
    for (const name of ['São Paulo', '東京駅', 'Straße des 17. Juni', 'شارع الحمراء', "King's Cross St. Pancras"]) {
      expect(tidyName(name)).toBe(name);
    }
  });
});

describe('nameAt', () => {
  const at = { lat: 51.5034, lng: -0.1276 };
  it('gives the name only while the thing is still on the spot', () => {
    expect(nameAt({ name: 'No. 10', at }, at)).toBe('No. 10');
    expect(nameAt({ name: 'No. 10', at }, { lat: at.lat + 0.00001, lng: at.lng })).toBe('No. 10');
    expect(nameAt({ name: 'No. 10', at }, { lat: at.lat + 0.0001, lng: at.lng })).toBeNull();
    expect(nameAt(null, at)).toBeNull();
    expect(nameAt(undefined, at)).toBeNull();
  });

  it('calls two positions the same spot within two metres', () => {
    expect(sameSpot(at, { lat: at.lat, lng: at.lng + 0.00002 })).toBe(true);
    expect(sameSpot(at, { lat: at.lat, lng: at.lng + 0.0001 })).toBe(false);
  });
});
