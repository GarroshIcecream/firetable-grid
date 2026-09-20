import type { AggregationType, CellAlignment } from "../column-vocabulary";

export const EMPTY_GROUP_KEY = "\u2014";

export const SELECTION_COLUMN_ID = "__select__";
export const SELECTION_COLUMN_WIDTH = 36;
export const SELECTION_CELL_PADDING_CLASS = "pl-3.5 pr-1.5";

export const CELL_ALIGNMENT_CLASS: Record<CellAlignment, string> = {
  start: "text-left",
  center: "text-center",
  end: "text-right",
};

// Trailing edge of the frozen block, split in two on purpose: the 1px border
// rides along with the last pinned cell, so a browser that lags sticky cells
// (overscroll bounce, momentum scroll) can never float frozen content past it.
// The drop shadow is a single overlay above the scroll container instead - per
// cell it renders as banded seams, because its blur fades out at every row edge.
export const PINNED_EDGE_BORDER = "border-border border-r";
export const PINNED_EDGE_SHADOW = "shadow-[6px_0_8px_-4px_rgb(0_0_0/0.10)]";
// Hairline between two pinned cells - keeps the frozen block from showing the
// scrolled column through the 1px gap between sticky neighbours.
export const PINNED_INNER_EDGE_SHADOW =
  "shadow-[1px_0_0_var(--color-background)]";

export type FlatItem =
  | { type: "group-header"; key: string; label: string; count: number }
  | { type: "row"; rowIndex: number };

// Resolves a row's raw group value into a stable identity/sort key and a
// display label. The default keys and labels on the stringified raw value;
// date columns supply a custom resolver (calendar day or relative bucket).
// `original` is the full row, so resolvers can key on a sibling field for
// columns whose group value is derived rather than stored (e.g. qualityCheck
// is derived from `lastCheckedAt`).
export type GroupValueFn = (
  raw: unknown,
  original?: Record<string, unknown>,
) => { sortKey: string; label: string };

function defaultGroupValue(raw: unknown): { sortKey: string; label: string } {
  const s = String(raw ?? EMPTY_GROUP_KEY);
  return { sortKey: s, label: s };
}

export interface ColumnLayoutInput<TItem> {
  id: string;
  item: TItem;
  minWidth?: number;
  size: number;
}

export interface ColumnLayoutEntry<TItem> extends ColumnLayoutInput<TItem> {
  isLastPinned: boolean;
  isPinned: boolean;
  stickyLeft?: number;
}

export interface ResolvePinnedColumnsInput {
  compact: boolean;
  compactFrozenColumns?: readonly string[];
  frozenColumns: readonly string[];
  selectionColumnId?: string;
  userPinnedColumns?: readonly string[];
}

export function resolvePinnedColumns({
  compact,
  compactFrozenColumns,
  frozenColumns,
  selectionColumnId,
  userPinnedColumns,
}: ResolvePinnedColumnsInput): { locked: string[]; pinned: string[] } {
  const selection = selectionColumnId ? [selectionColumnId] : [];
  const pins = userPinnedColumns ?? [];
  const full = [...selection, ...frozenColumns, ...pins];
  return {
    locked: Array.from(new Set(full)),
    pinned: Array.from(
      new Set(
        compact
          ? [...selection, ...(compactFrozenColumns ?? frozenColumns)]
          : full,
      ),
    ),
  };
}

export function resolveRowTap(
  rowId: string,
  armedRowId: string | null,
  requireConfirm: boolean,
): { armedRowId: string | null; open: boolean } {
  if (requireConfirm && armedRowId !== rowId) {
    return { armedRowId: rowId, open: false };
  }
  return { armedRowId: null, open: true };
}

export interface VirtualRangeItem {
  end: number;
  index: number;
  start: number;
}

interface VirtualRenderSlot<TVirtualItem extends VirtualRangeItem> {
  before: number;
  item: TVirtualItem;
}

export interface VirtualRenderPlan<TVirtualItem extends VirtualRangeItem> {
  after: number;
  slots: Array<VirtualRenderSlot<TVirtualItem>>;
}

export function buildColumnLayout<TItem>(
  columns: readonly ColumnLayoutInput<TItem>[],
  pinnedIds: readonly string[],
): Array<ColumnLayoutEntry<TItem>> {
  if (columns.length === 0) return [];

  const pinnedRank = new Map<string, number>();
  for (let i = 0; i < pinnedIds.length; i++) {
    const id = pinnedIds[i];
    if (!pinnedRank.has(id)) pinnedRank.set(id, i);
  }

  const pinned: Array<ColumnLayoutInput<TItem>> = [];
  const unpinned: Array<ColumnLayoutInput<TItem>> = [];
  for (const column of columns) {
    if (pinnedRank.has(column.id)) pinned.push(column);
    else unpinned.push(column);
  }
  pinned.sort(
    (a, b) => (pinnedRank.get(a.id) ?? 0) - (pinnedRank.get(b.id) ?? 0),
  );

  const lastPinnedId = pinned[pinned.length - 1]?.id;
  let left = 0;

  return [...pinned, ...unpinned].map((column) => {
    const isPinned = pinnedRank.has(column.id);
    const entry: ColumnLayoutEntry<TItem> = {
      ...column,
      isLastPinned: isPinned && column.id === lastPinnedId,
      isPinned,
    };
    if (isPinned) {
      entry.stickyLeft = left;
      left += column.size;
    }
    return entry;
  });
}

// Group ordering is a function of the *sort*, not a separate group-direction
// control: the group headers follow the grouped column's sort direction, and
// sorting any other column only reorders rows within each group. This returns
// the direction buildFlatItems should order buckets by - the grouped column's
// sort direction when it is sorted, else "asc" (the default A→Z group order).
export function groupSortDirection(
  sorting: readonly { id: string; desc: boolean }[],
  groupField: string,
): "asc" | "desc" {
  const entry = sorting.find((sort) => sort.id === groupField);
  return entry?.desc ? "desc" : "asc";
}

export function buildFlatItems<TData>(
  rows: readonly { original: TData }[],
  groupField: string,
  groupDir: "asc" | "desc",
  collapsedGroups?: ReadonlySet<string>,
  getGroupValue: GroupValueFn = defaultGroupValue,
): FlatItem[] {
  if (!groupField) {
    return rows.map((_, rowIndex) => ({ type: "row", rowIndex }));
  }

  const groups = new Map<string, { label: string; indices: number[] }>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const original = rows[rowIndex].original as Record<string, unknown>;
    const raw = original[groupField];
    const { sortKey, label } = getGroupValue(raw, original);
    const group = groups.get(sortKey);
    if (group) group.indices.push(rowIndex);
    else groups.set(sortKey, { label, indices: [rowIndex] });
  }

  // Sort on a lowercased key computed once per group, not once per comparison:
  // a comparator that lowercases both sides does it O(n log n) times, which for
  // a few thousand groups is tens of thousands of throwaway strings.
  const sortedGroups = Array.from(groups, ([key, group]) => ({
    key,
    group,
    sortOn: key.toLowerCase(),
  })).sort((a, b) => {
    const cmp = a.sortOn < b.sortOn ? -1 : a.sortOn > b.sortOn ? 1 : 0;
    return groupDir === "asc" ? cmp : -cmp;
  });

  const items: FlatItem[] = [];
  for (const {
    key,
    group: { label, indices },
  } of sortedGroups) {
    items.push({ type: "group-header", key, label, count: indices.length });
    if (collapsedGroups?.has(key)) continue;
    for (const rowIndex of indices) {
      items.push({ type: "row", rowIndex });
    }
  }
  return items;
}

export function buildVirtualRenderPlan<TVirtualItem extends VirtualRangeItem>(
  virtualItems: readonly TVirtualItem[],
  totalSize: number,
): VirtualRenderPlan<TVirtualItem> {
  if (virtualItems.length === 0) {
    return { after: Math.max(0, totalSize), slots: [] };
  }

  const ordered = [...virtualItems].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.index - b.index;
  });

  const slots: Array<VirtualRenderSlot<TVirtualItem>> = [];
  let cursor = 0;
  for (const item of ordered) {
    slots.push({
      before: Math.max(0, item.start - cursor),
      item,
    });
    cursor = Math.max(cursor, item.end);
  }

  return {
    after: Math.max(0, totalSize - cursor),
    slots,
  };
}

/**
 * How many placeholder rows to render past the loaded edge while the next
 * page is in flight.
 *
 * Capped at one page rather than sized to `totalCount` on purpose: rows are
 * keyset-paged, so a cursor only walks forward one page at a time. A scroller
 * sized to the whole result set would let the user drop the thumb on row
 * 9,000, which no single request can reach - one page of runway is exactly
 * the set of rows that really is on its way.
 */
export function pendingRowRunway({
  loadedRowCount,
  totalCount,
  pageSize,
  hasNextPage,
}: {
  loadedRowCount: number;
  totalCount: number | null;
  pageSize: number;
  hasNextPage: boolean;
}): number {
  if (!hasNextPage || pageSize <= 0) return 0;
  // A stale `totalCount` (it comes from the first page) can undershoot the
  // rows already loaded, so clamp at zero rather than trusting the subtraction.
  const remaining =
    totalCount === null ? pageSize : totalCount - loadedRowCount;
  return Math.max(0, Math.min(pageSize, remaining));
}

/**
 * Footer aggregate over a numeric column.
 *
 * Single pass, no intermediate array. `Math.min(...values)` reads naturally
 * but passes every row as a separate argument, and an argument list that long
 * overflows the call stack: V8 throws `RangeError: Maximum call stack size
 * exceeded` somewhere past ~125k arguments, so a min/max footer used to crash
 * the grid on exactly the datasets big enough to want one.
 */
export function computeRowsAgg<TData>(
  rows: readonly { original: TData }[],
  colId: string,
  aggType: AggregationType,
): number | null {
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const value = (row.original as Record<string, unknown>)[colId];
    if (typeof value !== "number") continue;
    count++;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (count === 0) return null;

  switch (aggType) {
    case "avg":
      return sum / count;
    case "sum":
      return sum;
    case "min":
      return min;
    case "max":
      return max;
    case "count":
      return count;
  }
}

export type ServerGroup = {
  value: string | null;
  label?: string | null;
  count: number;
};

/**
 * Grouped flat items driven by the server's group list instead of the loaded
 * rows: every group renders its header (with the exact server count) in
 * server order immediately, and loaded rows slot in under their group as
 * pages stream in. Without this, groups later in the order don't exist
 * client-side until every earlier row has been paged through.
 *
 * Loaded rows are bucketed by the same group key the server groups by (the
 * resolver's sortKey); a row whose key is missing from the server list
 * (count drift between the two queries) still renders, appended as a
 * trailing local group rather than silently dropped.
 */
export function buildFlatItemsFromServerGroups<TData>(
  rows: readonly { original: TData }[],
  groupField: string,
  serverGroups: readonly ServerGroup[],
  collapsedGroups?: ReadonlySet<string>,
  getGroupValue: GroupValueFn = defaultGroupValue,
): FlatItem[] {
  const byKey = new Map<string, { label: string; indices: number[] }>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const original = rows[rowIndex].original as Record<string, unknown>;
    const { sortKey, label } = getGroupValue(original[groupField], original);
    const bucket = byKey.get(sortKey);
    if (bucket) bucket.indices.push(rowIndex);
    else byKey.set(sortKey, { label, indices: [rowIndex] });
  }

  const items: FlatItem[] = [];
  const seen = new Set<string>();
  for (const group of serverGroups) {
    const key = group.value === null ? EMPTY_GROUP_KEY : group.value;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = byKey.get(key);
    items.push({
      type: "group-header",
      key,
      label: group.label ?? bucket?.label ?? key,
      count: group.count,
    });
    if (collapsedGroups?.has(key) || !bucket) continue;
    for (const rowIndex of bucket.indices) {
      items.push({ type: "row", rowIndex });
    }
  }

  for (const [key, bucket] of byKey) {
    if (seen.has(key)) continue;
    items.push({
      type: "group-header",
      key,
      label: bucket.label,
      count: bucket.indices.length,
    });
    if (collapsedGroups?.has(key)) continue;
    for (const rowIndex of bucket.indices) {
      items.push({ type: "row", rowIndex });
    }
  }
  return items;
}
