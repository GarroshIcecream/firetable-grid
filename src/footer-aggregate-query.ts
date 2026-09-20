import { isColumnVisible } from "./column-schema";
import type { AggregationType } from "./column-vocabulary";

type FooterAggregateColumn = {
  id: string;
  type: { aggregatable: boolean };
};

type FooterAggregateMetric = {
  id: string;
  kind: AggregationType;
  field: string;
  scope: "visible";
};

/**
 * Selections combine saved defaults with temporary user overrides. Only
 * visible, eligible columns trigger calculations over the full filtered set.
 */
export function buildFooterAggregateQuery(
  selections: Readonly<Record<string, AggregationType>>,
  columns: readonly FooterAggregateColumn[],
  columnVisibility: Readonly<Record<string, boolean>>,
): { enabled: boolean; metrics: FooterAggregateMetric[] } {
  if (Object.keys(selections).length === 0) {
    return { enabled: false, metrics: [] };
  }

  const metrics: FooterAggregateMetric[] = columns
    .filter(
      (column) =>
        column.type.aggregatable &&
        isColumnVisible(column.id, columnVisibility) &&
        selections[column.id] !== undefined,
    )
    .map((column) => ({
      id: `footer:${column.id}`,
      kind: selections[column.id] as AggregationType,
      field: column.id,
      scope: "visible",
    }));

  return { enabled: metrics.length > 0, metrics };
}
