"use client";

import type { RowData } from "@tanstack/react-table";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { CategoryResolver } from "../column-category-layout";
import type { SchemaColumn } from "../column-schema";
import { applyView } from "../filter-engine";
import {
  type ColumnLayoutState,
  emptyGridView,
  type GridView,
} from "../grid-view";
import {
  buildCellSpecs,
  buildColumnLayout,
  buildFlatItems,
  buildRowPositionsByIndex,
  CELL_ALIGNMENT_CLASS,
  type ColumnLayoutEntry,
  cellPaddingClass,
  EMPTY_GROUP_KEY,
  type GroupValueFn,
  groupSortDirection,
  PINNED_EDGE_BORDER,
  PINNED_INNER_EDGE_SHADOW,
  ROW_INDEX_TEXT_CLASS,
} from "../layout";
import { sortRowsForExport } from "../sort-rows";
import { getColumnSort, sortRulesEqual, toggleSort } from "../sorting-state";
import { resolveColumnOrder, resolveColumnPins } from "../view-columns";
import { useColumnReorder } from "./use-column-reorder";
import { MAX_COLUMN_WIDTH, useColumnResize } from "./use-column-resize";

export interface DataGridProps<TData extends RowData> {
  rows: readonly TData[];
  columns: readonly SchemaColumn<TData>[];
  /** Renders one cell. The grid owns layout and colour; the DOM is yours. */
  renderCell: (column: SchemaColumn<TData>, row: TData) => ReactNode;

  /**
   * Search, filter, sort, grouping and column layout in one object. Leave it
   * off and the grid keeps its own, so the minimal call still sorts and
   * resizes; pass it and the grid is fully controlled.
   *
   * Column order, widths, visibility and pins live in `view.columns`. They were
   * five separate props until 0.3.0; keeping both would have meant two sources
   * of truth for one piece of state.
   */
  view?: GridView;
  /** Fires with the whole next view whenever the grid changes part of it —
   *  today that means a header click editing `sort`. */
  onViewChange?: (view: GridView) => void;

  /** Stable row identity. Without it rows key on their position, so a filter,
   *  a sort or an arriving page makes React reuse one row's DOM for another -
   *  which bleeds cell state (an open popover, a focused input) across rows. */
  getRowId?: (row: TData) => string;

  /** Sort by more than one column at once, up to `MAX_SORT_COLUMNS`.
   *  Shift-click a header to add a column to the sort. On by default. */
  multiSort?: boolean;

  /** Resolves a row's group key and label. A function, so it cannot live in
   *  the serializable `view` — `view.group` names the column, this says how to
   *  bucket it. */
  getGroupValue?: GroupValueFn;
  collapsedGroups?: ReadonlySet<string>;
  onCollapsedGroupsChange?: (collapsed: Set<string>) => void;

  /** Drag to reorder columns. Off unless you ask for it. */
  reorderable?: boolean;
  /** Restricts a reorder drag to columns sharing a category. */
  categoryOf?: CategoryResolver;
  /** Drag the header edge to resize. On by default. */
  resizable?: boolean;

  wrapCells?: boolean;
  className?: string;
  emptyMessage?: ReactNode;
}

function edgeClass<TData extends RowData>(
  entry: ColumnLayoutEntry<SchemaColumn<TData>>,
) {
  if (entry.isLastPinned) return PINNED_EDGE_BORDER;
  return entry.isPinned ? PINNED_INNER_EDGE_SHADOW : "";
}

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Stable identity for an unsized grid, so the layout memo is not invalidated
 *  by a fresh `{}` on every render. */
const EMPTY_SIZES: Readonly<Record<string, number>> = {};

export function DataGrid<TData extends RowData>({
  rows,
  columns,
  renderCell,
  view,
  onViewChange,
  getRowId,
  multiSort = true,
  getGroupValue,
  collapsedGroups,
  onCollapsedGroupsChange,
  reorderable = false,
  categoryOf,
  resizable = true,
  wrapCells = false,
  className,
  emptyMessage = "No rows match the current filter.",
}: DataGridProps<TData>) {
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Every piece of state can be driven from outside or left to the grid, so the
  // minimal call is `<DataGrid rows columns renderCell />` and resizing works.
  const [ownView, setOwnView] = useState<GridView>(emptyGridView);
  const [ownCollapsed, setOwnCollapsed] = useState<Set<string>>(
    () => new Set(),
  );

  const activeView = view ?? ownView;
  const groupField = activeView.group?.field ?? "";
  const collapsed = collapsedGroups ?? ownCollapsed;
  const layoutState = activeView.columns;
  const sizes = layoutState?.sizes ?? EMPTY_SIZES;

  const setView = useCallback(
    (next: GridView) => {
      if (onViewChange) onViewChange(next);
      if (!view) setOwnView(next);
    },
    [view, onViewChange],
  );

  /** Patch only the column layout, leaving the rest of the view untouched.
   *  When the view carries no layout yet, the first drag creates one holding
   *  just the field that changed - so a grid that has only been resized
   *  reports exactly that, and the diff treats order as untracked. */
  const patchColumns = useCallback(
    (patch: Partial<ColumnLayoutState>) => {
      setView({ ...activeView, columns: { ...activeView.columns, ...patch } });
    },
    [activeView, setView],
  );

  const setOrder = useCallback(
    (next: string[]) => patchColumns({ order: next }),
    [patchColumns],
  );

  const commitSizes = useCallback(
    (patch: Record<string, number>) =>
      patchColumns({ sizes: { ...sizes, ...patch } }),
    [patchColumns, sizes],
  );

  const toggleGroup = useCallback(
    (key: string) => {
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (onCollapsedGroupsChange) onCollapsedGroupsChange(next);
      if (!collapsedGroups) setOwnCollapsed(next);
    },
    [collapsed, collapsedGroups, onCollapsedGroupsChange],
  );

  const ordered = useMemo(
    () => resolveColumnOrder(columns, layoutState),
    [columns, layoutState],
  );

  const pins = useMemo(
    () => resolveColumnPins(ordered, layoutState),
    [ordered, layoutState],
  );

  const layout = useMemo(
    () =>
      buildColumnLayout(
        ordered.map((c) => ({
          id: c.id,
          item: c,
          minWidth: c.minWidth,
          size: sizes[c.id] ?? c.width,
        })),
        pins.pinned,
      ),
    [ordered, sizes, pins],
  );

  // Class list and style are functions of the *column*, not the row, but a
  // naive body loop re-derives both inside the per-row `layout.map` - and
  // allocates a fresh style object per cell. `buildCellSpecs` is the engine's
  // own hoist for exactly that; `metaOf` is the identity here because a
  // SchemaColumn already carries `type`, `breakdown` and `cellTint`.
  const cellSpecs = useMemo(
    () =>
      buildCellSpecs<TData, SchemaColumn<TData>>(layout, {
        wrapCells,
        metaOf: (column) => column,
      }),
    [layout, wrapCells],
  );

  // Depend on the two fields that narrow rows, not on the whole view: a header
  // click replaces the view object, and re-running the filter over every row
  // because `sort` changed is a full scan the sort was never going to use.
  // `applyView` short-circuits an unfiltered view itself, so there is no
  // emptiness check to keep in sync here.
  const { search, filter, sort } = activeView;
  const visible = useMemo(
    () => applyView(rows, { search, filter, sort: [], group: null }, columns),
    [rows, search, filter, columns],
  );

  const sorted = useMemo(
    () => sortRowsForExport(visible, sort, columns),
    [visible, sort, columns],
  );

  const flatItems = useMemo(() => {
    const wrapped = sorted.map((original) => ({ original }));
    const dir = groupField ? groupSortDirection(sort, groupField) : "asc";
    return buildFlatItems(wrapped, groupField, dir, collapsed, getGroupValue);
  }, [sorted, groupField, sort, collapsed, getGroupValue]);

  const positions = useMemo(
    () => buildRowPositionsByIndex(flatItems),
    [flatItems],
  );

  // Pinned columns are excluded: a frozen column that drifts out of the frozen
  // block would leave the sticky offsets describing an order that no longer
  // exists.
  const lockedIds = useMemo(() => new Set(pins.locked), [pins]);
  const participating = useMemo(
    () => new Set(layout.filter((e) => !lockedIds.has(e.id)).map((e) => e.id)),
    [layout, lockedIds],
  );

  const reorder = useColumnReorder({
    order: ordered.map((c) => c.id),
    participating,
    onOrderChange: setOrder,
    categoryOf,
    enabled: reorderable,
  });

  const resize = useColumnResize({
    frameRef,
    columns: useMemo(
      () =>
        layout.map((e) => ({
          id: e.id,
          size: e.size,
          minWidth: e.minWidth ?? 40,
          isPinned: e.isPinned,
        })),
      [layout],
    ),
    onCommit: commitSizes,
    enabled: resizable,
  });

  const sortableFields = useMemo(
    () => new Set(columns.filter((c) => c.sortable).map((c) => c.id)),
    [columns],
  );

  // Delegates to the engine's own `toggleSort` rather than repeating the
  // asc → desc → off cycle here: that helper also caps the sort at
  // MAX_SORT_COLUMNS and drops fields that are no longer sortable, which a
  // hand-rolled single-column toggle silently could not do.
  const onHeaderClick = (column: SchemaColumn<TData>, additive: boolean) => {
    const next = toggleSort(sort, column.id, {
      multi: multiSort && additive,
      sortableFields,
    });
    // A click the sort refuses - an unsortable column, or a new one at the cap
    // - must not publish a new view: every consumer would see a change, and
    // the rows would re-sort, for a state that did not move.
    if (sortRulesEqual(next, sort)) return;
    setView({ ...activeView, sort: next });
  };

  return (
    <div ref={frameRef} className={cx("ftg-frame", className)}>
      <table className="ftg-grid">
        <thead>
          <tr>
            {layout.map((entry, columnIndex) => {
              const column = entry.item;
              const sort = getColumnSort(activeView.sort, column.id);
              return (
                <th
                  key={entry.id}
                  data-column-id={entry.id}
                  aria-sort={
                    sort
                      ? sort.dir === "desc"
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                  className={cx(
                    "ftg-th",
                    cellPaddingClass(column.type),
                    edgeClass(entry),
                    entry.isPinned && "sticky z-10",
                    column.type.cellAlignment &&
                      CELL_ALIGNMENT_CLASS[column.type.cellAlignment],
                    column.sortable && "ftg-sortable",
                    reorder.activeId === entry.id && "ftg-dragging",
                    reorder.overId === entry.id && "ftg-drop-target",
                    resize.activeId === entry.id && "ftg-resizing",
                  )}
                  style={cellSpecs[columnIndex].style}
                  {...reorder.dragProps(entry.id)}
                  onClick={(e) => onHeaderClick(column, e.shiftKey)}
                >
                  <span className="ftg-th-label">{column.label}</span>
                  {sort ? (
                    <span className="ftg-sort-mark" aria-hidden="true">
                      {sort.dir === "desc" ? " ↓" : " ↑"}
                      {/* Which column sorts first. Without it a multi-column
                          sort is two identical arrows and no way to tell. */}
                      {activeView.sort.length > 1 ? (
                        <span className="ftg-sort-index">{sort.index + 1}</span>
                      ) : null}
                    </span>
                  ) : null}
                  {resizable ? (
                    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot live inside a <th> as an overlaid drag target.
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.label}`}
                      aria-valuenow={entry.size}
                      aria-valuemin={entry.minWidth ?? 40}
                      aria-valuemax={MAX_COLUMN_WIDTH}
                      tabIndex={0}
                      className="ftg-resize-handle"
                      onPointerDown={(e) => resize.onResizeStart(entry.id, e)}
                      onKeyDown={(e) => resize.onResizeKeyDown(entry.id, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {flatItems.length === 0 ? (
            <tr>
              <td className="ftg-empty" colSpan={layout.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}
          {flatItems.map((item) => {
            if (item.type === "group-header") {
              return (
                <tr key={`h:${item.key}`} className="ftg-group-row">
                  <td colSpan={layout.length}>
                    <button
                      type="button"
                      className="ftg-group-toggle"
                      aria-expanded={!collapsed.has(item.key)}
                      onClick={() => toggleGroup(item.key)}
                    >
                      <span className="ftg-caret" aria-hidden="true">
                        {collapsed.has(item.key) ? "▸" : "▾"}
                      </span>
                      <span>
                        {item.label === EMPTY_GROUP_KEY ? "—" : item.label}
                      </span>
                      <span className="ftg-group-count">{item.count}</span>
                    </button>
                  </td>
                </tr>
              );
            }
            const row = sorted[item.rowIndex];
            return (
              <tr
                key={getRowId ? getRowId(row) : `r:${item.rowIndex}`}
                className="ftg-row"
              >
                {layout.map((entry, columnIndex) => {
                  const column = entry.item;
                  const spec = cellSpecs[columnIndex];
                  return (
                    <td
                      key={entry.id}
                      className={spec.staticClass}
                      style={spec.style}
                    >
                      {column.type.dataType === "index" ? (
                        <span className={ROW_INDEX_TEXT_CLASS}>
                          {positions.get(item.rowIndex) ?? ""}
                        </span>
                      ) : (
                        renderCell(column, row)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
