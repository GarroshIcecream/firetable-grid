import { afterEach, describe, expect, test } from "bun:test";
import {
  configureGridTheme,
  DEFAULT_PALETTE,
  gridTheme,
  HUES,
  LEVELS,
  paletteFillArgb,
  paletteShadeHex,
  paletteTextArgb,
  resetGridTheme,
  thresholdBgClass,
  thresholdClasses,
  thresholdTextClass,
} from "../src";
import { stagedDayThresholdListSchema } from "../src/schema";

afterEach(resetGridTheme);

describe("theme overrides", () => {
  test("defaults resolve without any configuration", () => {
    expect(gridTheme().palette).toBe(DEFAULT_PALETTE);
    expect(gridTheme().baseHex.red).toBe("#ed2939");
  });

  test("a palette override changes the class a threshold renders with", () => {
    const before = thresholdBgClass({ hue: "red", level: "dark" });
    configureGridTheme({
      palette: {
        ...DEFAULT_PALETTE,
        red: {
          ...DEFAULT_PALETTE.red,
          dark: { ...DEFAULT_PALETTE.red.dark, bg: "bg-brand-danger" },
        },
      },
    });
    expect(thresholdBgClass({ hue: "red", level: "dark" })).toBe(
      "bg-brand-danger",
    );
    expect(thresholdBgClass({ hue: "red", level: "dark" })).not.toBe(before);
  });

  test("a baseHex override re-derives every shade of that hue", () => {
    const before = paletteShadeHex("green", 50);
    configureGridTheme({
      baseHex: { ...gridTheme().baseHex, green: "#00ff00" },
    });
    expect(paletteShadeHex("green", 50)).not.toBe(before);
    // Shade 50 is the base itself (weight 1), so it round-trips exactly.
    expect(paletteShadeHex("green", 50)).toBe("#00ff00");
  });

  test("overrides are partial - an untouched key keeps its default", () => {
    configureGridTheme({ baseHex: { ...gridTheme().baseHex, red: "#000000" } });
    expect(gridTheme().palette).toBe(DEFAULT_PALETTE);
  });

  test("reset restores the shipped defaults", () => {
    configureGridTheme({ baseHex: { ...gridTheme().baseHex, red: "#000000" } });
    resetGridTheme();
    expect(gridTheme().baseHex.red).toBe("#ed2939");
  });

  test("export colours follow a rebrand, not the first theme they saw", () => {
    // Shade and ARGB lookups are memoized per theme - the xlsx writer asks for
    // one per coloured cell. Warm the caches, then confirm reconfiguring and
    // resetting both retire them.
    const color = { hue: "green", level: "dark" } as const;
    const defaultFill = paletteFillArgb(color);
    const defaultText = paletteTextArgb(color);

    configureGridTheme({
      baseHex: { ...gridTheme().baseHex, green: "#00ff00" },
    });
    expect(paletteFillArgb(color)).not.toBe(defaultFill);

    resetGridTheme();
    expect(paletteFillArgb(color)).toBe(defaultFill);
    expect(paletteTextArgb(color)).toBe(defaultText);
  });
});

describe("stagedDayThresholdListSchema", () => {
  const schema = stagedDayThresholdListSchema(4, "Check status");
  const bucket = (upTo: number) => ({
    upTo,
    color: { hue: "green", level: "dark" } as const,
  });
  const tail = { color: { hue: "red", level: "dark" } as const };

  test("accepts the configured number of buckets", () => {
    expect(
      schema.safeParse([bucket(7), bucket(14), bucket(30), tail]).success,
    ).toBe(true);
  });

  test("rejects the wrong bucket count, naming the label", () => {
    const result = schema.safeParse([bucket(7), tail]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Check status requires exactly 4 thresholds.",
      );
    }
  });

  test("rejects a fractional day bound", () => {
    const result = schema.safeParse([
      bucket(7.5),
      bucket(14),
      bucket(30),
      tail,
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("whole, non-negative");
    }
  });

  test("the bucket count is configurable", () => {
    const three = stagedDayThresholdListSchema(3);
    expect(three.safeParse([bucket(7), bucket(14), tail]).success).toBe(true);
    expect(
      three.safeParse([bucket(7), bucket(14), bucket(30), tail]).success,
    ).toBe(false);
  });

  test("refuses a nonsensical bucket count at construction", () => {
    expect(() => stagedDayThresholdListSchema(1)).toThrow(RangeError);
  });
});

describe("threshold colour classes", () => {
  test("bg and text are returned as a readable pair", () => {
    // A light fill needs dark text; a dark fill needs near-white. Shipping only
    // the background leaves the text at whatever it inherited.
    const light = { hue: "blue", level: "light" } as const;
    const dark = { hue: "blue", level: "dark" } as const;
    expect(thresholdBgClass(light)).toBe("bg-blue-10");
    expect(thresholdTextClass(light)).toBe("text-blue-80");
    expect(thresholdTextClass(dark)).toBe("text-white");
    expect(thresholdClasses(light)).toBe("bg-blue-10 text-blue-80");
  });

  test("every hue and level has both halves", () => {
    for (const hue of HUES) {
      for (const level of LEVELS) {
        const color = { hue, level };
        expect(thresholdBgClass(color)).toStartWith("bg-");
        expect(thresholdTextClass(color)).toStartWith("text-");
      }
    }
  });

  test("the text class follows a palette override too", () => {
    configureGridTheme({
      palette: {
        ...DEFAULT_PALETTE,
        blue: {
          ...DEFAULT_PALETTE.blue,
          light: { ...DEFAULT_PALETTE.blue.light, text: "text-brand-ink" },
        },
      },
    });
    expect(thresholdTextClass({ hue: "blue", level: "light" })).toBe(
      "text-brand-ink",
    );
  });
});
