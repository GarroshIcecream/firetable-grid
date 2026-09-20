import { describe, expect, test } from "bun:test";
import {
  areThresholdsEqual,
  resolveThresholdColor,
  thresholdColorSchema,
  thresholdListSchema,
} from "../src";

describe("thresholdListSchema", () => {
  const valid = [
    { upTo: 0.33, color: { hue: "green", level: "dark" } },
    { upTo: 0.66, color: { hue: "orange", level: "dark" } },
    { color: { hue: "red", level: "dark" } },
  ];

  test("accepts a well-formed list", () => {
    expect(thresholdListSchema.safeParse(valid).success).toBe(true);
  });

  test("accepts a catch-all-only list (single entry)", () => {
    expect(
      thresholdListSchema.safeParse([{ color: { hue: "gray", level: "dark" } }])
        .success,
    ).toBe(true);
  });

  test("rejects empty array", () => {
    expect(thresholdListSchema.safeParse([]).success).toBe(false);
  });

  test("rejects list where last entry has upTo (no catch-all)", () => {
    expect(
      thresholdListSchema.safeParse([
        { upTo: 10, color: { hue: "green", level: "dark" } },
        { upTo: 20, color: { hue: "orange", level: "dark" } },
      ]).success,
    ).toBe(false);
  });

  test("rejects catch-all in non-last position", () => {
    expect(
      thresholdListSchema.safeParse([
        { color: { hue: "green", level: "dark" } },
        { upTo: 20, color: { hue: "orange", level: "dark" } },
      ]).success,
    ).toBe(false);
  });

  test("rejects non-monotonic upTo values", () => {
    expect(
      thresholdListSchema.safeParse([
        { upTo: 50, color: { hue: "green", level: "dark" } },
        { upTo: 30, color: { hue: "orange", level: "dark" } },
        { color: { hue: "red", level: "dark" } },
      ]).success,
    ).toBe(false);
  });

  test("rejects equal upTo values (must be strictly increasing)", () => {
    expect(
      thresholdListSchema.safeParse([
        { upTo: 30, color: { hue: "green", level: "dark" } },
        { upTo: 30, color: { hue: "orange", level: "dark" } },
        { color: { hue: "red", level: "dark" } },
      ]).success,
    ).toBe(false);
  });

  test("rejects unknown hue", () => {
    expect(
      thresholdListSchema.safeParse([
        { upTo: 30, color: { hue: "chartreuse", level: "dark" } },
        { color: { hue: "red", level: "dark" } },
      ]).success,
    ).toBe(false);
  });

  test("rejects unknown level", () => {
    expect(
      thresholdListSchema.safeParse([
        { color: { hue: "green", level: "italic" } },
      ]).success,
    ).toBe(false);
  });

  test("rejects Infinity as upTo", () => {
    expect(
      thresholdListSchema.safeParse([
        { upTo: Infinity, color: { hue: "green", level: "dark" } },
        { color: { hue: "red", level: "dark" } },
      ]).success,
    ).toBe(false);
  });
});

describe("thresholdColorSchema legacy migration", () => {
  test("maps tone=bold to level=dark", () => {
    const result = thresholdColorSchema.parse({ hue: "blue", tone: "bold" });
    expect(result).toEqual({ hue: "blue", level: "dark" });
  });

  test("maps tone=subtle to level=light", () => {
    const result = thresholdColorSchema.parse({ hue: "blue", tone: "subtle" });
    expect(result).toEqual({ hue: "blue", level: "light" });
  });

  test("maps semantic alias success → green", () => {
    const result = thresholdColorSchema.parse({ hue: "success", tone: "bold" });
    expect(result).toEqual({ hue: "green", level: "dark" });
  });

  test("maps semantic alias warning → orange", () => {
    const result = thresholdColorSchema.parse({ hue: "warning", tone: "bold" });
    expect(result).toEqual({ hue: "orange", level: "dark" });
  });

  test("maps semantic alias destructive → red", () => {
    const result = thresholdColorSchema.parse({
      hue: "destructive",
      tone: "subtle",
    });
    expect(result).toEqual({ hue: "red", level: "light" });
  });

  test("maps semantic alias neutral → gray", () => {
    const result = thresholdColorSchema.parse({ hue: "neutral", tone: "bold" });
    expect(result).toEqual({ hue: "gray", level: "dark" });
  });

  test("passes modern shape through unchanged", () => {
    const result = thresholdColorSchema.parse({
      hue: "violet",
      level: "medium",
    });
    expect(result).toEqual({ hue: "violet", level: "medium" });
  });

  test("normalizes alias hue when level is already present", () => {
    const result = thresholdColorSchema.parse({
      hue: "success",
      level: "medium",
    });
    expect(result).toEqual({ hue: "green", level: "medium" });
  });

  test("level wins over tone when both are present (mixed shape)", () => {
    const result = thresholdColorSchema.parse({
      hue: "blue",
      tone: "subtle",
      level: "dark",
    });
    expect(result).toEqual({ hue: "blue", level: "dark" });
  });

  test("rejects legacy shape with unrecognised tone (no silent coercion)", () => {
    const result = thresholdColorSchema.safeParse({
      hue: "blue",
      tone: "outline",
    });
    expect(result.success).toBe(false);
  });

  test("thresholdListSchema accepts legacy threshold list and normalizes", () => {
    const legacy = [
      { upTo: 30, color: { hue: "success", tone: "bold" } },
      { upTo: 60, color: { hue: "warning", tone: "subtle" } },
      { color: { hue: "destructive", tone: "bold" } },
    ];
    const result = thresholdListSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toEqual({
        upTo: 30,
        color: { hue: "green", level: "dark" },
      });
      expect(result.data[1]).toEqual({
        upTo: 60,
        color: { hue: "orange", level: "light" },
      });
      expect(result.data[2]).toEqual({
        color: { hue: "red", level: "dark" },
      });
    }
  });
});

describe("resolveThresholdColor", () => {
  const thresholds = [
    { upTo: 30, color: { hue: "green" as const, level: "dark" as const } },
    { upTo: 60, color: { hue: "orange" as const, level: "dark" as const } },
    { color: { hue: "red" as const, level: "dark" as const } },
  ];

  test("returns first bucket colour when value is below its upTo", () => {
    expect(resolveThresholdColor(20, thresholds)).toEqual({
      hue: "green",
      level: "dark",
    });
  });

  test("returns first bucket colour when value equals its upTo (inclusive)", () => {
    expect(resolveThresholdColor(30, thresholds)).toEqual({
      hue: "green",
      level: "dark",
    });
  });

  test("returns second bucket colour when value is in second range", () => {
    expect(resolveThresholdColor(45, thresholds)).toEqual({
      hue: "orange",
      level: "dark",
    });
  });

  test("returns catch-all colour when value exceeds all upTo", () => {
    expect(resolveThresholdColor(100, thresholds)).toEqual({
      hue: "red",
      level: "dark",
    });
  });

  test("returns catch-all when list has only a catch-all", () => {
    const catchAllOnly = [
      { color: { hue: "gray" as const, level: "dark" as const } },
    ];
    expect(resolveThresholdColor(999, catchAllOnly)).toEqual({
      hue: "gray",
      level: "dark",
    });
  });
});

describe("areThresholdsEqual", () => {
  const a = [
    { upTo: 30, color: { hue: "green" as const, level: "dark" as const } },
    { color: { hue: "red" as const, level: "dark" as const } },
  ];
  const b = [
    { upTo: 30, color: { hue: "green" as const, level: "dark" as const } },
    { color: { hue: "red" as const, level: "dark" as const } },
  ];

  test("returns true for identical structure", () => {
    expect(areThresholdsEqual(a, b)).toBe(true);
  });

  test("returns true for same reference", () => {
    expect(areThresholdsEqual(a, a)).toBe(true);
  });

  test("returns false when upTo differs", () => {
    const c = [
      { upTo: 50, color: { hue: "green" as const, level: "dark" as const } },
      { color: { hue: "red" as const, level: "dark" as const } },
    ];
    expect(areThresholdsEqual(a, c)).toBe(false);
  });

  test("returns false when hue differs", () => {
    const c = [
      { upTo: 30, color: { hue: "orange" as const, level: "dark" as const } },
      { color: { hue: "red" as const, level: "dark" as const } },
    ];
    expect(areThresholdsEqual(a, c)).toBe(false);
  });

  test("returns false when level differs", () => {
    const c = [
      { upTo: 30, color: { hue: "green" as const, level: "light" as const } },
      { color: { hue: "red" as const, level: "dark" as const } },
    ];
    expect(areThresholdsEqual(a, c)).toBe(false);
  });

  test("returns false when lengths differ", () => {
    const c = [
      { upTo: 30, color: { hue: "green" as const, level: "dark" as const } },
      { upTo: 60, color: { hue: "orange" as const, level: "dark" as const } },
      { color: { hue: "red" as const, level: "dark" as const } },
    ];
    expect(areThresholdsEqual(a, c)).toBe(false);
  });

  test("returns false when one side is undefined", () => {
    expect(areThresholdsEqual(a, undefined)).toBe(false);
    expect(areThresholdsEqual(undefined, b)).toBe(false);
  });

  test("returns true when both are undefined", () => {
    expect(areThresholdsEqual(undefined, undefined)).toBe(true);
  });
});
