// Display position for the `#` column.
//
// TanStack's `row.index` is "the index of the row within its parent array (or
// the root data array)" — i.e. the position in the UNFILTERED data. Rendering
// `row.index + 1` therefore produces gaps as soon as anything is filtered out:
// filtering 10 rows down to 4 shows "1, 4, 7, 10" instead of "1, 2, 3, 4". The
// `#` column is documented as "Sequential row position", so it has to count the
// rows the user can actually see.
//
// `table.getRowModel().rows` is the post-filter, post-sort list the table
// renders, so a row's position in THAT array is the sequential number. The
// lookup travels to the cell through `table.options.meta` (the channel
// `wrapCells` already uses) rather than a prop threaded through every column
// definition — but inside a mutable holder, because `meta` is captured when the
// table is created and the row model only resolves afterwards.

// Generic over the feature set rather than pinned to `appTableFeatures`: these
// helpers only read `row.id`, `row.index` and `table.options.meta`, all of
// which are core in v9. Pinning them would stop any table with a different
// feature set (a test harness, a future surface) from using the `#` column.
import type { Row, RowData, Table, TableFeatures } from "@tanstack/react-table";

import type { FlatItem } from "./model";

export const ROW_INDEX_TEXT_CLASS =
  "text-muted-foreground text-[11px] tabular-nums";

/** Mutable holder for the lookup. A `useRef` satisfies this. */
type RowPositionsHolder = {
  current: ReadonlyMap<string, number>;
};

/** `meta` contract for the display-position lookup. Structural, so each table
 *  spreads it into its own `meta` object without needing a shared type. */
type RowPositionMeta = {
  rowPositions?: RowPositionsHolder;
};

export const EMPTY_ROW_POSITIONS: ReadonlyMap<string, number> = new Map();

/**
 * Build display positions from the table's visual row order.
 *
 * When grouping is on, `buildFlatItems` regroups rows for rendering; the
 * post-sort `getRowModel().rows` order no longer matches what the user sees.
 * Count in flat-item order so the `#` column stays 1..n on screen.
 */
export function buildRowPositionsFromFlatItems<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(
  flatItems: readonly FlatItem[],
  rows: readonly Row<TFeatures, TData>[],
): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  let position = 0;
  for (const item of flatItems) {
    if (item.type !== "row") continue;
    const row = rows[item.rowIndex];
    if (row) positions.set(row.id, ++position);
  }
  return positions;
}

/**
 * The number to render in the `#` cell.
 *
 * Falls back to `row.index + 1` when no lookup is present (a table that hasn't
 * opted in, or a Storybook render), which preserves the previous behaviour
 * instead of rendering a blank cell.
 */
export function displayRowPosition<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(table: Table<TFeatures, TData>, row: Row<TFeatures, TData>): number {
  const meta = table.options.meta as RowPositionMeta | undefined;
  return meta?.rowPositions?.current.get(row.id) ?? row.index + 1;
}
