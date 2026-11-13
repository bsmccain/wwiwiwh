import { describe, expect, it } from 'vitest';
import paloAltoToSanJose from './fixtures/palo-alto-to-san-jose.json';
import { decodePolyline, encodePolyline } from './polyline';

describe('decodePolyline', () => {
  it('reads the worked example from the format’s own description, at five decimal places', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('reads a real route from end to end, at the six decimal places the server writes', () => {
    const line = decodePolyline(paloAltoToSanJose.body.trip.legs[0]?.shape ?? '');
    expect(line).not.toBeNull();
    expect(line?.length).toBe(411);
    // The route starts and ends on the roads nearest the two spots that were asked about.
    expect(line?.[0]?.lat).toBeCloseTo(37.4419, 2);
    expect(line?.[0]?.lng).toBeCloseTo(-122.143, 2);
    expect(line?.at(-1)?.lat).toBeCloseTo(37.3382, 2);
    expect(line?.at(-1)?.lng).toBeCloseTo(-121.8863, 2);
  });

  it('reads nothing as a line with no points', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('refuses text that breaks off inside a number, or after a latitude', () => {
    const whole = encodePolyline([
      { lat: 51.5, lng: -0.12 },
      { lat: 51.6, lng: -0.2 },
    ]);
    expect(decodePolyline(whole)).toHaveLength(2);
    expect(decodePolyline(whole.slice(0, -1))).toBeNull();
    expect(decodePolyline(`${whole}_`)).toBeNull();
    expect(decodePolyline(`${whole}?`)).toBeNull();
  });

  it('refuses characters the format does not use, and positions off the globe', () => {
    expect(decodePolyline('not a shape')).toBeNull();
    expect(decodePolyline(encodePolyline([{ lat: 95, lng: 10 }]))).toBeNull();
    expect(decodePolyline(encodePolyline([{ lat: 10, lng: 181 }]))).toBeNull();
  });

  it('refuses a number that runs on and on, which would add up to no position at all', () => {
    const whole = encodePolyline([{ lat: 51.5, lng: -0.12 }]);
    expect(decodePolyline(`${whole}${'_'.repeat(8)}??`)).toBeNull();
    expect(decodePolyline(`${whole}${'_'.repeat(400)}??`)).toBeNull();
  });

  it('gives back what encodePolyline wrote, either side of the equator and the meridian', () => {
    const line = [
      { lat: -33.868821, lng: 151.209296 },
      { lat: 0, lng: 0 },
      { lat: 64.146582, lng: -21.942635 },
      { lat: -54.801912, lng: -68.302951 },
    ];
    const read = decodePolyline(encodePolyline(line)) ?? [];
    expect(read).toHaveLength(line.length);
    read.forEach((position, index) => {
      expect(position.lat).toBeCloseTo(line[index]?.lat ?? NaN, 6);
      expect(position.lng).toBeCloseTo(line[index]?.lng ?? NaN, 6);
    });
  });
});
