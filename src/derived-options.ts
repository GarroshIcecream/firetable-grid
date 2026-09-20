import type { RowData } from "@tanstack/react-table";
import type { FilterOption, SchemaColumn } from "./column-schema";

/**
 * Per-row-set memo, so two consumers of the same rows scan them once.
 *
 * The filter popover and the AI prompt catalog both derive options, from
 * overlapping but not identical column lists - without this the same rows are
 * walked twice per column on every page append. Keyed on the rows array's
 * identity (a new array is a new result) and then on column id, which is unique
 * within the table those rows belong to.
 */
const derivedByRows = new WeakMap<object, Map<string, FilterOption[]>>();

/**
 * Enum options derived from the rows actually on screen, for columns flagged
 * `dynamicOptions`. The underlying data varies, so a hard-coded option list would
 * offer values nobody has - and hide values they do. Columns with static
 * `filterOptions` are left alone.
 */
export function buildDerivedOptions<TData extends RowData>(
  columns: readonly SchemaColumn<TData>[],
  rows: readonly TData[] | undefined,
): Map<string, FilterOption[]> {
  const out = new Map<string, FilterOption[]>();
  if (!rows || rows.length === 0) return out;

  let cached = derivedByRows.get(rows);
  if (!cached) {
    cached = new Map<string, FilterOption[]>();
    derivedByRows.set(rows, cached);
  }

  for (const col of columns) {
    if (!col.dynamicOptions) continue;
    if (col.filterOptions && col.filterOptions.length > 0) continue;

    const hit = cached.get(col.id);
    if (hit) {
      out.set(col.id, hit);
      continue;
    }

    const seen = new Set<string>();
    for (const row of rows) {
      const raw = col.getFilterValue
        ? col.getFilterValue(row)
        : (row as Record<string, unknown>)[col.accessorKey ?? col.id];
      if (raw == null) continue;
      const str = String(raw).trim();
      if (!str) continue;
      seen.add(str);
    }
    const opts: FilterOption[] = Array.from(seen)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
    cached.set(col.id, opts);
    out.set(col.id, opts);
  }
  return out;
}
