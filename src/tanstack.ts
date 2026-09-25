// The repo's TanStack Table v9 feature set, declared once.
//
// v9 no longer ships every feature to every table: a table gets exactly the
// features it is handed, and every generic (`ColumnDef`, `Row`, `Cell`, ...)
// takes that feature set as its FIRST type argument. `stockFeatures` would
// restore the v8 everything-included behaviour, but it defeats the
// tree-shaking v9 exists for - so this lists the five features the grid
// actually uses, and the aliases below spare every call site from repeating
// `typeof appTableFeatures` in its generics.
//
// A missing feature surfaces as a missing method on the table/column type
// (`column.getSize is not a function` at the type level), so adding one here
// is the fix when a new call site needs it.

import type {
  Cell,
  CellContext,
  ColumnDef,
  Header,
  Row,
  RowData,
  SortFn,
} from "@tanstack/react-table";
import {
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/table-core";

export const appTableFeatures = tableFeatures({
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

type AppTableFeatures = typeof appTableFeatures;

export type AppColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<
  AppTableFeatures,
  TData,
  TValue
>;
export type AppRow<TData extends RowData> = Row<AppTableFeatures, TData>;
export type AppCell<TData extends RowData, TValue = unknown> = Cell<
  AppTableFeatures,
  TData,
  TValue
>;
export type AppHeader<TData extends RowData, TValue = unknown> = Header<
  AppTableFeatures,
  TData,
  TValue
>;
export type AppCellContext<
  TData extends RowData,
  TValue = unknown,
> = CellContext<AppTableFeatures, TData, TValue>;
export type AppSortFn<TData extends RowData> = SortFn<AppTableFeatures, TData>;
