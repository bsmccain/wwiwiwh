import type { LngLat } from '../geo/types';

/** Valhalla writes its shapes with six decimal places (Google's original format has five). */
export const SHAPE_DIGITS = 6;
/** Five bits to a chunk: seven chunks hold any step across the globe at six decimal places, sign included. */
const LONGEST_NUMBER_CHUNKS = 7;

/**
 * Reads an encoded polyline: latitude and longitude steps, each a zigzag-encoded integer cut into
 * five-bit chunks and written as printable characters. Returns null for text that is not one (a
 * number broken off half way, a latitude without its longitude, a position off the globe), so a
 * line is never drawn from an answer that was cut short, and for a line of more than `maxPoints`.
 */
export function decodePolyline(text: string, digits: number = SHAPE_DIGITS, maxPoints: number = Infinity): LngLat[] | null {
  const scale = 10 ** digits;
  const line: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  /** The next number in the text, or null when the text ends inside it. */
  const next = (): number | null => {
    // Whole steps, so that a figure past 2^31 is not mangled as it would be by bit shifts.
    let value = 0;
    let place = 1;
    for (let chunks = 0; ; chunks++) {
      // A position on the globe is seven chunks at most; a number that runs on is not one.
      if (index >= text.length || chunks >= LONGEST_NUMBER_CHUNKS) return null;
      const chunk = text.charCodeAt(index++) - 63;
      if (chunk < 0 || chunk > 63) return null;
      value += (chunk & 0x1f) * place;
      place *= 32;
      if (chunk < 0x20) break;
    }
    return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
  };

  while (index < text.length) {
    const dLat = next();
    const dLng = dLat === null ? null : next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    const position = { lng: lng / scale, lat: lat / scale };
    // Written so that a position that is not a number at all is refused as well.
    if (!(Math.abs(position.lat) <= 90) || !(Math.abs(position.lng) <= 180)) return null;
    if (line.length >= maxPoints) return null;
    line.push(position);
  }
  return line;
}

/** Writes a line the way `decodePolyline` reads it. Used by tests and by the browser tests' stand-in server. */
export function encodePolyline(line: readonly LngLat[], digits: number = SHAPE_DIGITS): string {
  const scale = 10 ** digits;
  let text = '';
  let lat = 0;
  let lng = 0;
  const write = (step: number): void => {
    let value = step < 0 ? -2 * step - 1 : 2 * step;
    while (value >= 0x20) {
      text += String.fromCharCode((0x20 | (value % 32)) + 63);
      value = Math.floor(value / 32);
    }
    text += String.fromCharCode(value + 63);
  };
  for (const position of line) {
    const nextLat = Math.round(position.lat * scale);
    const nextLng = Math.round(position.lng * scale);
    write(nextLat - lat);
    write(nextLng - lng);
    lat = nextLat;
    lng = nextLng;
  }
  return text;
}
