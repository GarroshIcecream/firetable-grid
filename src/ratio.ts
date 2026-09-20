/**
 * Convert a stored 0..1 ratio to whole percent, flooring rather than rounding.
 *
 * Used for columns flagged `ratioFloor`, where the grid prints the floored
 * percent and a spreadsheet's own `0%` format would round instead — so the
 * export has to carry the already-floored number.
 */
export function ratioToFlooredPercent(value: number): number {
  const scaled = value * 100;
  const nearestWholePercent = Math.round(scaled);
  // These columns are PostgreSQL REAL values. Detect the float32 representation
  // of an exact whole-percent boundary (for example 0.29 stored just below 0.29)
  // without rounding a genuinely fractional score up to that boundary.
  if (Math.fround(value) === Math.fround(nearestWholePercent / 100)) {
    return nearestWholePercent;
  }
  // JS decimal literals can introduce a much smaller float64 boundary error.
  return Math.floor(scaled + Number.EPSILON * Math.abs(scaled));
}
