import type { SortingState } from "@tanstack/react-table";

export const MAX_TABLE_SORT_COLUMNS = 5;

type SortDirection = "asc" | "desc";

export interface ColumnSortState {
  direction: SortDirection;
  index: number;
}

export function normalizeSortingState(
  sorting: SortingState,
  sortableIds: ReadonlySet<string>,
  maxSortColumns = MAX_TABLE_SORT_COLUMNS,
): SortingState {
  const seen = new Set<string>();
  const normalized: SortingState = [];

  for (const sort of sorting) {
    if (!sort.id || seen.has(sort.id) || !sortableIds.has(sort.id)) continue;
    seen.add(sort.id);
    normalized.push({ id: sort.id, desc: sort.desc === true });
    if (normalized.length >= maxSortColumns) break;
  }

  return normalized;
}

export function areSortingStatesEqual(
  left: SortingState,
  right: SortingState,
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (sort, index) =>
      sort.id === right[index]?.id && sort.desc === right[index]?.desc,
  );
}

export function getColumnSortState(
  sorting: SortingState,
  columnId: string,
): ColumnSortState | null {
  const index = sorting.findIndex((sort) => sort.id === columnId);
  if (index === -1) return null;
  return {
    direction: sorting[index].desc ? "desc" : "asc",
    index,
  };
}

export function toggleColumnSorting(
  sorting: SortingState,
  columnId: string,
  options: {
    multi?: boolean;
    sortableIds: ReadonlySet<string>;
    maxSortColumns?: number;
  },
): SortingState {
  if (!options.sortableIds.has(columnId)) return sorting;

  const current = sorting.find((sort) => sort.id === columnId);
  const nextForColumn =
    current == null
      ? { id: columnId, desc: false }
      : current.desc
        ? null
        : { id: columnId, desc: true };

  if (!options.multi) {
    return nextForColumn ? [nextForColumn] : [];
  }

  const maxSortColumns = options.maxSortColumns ?? MAX_TABLE_SORT_COLUMNS;

  if (
    current == null &&
    normalizeSortingState(sorting, options.sortableIds, Number.MAX_SAFE_INTEGER)
      .length >= maxSortColumns
  ) {
    return sorting;
  }

  const next =
    current == null
      ? [...sorting, { id: columnId, desc: false }]
      : current.desc
        ? sorting.filter((sort) => sort.id !== columnId)
        : sorting.map((sort) =>
            sort.id === columnId ? { id: columnId, desc: true } : sort,
          );

  return normalizeSortingState(next, options.sortableIds, maxSortColumns);
}
