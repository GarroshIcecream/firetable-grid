// Resolving a view's column layout against a column schema.
//
// Pure, so the rules are testable without rendering anything - `<DataGrid>`
// held these inline and they could only be exercised through a DOM this
// package has no test harness for.

import type { RowData } from "@tanstack/react-table";
import {
  buildVisibility,
  isColumnVisible,
  type SchemaColumn,
} from "./column-schema";
import type { ColumnLayoutState } from "./grid-view";
import { resolvePinnedColumns } from "./layout/model";

/**
 * The columns to render, in order, with hidden ones dropped.
 *
 * A column the order does not mention is appended rather than dropped, so
 * adding one to the schema never makes it silently invisible. When the layout
 * carries no visibility record the schema's own `visible` flags apply - not
 * "everything is visible", which would show columns the schema hides.
 */
export function resolveColumnOrder<TData extends RowData>(
  columns: readonly SchemaColumn<TData>[],
  layout: ColumnLayoutState | undefined,
): SchemaColumn<TData>[] {
  const visibility = layout?.visibility ?? buildVisibility([...columns]);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: SchemaColumn<TData>[] = [];

  for (const id of layout?.order ?? []) {
    const column = byId.get(id);
    if (column && !seen.has(id)) {
      seen.add(id);
      out.push(column);
    }
  }
  for (const column of columns) {
    if (!seen.has(column.id)) out.push(column);
  }
  return out.filter((c) => isColumnVisible(c.id, visibility));
}

/**
 * Which columns are sticky (`pinned`) and which cannot be dragged (`locked`).
 *
 * The schema's `frozen` flag and the view's user pins are one list here. The
 * two results have identical contents today; they diverge only under the
 * `compact` mode `resolvePinnedColumns` supports and this library does not yet
 * expose, where a column stays locked while no longer being sticky.
 */
export function resolveColumnPins<TData extends RowData>(
  columns: readonly SchemaColumn<TData>[],
  layout: ColumnLayoutState | undefined,
): { pinned: string[]; locked: string[] } {
  return resolvePinnedColumns({
    compact: false,
    frozenColumns: columns.filter((c) => c.frozen).map((c) => c.id),
    userPinnedColumns: layout?.pinned,
  });
}
