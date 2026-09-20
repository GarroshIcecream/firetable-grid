import type { Hue, PaletteColor } from "./palette";
import { gridTheme } from "./theme";

type Vec3 = [number, number, number];

const SHADE_MIX: Record<
  number,
  { readonly weight: number; readonly towards: 0 | 1 }
> = {
  5: { weight: 0.1, towards: 1 },
  10: { weight: 0.25, towards: 1 },
  20: { weight: 0.45, towards: 1 },
  30: { weight: 0.7, towards: 1 },
  40: { weight: 0.85, towards: 1 },
  50: { weight: 1, towards: 1 },
  60: { weight: 0.85, towards: 0 },
  70: { weight: 0.7, towards: 0 },
  80: { weight: 0.55, towards: 0 },
  90: { weight: 0.45, towards: 0 },
  100: { weight: 0.35, towards: 0 },
};

const WHITE_HEX = "#ffffff";

function toLinear(channel: number): number {
  const magnitude = Math.abs(channel);
  const linear =
    magnitude <= 0.04045
      ? magnitude / 12.92
      : ((magnitude + 0.055) / 1.055) ** 2.4;
  return channel < 0 ? -linear : linear;
}

function toGamma(channel: number): number {
  const magnitude = Math.abs(channel);
  const encoded =
    magnitude <= 0.0031308
      ? magnitude * 12.92
      : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return channel < 0 ? -encoded : encoded;
}

function hexToLinearRgb(hex: string): Vec3 {
  const packed = Number.parseInt(hex.slice(1), 16);
  return [
    toLinear(((packed >> 16) & 0xff) / 255),
    toLinear(((packed >> 8) & 0xff) / 255),
    toLinear((packed & 0xff) / 255),
  ];
}

function linearRgbToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([lightness, a, b]: Vec3): Vec3 {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearRgbToHex(rgb: Vec3): string {
  const bytes = rgb.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    return Math.round(toGamma(clamped) * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${bytes.join("")}`;
}

export function paletteShadeHex(hue: Hue, shade: number): string {
  const mix = SHADE_MIX[shade];
  if (!mix) return gridTheme().baseHex[hue];
  const [lightness, a, b] = linearRgbToOklab(
    hexToLinearRgb(gridTheme().baseHex[hue]),
  );
  // White and black are achromatic, so their OKLCh hue is powerless and CSS
  // carries the chromatic endpoint's hue through unchanged (CSS Color 4 §12.2).
  // With the hue fixed, the polar mix collapses to this rectangular lerp —
  // do not "fix" it into an atan2/hypot interpolation, and do not reuse it for
  // a mix against a chromatic second colour, where the two genuinely differ.
  const mixed: Vec3 = [
    lightness * mix.weight + mix.towards * (1 - mix.weight),
    a * mix.weight,
    b * mix.weight,
  ];
  return linearRgbToHex(oklabToLinearRgb(mixed));
}

function hexToArgb(hex: string): string {
  return `FF${hex.slice(1).toUpperCase()}`;
}

export function paletteFillArgb(color: PaletteColor): string {
  const swatch = gridTheme().palette[color.hue][color.level];
  return hexToArgb(paletteShadeHex(color.hue, swatch.shade));
}

export function paletteTextArgb(color: PaletteColor): string {
  const className = gridTheme().palette[color.hue][color.level].text;
  if (className === "text-white") return hexToArgb(WHITE_HEX);
  const match = /^text-([a-z]+)-(\d+)$/.exec(className);
  if (!match) return hexToArgb(WHITE_HEX);
  return hexToArgb(paletteShadeHex(match[1] as Hue, Number(match[2])));
}
