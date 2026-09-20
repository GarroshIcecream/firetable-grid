import {
  constructTable,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";

import { type SchemaColumn, toColumnDefs } from "./column-schema";
import { appTableFeatures } from "./tanstack";

export function sortRowsForExport<TData extends RowData>(
  rows: readonly TData[],
  sorting: SortingState,
  columns: readonly SchemaColumn<TData>[],
): TData[] {
  if (sorting.length === 0) return rows.slice();
  const features = {
    ...appTableFeatures,
    coreReactivityFeature: storeReactivityBindings(),
  };
  const table = constructTable({
    features,
    data: rows.slice(),
    columns: toColumnDefs(columns),
    state: { sorting },
  });
  return table.getRowModel().rows.map((row) => row.original);
}
