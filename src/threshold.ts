// Threshold model and renderer-side resolvers for the Column Registry.
//
// Deliberately zod-free, and split out of `threshold-schema.ts` for that reason:
// `columns.tsx` imports `resolveThresholdColor` on every cell render, so a zod
// schema in the same module put the whole of zod (~388 KB raw) into the grid
// route's client bundle. Validation of the stored JSONB stays next door, on the
// server and in the registry editors that actually parse it.

import {
  gridTheme,
  HUES,
  type Hue,
  LEVELS,
  type PaletteColor,
} from "./palette";

export const THRESHOLD_HUES = HUES;

export const THRESHOLD_LEVELS = LEVELS;

export type ThresholdColor = PaletteColor;

interface ThresholdBucket {
  readonly upTo: number;
  readonly color: ThresholdColor;
}

interface ThresholdCatchAll {
  readonly color: ThresholdColor;
}

export type Threshold = ThresholdBucket | ThresholdCatchAll;

export type ThresholdList = readonly Threshold[];

const LEGACY_HUE_MAP: Record<string, Hue> = {
  success: "green",
  warning: "orange",
  destructive: "red",
  neutral: "gray",
};

/** Migrates the pre-palette `{hue: "success", tone: "bold"}` shape forward.
 *  Consumed by `thresholdColorSchema`'s `z.preprocess`. */
export function normalizeThresholdColor(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...obj };

  if (typeof next.hue === "string" && next.hue in LEGACY_HUE_MAP) {
    next.hue = LEGACY_HUE_MAP[next.hue];
  }

  if (!("level" in next) && typeof next.tone === "string") {
    if (next.tone === "bold") next.level = "dark";
    else if (next.tone === "subtle") next.level = "light";
  }

  return next;
}

/** The colour a `neutralZero` column's exact zero resolves to. */
export const NEUTRAL_THRESHOLD_COLOR: ThresholdColor = {
  hue: "gray",
  level: "dark",
};

export interface ThresholdResolveOptions {
  /** Exactly 0 is "no change", not a point on the scale: it resolves to
   *  `NEUTRAL_THRESHOLD_COLOR` whatever the buckets say. Pass the column
   *  type's `neutralZero`. */
  readonly neutralZero?: boolean;
}

// Renderer-side resolver: pick the first bucket whose `upTo` is `>= value`;
// fall through to the trailing catch-all when no bucket matches.
//
// `value === null` is the renderer's responsibility - the registry returns
// the same threshold list regardless of cell value.
export function resolveThresholdColor(
  value: number,
  thresholds: ThresholdList,
  options?: ThresholdResolveOptions,
): ThresholdColor {
  // A trend's `{ upTo: 0, red }` bucket would otherwise paint "unchanged" as
  // a decline.
  if (options?.neutralZero && value === 0) return NEUTRAL_THRESHOLD_COLOR;
  for (const t of thresholds) {
    if ("upTo" in t) {
      if (value <= t.upTo) return t.color;
    } else {
      return t.color;
    }
  }
  // Schema guarantees a catch-all exists; this is a defensive fallback only
  // for the brief window between an admin reordering rules and the schema
  // re-validating.
  return { hue: "gray", level: "dark" };
}

export function thresholdBgClass(color: ThresholdColor): string {
  return gridTheme().palette[color.hue][color.level].bg;
}

/**
 * The foreground class paired with `thresholdBgClass` for the same colour.
 *
 * Always use the pair. A light level resolves to a pale fill that needs dark
 * text, a dark level to a saturated fill that needs white — setting only the
 * background leaves the text at whatever it inherited, which goes unreadable
 * on one half of the scale.
 */
export function thresholdTextClass(color: ThresholdColor): string {
  return gridTheme().palette[color.hue][color.level].text;
}

/** Both classes for a threshold colour, ready to drop into a class list. */
export function thresholdClasses(color: ThresholdColor): string {
  return `${thresholdBgClass(color)} ${thresholdTextClass(color)}`;
}

// Pure equality check used by editors to detect unsaved draft changes.
// Defined here (rather than inside the editor component) so it can be tested
// independently of React.
export function areThresholdsEqual(
  a: ThresholdList | undefined,
  b: ThresholdList | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    const xUp = "upTo" in x ? x.upTo : null;
    const yUp = "upTo" in y ? y.upTo : null;
    if (xUp !== yUp) return false;
    if (x.color.hue !== y.color.hue) return false;
    if (x.color.level !== y.color.level) return false;
  }
  return true;
}
