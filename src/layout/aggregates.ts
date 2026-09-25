import type { AggregationType } from "../column-vocabulary";

export interface RowsAggregation<TData> {
  key: string;
  aggregation: AggregationType;
  read?: (row: TData) => unknown;
}

/** Aggregate requested columns in one row traversal, returning results in request order.
 * Reads use the same number-only semantics as computeRowsAgg, including NaN. */
export function computeRowsAggregates<TData>(
  rows: readonly TData[],
  requests: readonly RowsAggregation<TData>[],
): Array<number | null> {
  if (requests.length === 0) return [];
  const counts = new Float64Array(requests.length);
  const values = Float64Array.from(requests, ({ aggregation }) =>
    aggregation === "min" ? Infinity : aggregation === "max" ? -Infinity : 0,
  );
  for (const row of rows) {
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const value = request.read
        ? request.read(row)
        : (row as Record<string, unknown>)[request.key];
      if (typeof value !== "number") continue;
      counts[i]++;
      switch (request.aggregation) {
        case "sum":
        case "avg":
          values[i] += value;
          break;
        case "min":
          if (value < values[i]) values[i] = value;
          break;
        case "max":
          if (value > values[i]) values[i] = value;
          break;
      }
    }
  }
  return Array.from(values, (value, i) => {
    if (counts[i] === 0) return null;
    if (requests[i].aggregation === "count") return counts[i];
    return requests[i].aggregation === "avg" ? value / counts[i] : value;
  });
}
