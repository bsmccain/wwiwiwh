/** Letters that Unicode decomposition leaves whole, with the plain spelling people type instead. */
const PLAIN_LETTERS: Readonly<Record<string, string>> = {
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ı: 'i',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

/**
 * Folds text for matching, so that accents, case and punctuation do not count:
 * "São Paulo" → "sao paulo", "L.A." → "la", "Dallas–Fort Worth" → "dallas fort worth".
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[øłđðıßæœþ]/g, (letter) => PLAIN_LETTERS[letter] ?? letter)
    .replace(/[.'’ʻ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** What the person typed, with stray whitespace removed. */
export function cleanQuery(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
