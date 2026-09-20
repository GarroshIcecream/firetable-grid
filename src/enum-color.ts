// Enum-value colour mapping used by the Column Registry.
//
// Parallel to the numeric threshold system but for categorical (string) column
// values - e.g. "Active" → success, "Paused" → warning, "Sold" → neutral.
// Zod-free for the same reason as `./threshold`: the grid's cell renderers
// import `resolveEnumColor`, and validation belongs in `./enum-color-schema`.

import type { ThresholdColor } from "./threshold";

interface EnumColorEntry {
  readonly value: string;
  readonly color: ThresholdColor;
}

export type EnumColorMap = readonly EnumColorEntry[];

// Returns the configured colour for `value`, or undefined when the map has no
// entry for that value (the renderer falls back to its hardcoded default).
export function resolveEnumColor(
  value: string | null,
  map: EnumColorMap,
): ThresholdColor | undefined {
  if (!value) return undefined;
  return map.find((e) => e.value === value)?.color;
}

export function areEnumColorsEqual(
  a: EnumColorMap | undefined,
  b: EnumColorMap | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      entry.value === other.value &&
      entry.color.hue === other.color.hue &&
      entry.color.level === other.color.level
    );
  });
}
