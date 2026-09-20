// Zod validation for the stored threshold JSONB. The model itself, and the
// resolvers the grid calls per cell, live in `./threshold` — keeping them apart
// is what keeps zod out of the client bundle.

import { z } from "zod";

import {
  normalizeThresholdColor,
  THRESHOLD_HUES,
  THRESHOLD_LEVELS,
} from "./threshold";

export const thresholdColorSchema = z.preprocess(
  normalizeThresholdColor,
  z.object({
    hue: z.enum(THRESHOLD_HUES),
    level: z.enum(THRESHOLD_LEVELS),
  }),
);

const thresholdBucketSchema = z.object({
  upTo: z.number().finite(),
  color: thresholdColorSchema,
});

const thresholdCatchAllSchema = z.object({
  color: thresholdColorSchema,
});

// At least one entry; the last entry must be a catch-all (no `upTo`); every
// preceding entry must have a strictly increasing `upTo`.
export const thresholdListSchema = z
  .array(z.union([thresholdBucketSchema, thresholdCatchAllSchema]))
  .min(1)
  .superRefine((items, ctx) => {
    const last = items[items.length - 1];
    if (last === undefined || "upTo" in last) {
      ctx.addIssue({
        code: "custom",
        message: "Last threshold must be a catch-all (no upTo).",
        path: [items.length - 1],
      });
    }
    for (let i = 0; i < items.length - 1; i++) {
      const entry = items[i];
      if (entry === undefined || !("upTo" in entry)) {
        ctx.addIssue({
          code: "custom",
          message: "Only the last threshold may omit upTo.",
          path: [i],
        });
        continue;
      }
      if (i > 0) {
        const prev = items[i - 1];
        if (prev && "upTo" in prev && entry.upTo <= prev.upTo) {
          ctx.addIssue({
            code: "custom",
            message: "upTo values must be strictly increasing.",
            path: [i, "upTo"],
          });
        }
      }
    }
  });

/**
 * A staged, whole-day threshold list: `bucketCount - 1` ordered day bounds plus
 * a trailing catch-all. Use it for a status indicator whose stages are fixed
 * and measured in days — "due in 7 / 14 / 30 days, then overdue" — where a
 * fractional bound would be meaningless.
 *
 * @param bucketCount total buckets including the catch-all. Must be at least 2.
 * @param label how the buckets are named in validation messages.
 */
export function stagedDayThresholdListSchema(
  bucketCount: number,
  label = "This threshold list",
) {
  if (!Number.isInteger(bucketCount) || bucketCount < 2) {
    throw new RangeError("bucketCount must be a whole number of at least 2.");
  }
  return thresholdListSchema.superRefine((items, ctx) => {
    if (items.length !== bucketCount) {
      ctx.addIssue({
        code: "custom",
        message: `${label} requires exactly ${bucketCount} thresholds.`,
      });
      return;
    }

    for (let index = 0; index < items.length - 1; index++) {
      const entry = items[index];
      if (
        entry &&
        "upTo" in entry &&
        (!Number.isInteger(entry.upTo) || entry.upTo < 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `${label} bounds must be whole, non-negative days.`,
          path: [index, "upTo"],
        });
      }
    }
  });
}
