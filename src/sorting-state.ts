// Multi-column sort state, in the engine's own vocabulary: `{ field, dir }`,
// matching the `field` a filter condition names and reading as itself in stored
// JSON.
//
// TanStack's `{ id, desc }` is a rendering detail of one consumer, so it is
// confined to `toTanstackSorting` / `fromTanstackSorting` at the bottom of this
// file. Nothing else in the engine — not the grid, not the export path — has to
// know that shape exists.

import type { SortingState } from "@tanstack/react-table";
import type { SortDirection, SortRule } from "./grid-view";

export const MAX_SORT_COLUMNS = 5;

export interface ColumnSortState {
  dir: SortDirection;
  /** 0-based position in the sort, i.e. which column breaks ties first. */
  index: number;
}

function flip(dir: SortDirection): SortDirection {
  return dir === "asc" ? "desc" : "asc";
}

/** Drops rules naming a column that cannot sort, de-duplicates repeats of the
 *  same column, coerces an unrecognized direction to "asc", and caps the
 *  result — so a stored sort written against an older schema stays usable. */
export function normalizeSort(
  sort: readonly SortRule[],
  sortableFields: ReadonlySet<string>,
  maxSortColumns = MAX_SORT_COLUMNS,
): SortRule[] {
  const seen = new Set<string>();
  const normalized: SortRule[] = [];

  for (const rule of sort) {
    if (!rule.field || seen.has(rule.field)) continue;
    if (!sortableFields.has(rule.field)) continue;
    seen.add(rule.field);
    normalized.push({
      field: rule.field,
      dir: rule.dir === "desc" ? "desc" : "asc",
    });
    if (normalized.length >= maxSortColumns) break;
  }

  return normalized;
}

export function sortRulesEqual(
  left: readonly SortRule[],
  right: readonly SortRule[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (rule, index) =>
      rule.field === right[index]?.field && rule.dir === right[index]?.dir,
  );
}

export function getColumnSort(
  sort: readonly SortRule[],
  field: string,
): ColumnSortState | null {
  const index = sort.findIndex((rule) => rule.field === field);
  if (index === -1) return null;
  return { dir: sort[index].dir, index };
}

/** Cycles one column through asc → desc → unsorted. With `multi`, the column
 *  joins the existing sort instead of replacing it. */
export function toggleSort(
  sort: readonly SortRule[],
  field: string,
  options: {
    multi?: boolean;
    sortableFields: ReadonlySet<string>;
    maxSortColumns?: number;
  },
): SortRule[] {
  if (!options.sortableFields.has(field)) return [...sort];

  const current = sort.find((rule) => rule.field === field);

  if (!options.multi) {
    // Third click clears the sort entirely rather than cycling back to asc.
    if (current?.dir === "desc") return [];
    return [{ field, dir: current ? flip(current.dir) : "asc" }];
  }

  const maxSortColumns = options.maxSortColumns ?? MAX_SORT_COLUMNS;

  // A new column cannot push the sort past the cap; an already-sorted one
  // still cycles, so a full sort never becomes impossible to unwind.
  if (
    current == null &&
    normalizeSort(sort, options.sortableFields, Number.MAX_SAFE_INTEGER)
      .length >= maxSortColumns
  ) {
    return [...sort];
  }

  const next =
    current == null
      ? [...sort, { field, dir: "asc" as const }]
      : current.dir === "desc"
        ? sort.filter((rule) => rule.field !== field)
        : sort.map((rule) =>
            rule.field === field ? { field, dir: "desc" as const } : rule,
          );

  return normalizeSort(next, options.sortableFields, maxSortColumns);
}

// ── TanStack boundary ──────────────────────────────────────────────────────
// The only two functions in the engine that know TanStack's sort shape.

export function toTanstackSorting(sort: readonly SortRule[]): SortingState {
  return sort.map((rule) => ({ id: rule.field, desc: rule.dir === "desc" }));
}

export function fromTanstackSorting(sorting: SortingState): SortRule[] {
  return sorting.map((entry) => ({
    field: entry.id,
    dir: entry.desc ? ("desc" as const) : ("asc" as const),
  }));
}
