import { constructTable, type RowData } from "@tanstack/react-table";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";

import { type SchemaColumn, toColumnDefs } from "./column-schema";
import type { SortRule } from "./grid-view";
import { toTanstackSorting } from "./sorting-state";
import { appTableFeatures } from "./tanstack";

/** Rows in the order a view's `sort` puts them. Sorting runs through a
 *  throwaway TanStack table so the exported file and the screen agree on every
 *  comparator, including the schema's per-type ones. */
export function sortRowsForExport<TData extends RowData>(
  rows: readonly TData[],
  sort: readonly SortRule[],
  columns: readonly SchemaColumn<TData>[],
): TData[] {
  if (sort.length === 0) return rows.slice();
  const features = {
    ...appTableFeatures,
    coreReactivityFeature: storeReactivityBindings(),
  };
  const table = constructTable({
    features,
    data: rows.slice(),
    columns: toColumnDefs(columns),
    state: { sorting: toTanstackSorting(sort) },
  });
  return table.getRowModel().rows.map((row) => row.original);
}
