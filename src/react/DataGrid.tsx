"use client";

import type { RowData } from "@tanstack/react-table";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CategoryResolver } from "../column-category-layout";
import type { SchemaColumn } from "../column-schema";
import type { AggregationType } from "../column-vocabulary";
import { applyView } from "../filter-engine";
import {
  type FooterAggregateValues,
  resolveFooterValue,
} from "../footer-aggregate-value";
import {
  formatFooterAggregate,
  type NumberFormatter,
} from "../format-footer-aggregate";
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
  buildVirtualRenderPlan,
  CELL_ALIGNMENT_CLASS,
  type ColumnLayoutEntry,
  cellPaddingClass,
  computeRowsAgg,
  EMPTY_GROUP_KEY,
  type FlatItem,
  fixedRowWindow,
  type GroupValueFn,
  groupSortDirection,
  PINNED_EDGE_BORDER,
  PINNED_INNER_EDGE_SHADOW,
  ROW_INDEX_TEXT_CLASS,
  reachedEndOfRows,
  SELECTION_COLUMN_ID,
  type VirtualRangeItem,
} from "../layout";
import {
  checkboxClick,
  resolveSelectionClick,
  type SelectionClick,
  type SelectionState,
  selectionColumn,
  selectionStateOf,
  toggleIds,
} from "../selection";
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

  /**
   * Adds a leading checkbox column.
   *
   * Requires `getRowId`, and is ignored without it: a selection keyed on row
   * position follows the wrong rows through a sort or a filter, which is worse
   * than no selection at all.
   */
  enableSelection?: boolean;
  /** Selected row ids. Uncontrolled when omitted. */
  selectedRowIds?: ReadonlySet<string>;
  onSelectionChange?: (selected: Set<string>) => void;

  /**
   * Which aggregation each column shows in a footer row, by column id. Omit
   * for no footer. Columns whose type is not `aggregatable` are ignored.
   */
  footerAggregations?: Readonly<Record<string, AggregationType>>;
  /**
   * Server-computed aggregates, keyed by column id then aggregation. These
   * WIN over the loaded rows: with paged data the loaded slice drifts from the
   * real total as pages arrive, so a locally computed sum would understate it.
   */
  footerValues?: FooterAggregateValues;
  /**
   * Formats footer numbers. Required for a footer to render — the engine holds
   * no locale, and `next-intl`'s `useFormatter()` satisfies this as-is.
   */
  numberFormatter?: NumberFormatter;

  /** Replaces the bare `<input type="checkbox">` the selection column renders.
   *  The package ships no UI kit, so this is the hook for yours. */
  renderCheckbox?: (props: {
    checked: boolean;
    indeterminate: boolean;
    label: string;
    onToggle: () => void;
  }) => ReactNode;
  /** Replaces a footer cell's contents. Receives the resolved number, or null
   *  when there is nothing to show. */
  renderFooterCell?: (
    column: SchemaColumn<TData>,
    value: number | null,
    aggregation: AggregationType,
  ) => ReactNode;

  /**
   * Renders only the rows in view.
   *
   * OPT-IN, and deliberately so. Virtualization fails quietly rather than
   * loudly: find-in-page stops finding unrendered rows, printing shows only
   * the window, a screen reader sees a partial table unless you set
   * `aria-rowcount` yourself, and a test asserting "all 40 rows render" starts
   * failing. A grid of fifty rows should pay none of that.
   *
   * It is also not auto-enabled above some row count: behaviour that changes
   * discontinuously with data size gives you "works at 50 rows, breaks at
   * 500", which is the worst kind of bug report.
   *
   * Every row must be `rowHeight` tall, INCLUDING group headers. For variable
   * heights, drive it from your own virtualizer through `virtualItems`.
   */
  virtualize?: { rowHeight: number; overscan?: number };
  /**
   * Virtual items from your own virtualizer, for variable row heights.
   * `@tanstack/react-virtual`'s `getVirtualItems()` satisfies this shape, and
   * it stays an optional peer because nothing here imports it at runtime.
   *
   * Takes precedence over `virtualize` when both are given.
   */
  virtualItems?: readonly VirtualRangeItem[];
  /** Total scrollable height, alongside `virtualItems`. */
  totalSize?: number;

  /**
   * Fires when the rendered window comes within `endReachedThreshold` rows of
   * the loaded edge. Needs virtualization to mean anything - without it every
   * row is rendered, so the end is always in view.
   */
  onEndReached?: () => void;
  /**
   * How many rows ahead of the last rendered one still count as "near the
   * end". Must stay BELOW your page size: above it, the page that lands is
   * itself inside the threshold, so this fires again at once and the fetches
   * chain until the data runs out.
   */
  endReachedThreshold?: number;

  wrapCells?: boolean;
  className?: string;
  emptyMessage?: ReactNode;
}

/** The default checkbox: unstyled on purpose. */
function defaultCheckbox(props: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onToggle: () => void;
}): ReactNode {
  return (
    <input
      type="checkbox"
      aria-label={props.label}
      checked={props.checked}
      // `indeterminate` is a DOM property with no React attribute, so the ref
      // is the only way to reach it.
      ref={(el) => {
        if (el) el.indeterminate = props.indeterminate;
      }}
      onChange={props.onToggle}
      onClick={(e) => e.stopPropagation()}
    />
  );
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
const EMPTY_IDS: readonly string[] = [];

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
  enableSelection = false,
  selectedRowIds,
  onSelectionChange,
  footerAggregations,
  footerValues,
  numberFormatter,
  renderCheckbox = defaultCheckbox,
  renderFooterCell,
  virtualize,
  virtualItems,
  totalSize,
  onEndReached,
  endReachedThreshold = 8,
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
  const [ownSelection, setOwnSelection] = useState<Set<string>>(
    () => new Set(),
  );
  // The range anchor is a ref, not state: it changes on every click and
  // nothing renders from it, so putting it in state would re-render the whole
  // grid to store a string.
  const anchorRef = useRef<string | null>(null);

  const activeView = view ?? ownView;
  const groupField = activeView.group?.field ?? "";
  const collapsed = collapsedGroups ?? ownCollapsed;
  const layoutState = activeView.columns;
  const sizes = layoutState?.sizes ?? EMPTY_SIZES;
  // Selection without stable ids would key on position; see the prop's note.
  const selectable = enableSelection && getRowId !== undefined;
  const selected = selectedRowIds ?? ownSelection;

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

  const commitSelection = useCallback(
    (next: Set<string>) => {
      if (onSelectionChange) onSelectionChange(next);
      if (!selectedRowIds) setOwnSelection(next);
    },
    [selectedRowIds, onSelectionChange],
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

  const ordered = useMemo(() => {
    const visible = resolveColumnOrder(columns, layoutState);
    // Prepended rather than declared in the schema, so a consumer's column
    // list stays purely their data and the checkbox cannot be reordered,
    // hidden or exported by accident. It is `frozen`, so `resolveColumnPins`
    // picks it up as sticky with no extra wiring.
    return selectable ? [selectionColumn<TData>(), ...visible] : visible;
  }, [columns, layoutState, selectable]);

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
        enableSelection: selectable,
        metaOf: (column) => column,
      }),
    [layout, wrapCells, selectable],
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

  // Only subscribed when the built-in windowing is on, so an unvirtualized
  // grid attaches no scroll listener at all.
  const windowing = virtualize !== undefined && virtualItems === undefined;
  const [scroll, setScroll] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const frame = frameRef.current;
    if (!windowing || !frame) return;
    const read = () => {
      const top = frame.scrollTop;
      const height = frame.clientHeight;
      // Returning the previous object bails React out, so an identical scroll
      // event does not re-render the grid.
      setScroll((prev) =>
        prev.top === top && prev.height === height ? prev : { top, height },
      );
    };
    read();
    frame.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(frame);
    return () => {
      frame.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [windowing]);

  /**
   * The rows to render, each with the spacer height that precedes it.
   *
   * Three paths: someone else's virtual items (per-slot spacers, since they
   * can be non-contiguous), the built-in fixed-height window (one spacer
   * before and one after), or everything.
   */
  const { rendered, spacerAfter, lastRenderedIndex } = useMemo(() => {
    if (virtualItems) {
      const plan = buildVirtualRenderPlan(virtualItems, totalSize ?? 0);
      const out: Array<{ item: FlatItem; index: number; before: number }> = [];
      for (const slot of plan.slots) {
        const item = flatItems[slot.item.index];
        if (item) {
          out.push({ item, index: slot.item.index, before: slot.before });
        }
      }
      return {
        rendered: out,
        spacerAfter: plan.after,
        lastRenderedIndex:
          out.length > 0 ? (out[out.length - 1]?.index ?? -1) : -1,
      };
    }
    if (virtualize) {
      const win = fixedRowWindow({
        itemCount: flatItems.length,
        rowHeight: virtualize.rowHeight,
        scrollTop: scroll.top,
        viewportHeight: scroll.height,
        overscan: virtualize.overscan,
      });
      const out: Array<{ item: FlatItem; index: number; before: number }> = [];
      for (let i = win.startIndex; i <= win.endIndex; i++) {
        const item = flatItems[i];
        if (item) {
          out.push({
            item,
            index: i,
            before: i === win.startIndex ? win.before : 0,
          });
        }
      }
      return {
        rendered: out,
        spacerAfter: win.after,
        lastRenderedIndex: win.endIndex,
      };
    }
    return {
      rendered: flatItems.map((item, index) => ({ item, index, before: 0 })),
      spacerAfter: 0,
      lastRenderedIndex: flatItems.length - 1,
    };
  }, [virtualItems, totalSize, virtualize, flatItems, scroll]);

  // Re-armed by the loaded row count, not by a timer: the page that lands is
  // what changes it, so a threshold inside one page cannot fire twice for the
  // same edge.
  const endFiredAtRef = useRef(-1);
  useEffect(() => {
    if (!onEndReached) return;
    if (
      !reachedEndOfRows({
        lastRenderedIndex,
        loadedRowCount: flatItems.length,
        threshold: endReachedThreshold,
      })
    ) {
      return;
    }
    if (endFiredAtRef.current === sorted.length) return;
    endFiredAtRef.current = sorted.length;
    onEndReached();
  }, [
    onEndReached,
    lastRenderedIndex,
    flatItems.length,
    sorted.length,
    endReachedThreshold,
  ]);

  // Ids in RENDERED order, which is what a shift-click range spans. Built from
  // the flat item list, so a collapsed group's rows are absent and a range
  // across it selects only what is on screen.
  const visibleRowIds = useMemo(() => {
    if (!selectable || !getRowId) return EMPTY_IDS;
    const ids: string[] = [];
    for (const item of flatItems) {
      if (item.type === "row") ids.push(getRowId(sorted[item.rowIndex]));
    }
    return ids;
  }, [selectable, getRowId, flatItems, sorted]);

  /** Row ids under one group header, for its select-all. */
  const groupRowIds = useCallback(
    (groupKey: string) => {
      if (!getRowId) return EMPTY_IDS;
      const ids: string[] = [];
      let inGroup = false;
      for (const item of flatItems) {
        if (item.type === "group-header") {
          if (inGroup) break;
          inGroup = item.key === groupKey;
          continue;
        }
        if (inGroup) ids.push(getRowId(sorted[item.rowIndex]));
      }
      return ids;
    },
    [flatItems, sorted, getRowId],
  );

  // Aggregates run over every row the view selected, not the rendered window:
  // a footer that changed as you scrolled would be describing the viewport.
  const footerRows = useMemo(
    () => (footerAggregations ? sorted.map((original) => ({ original })) : []),
    [footerAggregations, sorted],
  );

  const headerSelection: SelectionState = useMemo(
    () => selectionStateOf(selected, visibleRowIds),
    [selected, visibleRowIds],
  );

  const onRowToggle = useCallback(
    (rowId: string, click: SelectionClick) => {
      const result = resolveSelectionClick(
        selected,
        visibleRowIds,
        rowId,
        anchorRef.current,
        click,
      );
      anchorRef.current = result.anchorId;
      commitSelection(result.selected);
    },
    [selected, visibleRowIds, commitSelection],
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
                  {entry.id === SELECTION_COLUMN_ID ? (
                    renderCheckbox({
                      checked: headerSelection === "all",
                      indeterminate: headerSelection === "some",
                      label: "Select all rows",
                      onToggle: () => {
                        anchorRef.current = null;
                        commitSelection(toggleIds(selected, visibleRowIds));
                      },
                    })
                  ) : (
                    <span className="ftg-th-label">{column.label}</span>
                  )}
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
          {rendered.map(({ item, index, before }) => {
            // A spacer stands in for the rows above this one. Deliberately
            // carries no `aria-hidden`: hiding a <tr> breaks the table's row
            // structure for a screen reader, which is worse than an empty row.
            // Announcing the real total is `aria-rowcount`, and the prop's
            // comment says that is yours to set.
            const spacer =
              before > 0 ? (
                <tr key={`s:${index}`} style={{ height: before }}>
                  <td colSpan={layout.length} />
                </tr>
              ) : null;
            const key =
              item.type === "group-header" ? `h:${item.key}` : `i:${index}`;
            const body = (() => {
              if (item.type === "group-header") {
                return (
                  <tr key={`h:${item.key}`} className="ftg-group-row">
                    <td colSpan={layout.length}>
                      {selectable
                        ? (() => {
                            const ids = groupRowIds(item.key);
                            const state = selectionStateOf(selected, ids);
                            return (
                              <span className="ftg-group-select">
                                {renderCheckbox({
                                  checked: state === "all",
                                  indeterminate: state === "some",
                                  label: `Select all rows in ${item.label}`,
                                  onToggle: () => {
                                    anchorRef.current = null;
                                    commitSelection(toggleIds(selected, ids));
                                  },
                                })}
                              </span>
                            );
                          })()
                        : null}
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
              const rowId = getRowId ? getRowId(row) : undefined;
              const isSelected = rowId !== undefined && selected.has(rowId);
              return (
                <tr
                  key={rowId ?? `r:${item.rowIndex}`}
                  className={cx("ftg-row", isSelected && "ftg-row-selected")}
                  aria-selected={selectable ? isSelected : undefined}
                >
                  {layout.map((entry, columnIndex) => {
                    const column = entry.item;
                    const spec = cellSpecs[columnIndex];
                    return (
                      <td
                        key={entry.id}
                        data-column-id={entry.id}
                        className={spec.staticClass}
                        style={spec.style}
                      >
                        {entry.id === SELECTION_COLUMN_ID &&
                        rowId !== undefined ? (
                          // Modifiers are read here rather than on the row, so a
                          // range drag cannot collide with whatever the host puts
                          // inside a cell.
                          <span
                            onClickCapture={(e) =>
                              onRowToggle(
                                rowId,
                                checkboxClick({ shiftKey: e.shiftKey }),
                              )
                            }
                          >
                            {renderCheckbox({
                              checked: isSelected,
                              indeterminate: false,
                              label: `Select row ${positions.get(item.rowIndex) ?? ""}`,
                              onToggle: () => {
                                /* handled by onClickCapture above */
                              },
                            })}
                          </span>
                        ) : column.type.dataType === "index" ? (
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
            })();
            return spacer ? (
              <Fragment key={key}>
                {spacer}
                {body}
              </Fragment>
            ) : (
              body
            );
          })}
          {spacerAfter > 0 ? (
            <tr style={{ height: spacerAfter }}>
              <td colSpan={layout.length} />
            </tr>
          ) : null}
        </tbody>
        {footerAggregations && numberFormatter ? (
          <tfoot>
            <tr className="ftg-foot-row">
              {layout.map((entry, columnIndex) => {
                const column = entry.item;
                const aggregation = footerAggregations[entry.id];
                const spec = cellSpecs[columnIndex];
                // A column with no selected aggregation, or one its type does
                // not support, renders an empty cell rather than a zero.
                if (!aggregation || !column.type.aggregatable) {
                  return (
                    <td
                      key={entry.id}
                      className={spec.staticClass}
                      style={spec.style}
                    />
                  );
                }
                const read = column.getFilterValue
                  ? (r: TData) => column.getFilterValue?.(r)
                  : undefined;
                const value = resolveFooterValue(
                  entry.id,
                  aggregation,
                  footerValues,
                  () =>
                    computeRowsAgg(
                      footerRows,
                      column.accessorKey ?? entry.id,
                      aggregation,
                      read,
                    ),
                );
                return (
                  <td
                    key={entry.id}
                    className={spec.staticClass}
                    style={spec.style}
                  >
                    {renderFooterCell
                      ? renderFooterCell(column, value, aggregation)
                      : formatFooterAggregate(
                          value,
                          aggregation,
                          column,
                          numberFormatter,
                        )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
