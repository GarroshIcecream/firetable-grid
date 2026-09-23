import type {
  AggregationType,
  ColumnType,
  NumberFormat,
} from "./column-vocabulary";

/**
 * The slice of a locale-aware number formatter this module needs. Declared
 * structurally so the engine does not depend on an i18n library — next-intl's
 * `useFormatter()` return value satisfies it as-is.
 */
export interface NumberFormatter {
  number(value: number, options?: Intl.NumberFormatOptions): string;
}

export function formatFooterAggregate(
  value: number | null,
  aggregation: AggregationType,
  column:
    | { type?: ColumnType; numberFormat?: NumberFormat; decimals?: number }
    | undefined,
  formatter: NumberFormatter,
): string {
  if (value === null) return "—";
  if (
    aggregation !== "count" &&
    (column?.type?.unit === "percentage_points" ||
      column?.numberFormat === "percent")
  ) {
    // The API already scales margin and price deltas to percentage points;
    // progress scores retain their stored ratio in both rows and aggregates.
    return formatter.number(column?.type?.ratioStored ? value : value / 100, {
      style: "percent",
      maximumFractionDigits: column?.decimals ?? 2,
    });
  }
  // A count is a whole number of rows whatever precision the column's own
  // values carry, so `decimals` does not reach it.
  return formatter.number(value, {
    maximumFractionDigits:
      aggregation === "count" ? 0 : (column?.decimals ?? 0),
  });
}
