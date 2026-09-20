// Code defaults for threshold-aware renderers. They sit next to the threshold
// model rather than next to any column catalogue, so several tables can share
// a renderer's defaults without depending on each other's column metadata.
// A settings UI can offer these as the "Reset to default" target.

import type { ThresholdList } from "./threshold";

export const ATTENTION_DEFAULT_THRESHOLDS: ThresholdList = [
  { upTo: 0.33, color: { hue: "green", level: "dark" } },
  { upTo: 0.66, color: { hue: "orange", level: "dark" } },
  { color: { hue: "red", level: "dark" } },
];

export const SCORE_DEFAULT_THRESHOLDS: ThresholdList = [
  { upTo: 0.33, color: { hue: "red", level: "dark" } },
  { upTo: 0.66, color: { hue: "orange", level: "dark" } },
  { color: { hue: "green", level: "dark" } },
];

// Quality-score bars (photo/equipment): a "good" score sits higher than the
// generic SCORE default, so the bar reads red below 0.6, amber 0.6-0.8, and
// green only from 0.8 up.
export const QUALITY_SCORE_DEFAULT_THRESHOLDS: ThresholdList = [
  { upTo: 0.6, color: { hue: "red", level: "dark" } },
  { upTo: 0.8, color: { hue: "orange", level: "dark" } },
  { color: { hue: "green", level: "dark" } },
];

// Price-percentile bar: quartile-based, low percentile is best (the car sits
// near the cheap end of the comparable distribution), so the scale
// runs green → red as the percentile rises.
export const PRICE_PERCENTILE_DEFAULT_THRESHOLDS: ThresholdList = [
  { upTo: 0.25, color: { hue: "green", level: "dark" } },
  { upTo: 0.5, color: { hue: "yellow", level: "dark" } },
  { upTo: 0.75, color: { hue: "orange", level: "dark" } },
  { color: { hue: "red", level: "dark" } },
];

export const DAYS_DEFAULT_THRESHOLDS: ThresholdList = [
  { upTo: 30, color: { hue: "green", level: "dark" } },
  { upTo: 60, color: { hue: "orange", level: "dark" } },
  { color: { hue: "red", level: "dark" } },
];

// Trend cell default - sign-based: negative bucket (`upTo: 0`) renders
// destructive, positive (catch-all) renders success. The renderer
// special-cases `v === 0` and `null` so the destructive bucket never
// matches exactly zero in practice.
export const TREND_DEFAULT_THRESHOLDS: ThresholdList = [
  { upTo: 0, color: { hue: "red", level: "dark" } },
  { color: { hue: "green", level: "dark" } },
];
