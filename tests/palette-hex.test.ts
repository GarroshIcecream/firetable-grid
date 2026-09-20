import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PALETTE,
  HUES,
  type Hue,
  LEVELS,
  paletteFillArgb,
  paletteShadeHex,
  paletteTextArgb,
} from "../src";

const css = readFileSync(
  join(import.meta.dir, "../styles/palette.css"),
  "utf8",
);

function cssBaseHex(hue: Hue): string | undefined {
  const match = new RegExp(
    `--color-${hue}-base:\\s*light-dark\\((#[0-9a-fA-F]{6}),`,
  ).exec(css);
  return match?.[1]?.toLowerCase();
}

function cssMix(
  hue: Hue,
  shade: number,
): { weight: number; towards: string } | undefined {
  const match = new RegExp(
    // Whitespace-tolerant: the formatter is free to wrap a long color-mix().
    `--color-${hue}-${shade}:\\s*color-mix\\(\\s*in oklch,\\s*var\\(--color-${hue}-base\\)\\s*(\\d+)%,\\s*(white|black)`,
  ).exec(css);
  if (!match) return undefined;
  return { weight: Number(match[1]) / 100, towards: match[2] as string };
}

const SHADES = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

describe("palette-hex reproduces the CSS palette", () => {
  test("shade 50 round-trips to the declared base for every hue", () => {
    // shade 50 is `color-mix(… base 100%, white 0%)`, so any drift in the
    // OKLab matrices or the transfer functions shows up here first.
    const drifted = HUES.filter(
      (hue) => paletteShadeHex(hue, 50) !== cssBaseHex(hue),
    );
    expect(drifted).toEqual([]);
  });

  test("every base hex matches globals.css", () => {
    const missing = HUES.filter((hue) => cssBaseHex(hue) === undefined);
    expect(missing).toEqual([]);
  });

  test("every shade's mix weight matches globals.css", () => {
    // The module hardcodes the mix table; if someone re-tunes the ramp in CSS
    // the exported colours would silently keep the old values.
    const expected: Record<number, { weight: number; towards: string }> = {
      5: { weight: 0.1, towards: "white" },
      10: { weight: 0.25, towards: "white" },
      20: { weight: 0.45, towards: "white" },
      30: { weight: 0.7, towards: "white" },
      40: { weight: 0.85, towards: "white" },
      50: { weight: 1, towards: "white" },
      60: { weight: 0.85, towards: "black" },
      70: { weight: 0.7, towards: "black" },
      80: { weight: 0.55, towards: "black" },
      90: { weight: 0.45, towards: "black" },
      100: { weight: 0.35, towards: "black" },
    };
    const mismatches: string[] = [];
    for (const hue of HUES) {
      for (const shade of SHADES) {
        const actual = cssMix(hue, shade);
        const want = expected[shade];
        if (
          actual === undefined ||
          actual.weight !== want?.weight ||
          actual.towards !== want.towards
        ) {
          mismatches.push(`${hue}-${shade}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("palette-hex ARGB output", () => {
  test("fill resolves through the swatch shade, not a fixed one per level", () => {
    // orange and yellow are the two hues whose `dark` level is shade 50, not
    // 60 — a hardcoded 60 would silently darken them.
    expect(paletteFillArgb({ hue: "orange", level: "dark" })).toBe(
      `FF${paletteShadeHex("orange", 50).slice(1).toUpperCase()}`,
    );
    expect(paletteFillArgb({ hue: "red", level: "dark" })).toBe(
      `FF${paletteShadeHex("red", 60).slice(1).toUpperCase()}`,
    );
  });

  test("on-fill text follows the swatch, including the two non-white darks", () => {
    expect(paletteTextArgb({ hue: "red", level: "dark" })).toBe("FFFFFFFF");
    expect(paletteTextArgb({ hue: "orange", level: "dark" })).toBe(
      `FF${paletteShadeHex("orange", 100).slice(1).toUpperCase()}`,
    );
    expect(paletteTextArgb({ hue: "yellow", level: "dark" })).toBe(
      `FF${paletteShadeHex("yellow", 100).slice(1).toUpperCase()}`,
    );
  });

  test("every hue and level yields a well-formed opaque ARGB pair", () => {
    const malformed: string[] = [];
    for (const hue of HUES) {
      for (const level of LEVELS) {
        const color = { hue, level } as const;
        for (const argb of [paletteFillArgb(color), paletteTextArgb(color)]) {
          if (!/^FF[0-9A-F]{6}$/.test(argb)) malformed.push(`${hue}/${level}`);
        }
      }
    }
    expect(malformed).toEqual([]);
  });

  test("the swatch shade the fill uses is the one the palette declares", () => {
    const drifted: string[] = [];
    for (const hue of HUES) {
      for (const level of LEVELS) {
        const shade = DEFAULT_PALETTE[hue][level].shade;
        if (
          paletteFillArgb({ hue, level }) !==
          `FF${paletteShadeHex(hue, shade).slice(1).toUpperCase()}`
        ) {
          drifted.push(`${hue}/${level}`);
        }
      }
    }
    expect(drifted).toEqual([]);
  });
});
