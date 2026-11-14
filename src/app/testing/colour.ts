import type { ColourVision } from '../theme';

/** Colour arithmetic for tests that hold the inks to what is said about them. All colours are #rrggbb. */

type Rgb = readonly [number, number, number];

/** Linear-light channels, 0 to 1. */
function linear(hex: string): Rgb {
  const channel = (start: number): number => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

const LUMINANCE: Rgb = [0.2126, 0.7152, 0.0722];
const dot = (a: Rgb, b: Rgb): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [low, high] = [dot(LUMINANCE, linear(a)), dot(LUMINANCE, linear(b))].sort((x, y) => x - y) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/**
 * What an eye without one kind of cone makes of a linear-light colour: the matrices of Machado, Oliveira
 * and Fernandes (2009) at full severity. Seeing no colour at all leaves the luminance.
 */
const SEEN_AS: Readonly<Record<ColourVision, readonly [Rgb, Rgb, Rgb]>> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  mono: [LUMINANCE, LUMINANCE, LUMINANCE],
};

function seen(hex: string, vision: ColourVision | 'full'): Rgb {
  const rgb = linear(hex);
  if (vision === 'full') return rgb;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const [r, g, b] = SEEN_AS[vision];
  return [clamp(dot(r, rgb)), clamp(dot(g, rgb)), clamp(dot(b, rgb))];
}

function oklab(rgb: Rgb): Rgb {
  const l = Math.cbrt(dot([0.4122214708, 0.5363325363, 0.0514459929], rgb));
  const m = Math.cbrt(dot([0.2119034982, 0.6806995451, 0.1073969566], rgb));
  const s = Math.cbrt(dot([0.0883024619, 0.2817188376, 0.6299787005], rgb));
  const lms: Rgb = [l, m, s];
  return [
    dot([0.2104542553, 0.793617785, -0.0040720468], lms),
    dot([1.9779984951, -2.428592205, 0.4505937099], lms),
    dot([0.0259040371, 0.7827717662, -0.808675766], lms),
  ];
}

/**
 * How far apart two colours look to the given colour vision: their distance in OKLab, where black to
 * white is 1 and a step of about 0.02 can just be seen between two large patches side by side.
 */
export function apart(a: string, b: string, vision: ColourVision | 'full' = 'full'): number {
  const [x, y] = [oklab(seen(a, vision)), oklab(seen(b, vision))];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
