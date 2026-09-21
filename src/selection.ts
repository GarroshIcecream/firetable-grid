// Row selection, decided against the order the rows are RENDERED in.
//
// That ordering is why this is engine logic and not a checkbox handler. A
// shift-click means "everything between these two rows as the user sees them",
// and after a sort, a filter and a collapsed group that bears no relation to
// the order the rows arrived in. Callers pass the ids in flat-item order - the
// same list `buildFlatItems` produced - so a range covers exactly what is on
// screen and nothing hidden inside a collapsed group.
//
// Selection state itself stays OUT of `GridView`: it is ephemeral, like the
// collapsed-group set. Nobody wants a four-hundred-row selection restored from
// a link three weeks later.

import type { RowData } from "@tanstack/react-table";
import { col, type SchemaColumn } from "./column-schema";
import type { ColumnType } from "./column-vocabulary";
import { SELECTION_COLUMN_ID, SELECTION_COLUMN_WIDTH } from "./layout/model";

export type SelectionState = "none" | "some" | "all";

/** The selection column is not a data column: nothing sorts, groups,
 *  aggregates or filters by it, and it must never reach an export. */
const SELECTION_COLUMN_TYPE: ColumnType = {
  dataType: "check",
  cellRenderer: null,
  filterType: null,
  sortable: false,
  groupable: false,
  aggregatable: false,
};

/**
 * The checkbox column, as a real `SchemaColumn` so it travels through
 * `buildColumnLayout` and `buildCellSpecs` like any other - which is what
 * gives it a width, a sticky offset and the frozen block's edge for free.
 *
 * `cell-spec` already recognises `SELECTION_COLUMN_ID` and gives it its own
 * padding; this is the other half of a pairing that shipped with nothing
 * producing it.
 */
export function selectionColumn<TData extends RowData>(): SchemaColumn<TData> {
  return col<TData>({
    id: SELECTION_COLUMN_ID,
    label: "",
    type: SELECTION_COLUMN_TYPE,
    width: SELECTION_COLUMN_WIDTH,
    minWidth: SELECTION_COLUMN_WIDTH,
    frozen: true,
    exportable: false,
    manageable: false,
  });
}

export interface SelectionClick {
  /** Toggle the clicked row and keep the rest — what a checkbox does, and
   *  what ctrl/cmd does to a row click. Also the fallback when a `range`
   *  has no anchor to extend from. */
  additive?: boolean;
  /** Shift — extend from the anchor to the clicked row. */
  range?: boolean;
}

export interface SelectionResult {
  selected: Set<string>;
  /** The row a subsequent range click extends from. */
  anchorId: string | null;
}

/**
 * The selection a click produces.
 *
 * `orderedIds` must be the ids in rendered order. `anchorId` is whatever the
 * previous call returned - keeping it in the result rather than inside this
 * module is what lets a caller hold it in a ref and stay the only owner of
 * the state.
 *
 * A range click keeps the existing anchor, so dragging the far end of a
 * selection re-extends from the same origin instead of walking it along.
 */
export function resolveSelectionClick(
  current: ReadonlySet<string>,
  orderedIds: readonly string[],
  clickedId: string,
  anchorId: string | null,
  click: SelectionClick = {},
): SelectionResult {
  // Range first, so a caller that means "toggle, and extend when you can" -
  // every checkbox - can pass both and still get a range out of a shift.
  if (click.range && anchorId !== null) {
    const from = orderedIds.indexOf(anchorId);
    const to = orderedIds.indexOf(clickedId);
    // An anchor that is no longer rendered - filtered away, or collapsed into
    // a group - would extend to an index that does not exist, selecting an
    // arbitrary span. Fall through to whatever the click means without it.
    if (from !== -1 && to !== -1) {
      const selected = new Set(current);
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      for (let i = start; i <= end; i++) selected.add(orderedIds[i]);
      return { selected, anchorId };
    }
  }

  if (click.additive) {
    const selected = new Set(current);
    if (selected.has(clickedId)) selected.delete(clickedId);
    else selected.add(clickedId);
    return { selected, anchorId: clickedId };
  }

  return { selected: new Set([clickedId]), anchorId: clickedId };
}

/**
 * What a click on the checkbox column means.
 *
 * A checkbox is a toggle, not a cursor: ticking a second row has to keep the
 * first, and clicking a ticked row has to untick it. A bare
 * `resolveSelectionClick` does the opposite - it REPLACES the selection, which
 * is right for a click on a row's body in a file manager and wrong for every
 * checkbox ever drawn. Wiring the column straight to it is what left the grid
 * single-select.
 *
 * So a checkbox click is always additive, and shift additionally asks for a
 * range; with no anchor to extend from, the toggle is what survives, because
 * clearing a selection the user built is never what a shift meant.
 */
export function checkboxClick(modifiers: {
  shiftKey: boolean;
}): SelectionClick {
  return { additive: true, range: modifiers.shiftKey };
}

/**
 * Whether none, some or all of `rowIds` are selected — the three states a
 * header checkbox renders.
 *
 * Only `rowIds` count. A row selected before a filter narrowed the view is
 * still in the set, and letting it read as "some" would leave the header
 * indeterminate over rows that are every one of them unselected.
 */
export function selectionStateOf(
  selected: ReadonlySet<string>,
  rowIds: readonly string[],
): SelectionState {
  // Vacuously every row of an empty grid is selected; a ticked select-all over
  // no rows is not what anyone means by that.
  if (rowIds.length === 0) return "none";
  let hits = 0;
  for (const id of rowIds) if (selected.has(id)) hits++;
  if (hits === 0) return "none";
  return hits === rowIds.length ? "all" : "some";
}

/**
 * Selects `rowIds` if any of them is unselected, clears them if all are.
 *
 * Ids outside `rowIds` are untouched, which is what makes this work for a
 * per-group select-all as well as the header: toggling one group must not
 * clear another group's rows.
 */
export function toggleIds(
  selected: ReadonlySet<string>,
  rowIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const all = rowIds.length > 0 && rowIds.every((id) => selected.has(id));
  for (const id of rowIds) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}
