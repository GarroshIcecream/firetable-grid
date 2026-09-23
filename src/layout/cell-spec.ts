// Per-column cell facts, resolved once per column layout instead of once per
// rendered cell.
//
// A naive body loop re-derives all of this inside the `columnLayout.map` that
// runs for every row: several `columnDef.meta` casts, a fresh `style` object
// and a long className template. At 150 visible columns and ~35 rows in the
// virtual window that is ~5,000 repetitions of work whose inputs are the
// *column*, not the row. Hoisting it here leaves the memoized cell component
// with only the genuinely per-row part (the tint and the breakdown).

import type { RowData } from "@tanstack/react-table";
import type { CSSProperties } from "react";
import type { CellBreakdownSpec } from "../breakdown";
import type { CellAlignment } from "../column-vocabulary";
import type { AppHeader } from "../tanstack";
import { type CellPaddingType, cellPaddingClass } from "./cell-padding";
import { cellVerticalAlignClass } from "./cell-vertical-align";
import { columnLeft, columnWidth } from "./geometry";
import {
  CELL_ALIGNMENT_CLASS,
  type ColumnLayoutEntry,
  PINNED_EDGE_BORDER,
  PINNED_INNER_EDGE_SHADOW,
  SELECTION_CELL_PADDING_CLASS,
  SELECTION_COLUMN_ID,
} from "./model";

export type CellMeta<TData extends RowData> = {
  breakdown?: CellBreakdownSpec<TData>;
  cellTint?: (row: TData) => string | undefined;
  type?: CellPaddingType & { cellAlignment?: CellAlignment };
};

/**
 * Shape a placeholder cell takes while the first page loads. Keyed on the
 * column's cell renderer through the map you pass `buildCellSpecs`, so the
 * skeleton reads like the table it is standing in for - a thumbnail column
 * shows a square, a badge column a pill, a number column a short
 * right-aligned bar - instead of one uniform grey bar per cell, which reads
 * as a loading screen rather than as a grid. An unmapped renderer is `text`.
 */
export type SkeletonShape =
  | "image"
  | "pill"
  | "number"
  | "bar"
  | "text"
  | "twoLine"
  | "none";

/** Stable identity for a grid that maps no shapes, so the fallback below
 *  allocates once rather than once per layout. */
const NO_SKELETON_SHAPES: Readonly<Record<string, SkeletonShape>> = {};

export type CellSpec<TData extends RowData> = {
  id: string;
  isPinned: boolean;
  isSelectionCell: boolean;
  /** Class list for everything that depends only on the column. */
  staticClass: string;
  /** Width and sticky offset. Identity is stable per column layout. */
  style: CSSProperties;
  breakdown: CellBreakdownSpec<TData> | undefined;
  cellTint: ((row: TData) => string | undefined) | undefined;
  skeletonShape: SkeletonShape;
};

/** The default `metaOf`: a TanStack header keeps its cell metadata on the
 *  column definition. */
function headerMeta<TData extends RowData>(
  item: AppHeader<TData, unknown>,
): CellMeta<TData> | undefined {
  return item.column.columnDef.meta as CellMeta<TData> | undefined;
}

export interface BuildCellSpecsOptions<
  TData extends RowData = RowData,
  TItem = AppHeader<TData, unknown>,
> {
  wrapCells: boolean;
  /** Reserve the narrow leading gutter for a selection checkbox column. */
  enableSelection?: boolean;
  /** Renderers that take the tight gutter. Empty by default — name yours. */
  denseCellRenderers?: ReadonlySet<string>;
  /** Skeleton shape per renderer. Unknown names fall back to `"text"`. */
  skeletonShapes?: Readonly<Record<string, SkeletonShape>>;
  /**
   * Where a column's cell metadata sits on your layout item.
   *
   * Defaults to the TanStack header shape, `item.column.columnDef.meta`. A
   * `SchemaColumn` already carries `type`, `breakdown` and `cellTint` at its
   * top level, so a schema-driven layout passes `(column) => column` - which is
   * what `<DataGrid>` does. Without this the helper only fit a TanStack-backed
   * table, and the per-column hoist it exists for was unavailable to everyone
   * else.
   */
  metaOf?: (item: TItem) => CellMeta<TData> | undefined;
}

export function buildCellSpecs<
  TData extends RowData,
  TItem = AppHeader<TData, unknown>,
>(
  columnLayout: readonly ColumnLayoutEntry<TItem>[],
  {
    wrapCells,
    enableSelection = false,
    denseCellRenderers,
    skeletonShapes,
    metaOf = headerMeta as unknown as (item: TItem) => CellMeta<TData>,
  }: BuildCellSpecsOptions<TData, TItem>,
): CellSpec<TData>[] {
  const shapes = skeletonShapes ?? NO_SKELETON_SHAPES;
  const verticalAlign = cellVerticalAlignClass(wrapCells);
  const wrapClass = wrapCells
    ? "whitespace-normal wrap-break-word"
    : "whitespace-nowrap";

  return columnLayout.map((layout) => {
    const meta = metaOf(layout.item);
    const isSelectionCell =
      enableSelection && layout.id === SELECTION_COLUMN_ID;
    const cellType = meta?.type;
    const padding = isSelectionCell
      ? SELECTION_CELL_PADDING_CLASS
      : cellPaddingClass(cellType, denseCellRenderers);
    const edge = layout.isLastPinned
      ? PINNED_EDGE_BORDER
      : layout.isPinned
        ? PINNED_INNER_EDGE_SHADOW
        : "";
    const cellAlignment = cellType?.cellAlignment;

    return {
      id: layout.id,
      isPinned: layout.isPinned,
      isSelectionCell,
      staticClass: `${padding} py-2 ${verticalAlign} overflow-hidden text-ellipsis ${wrapClass} ${
        layout.isPinned ? "sticky z-10" : ""
      } ${edge} ${cellAlignment ? CELL_ALIGNMENT_CLASS[cellAlignment] : ""}`,
      style: {
        width: columnWidth(layout.id, layout.size),
        minWidth: columnWidth(layout.id, layout.size),
        maxWidth: columnWidth(layout.id, layout.size),
        ...(layout.stickyLeft !== undefined
          ? { left: columnLeft(layout.id, layout.stickyLeft) }
          : {}),
      },
      breakdown: isSelectionCell ? undefined : meta?.breakdown,
      cellTint: meta?.cellTint,
      skeletonShape: isSelectionCell
        ? "none"
        : (shapes[cellType?.cellRenderer ?? ""] ?? "text"),
    };
  });
}
