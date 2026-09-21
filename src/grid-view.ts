// A grid's entire user-facing state in one serializable object — one field per
// thing a user can do to a table:
//
//   search  what they typed into the search box
//   filter  the conditions they built, as a tree
//   sort    which columns order the rows, in priority order
//   group   which column breaks the rows into sections
//
// That is the whole type. It is plain JSON with no functions in it, so a saved
// view really is `JSON.stringify(view)` — which is what makes "share this view"
// and "restore my last view" a storage problem rather than a modelling one.
//
// Deliberately absent: `getGroupValue` (a function, so it cannot serialize) and
// the collapsed-group set (ephemeral scroll-level UI state that nobody wants
// restored from a link three weeks later). Both stay component props.

import type { DateGroupMode } from "./date-grouping";
import type { FilterNode } from "./filter-engine";

export type SortDirection = "asc" | "desc";

/** One column's contribution to the sort, most significant first in `sort`. */
export interface SortRule {
  field: string;
  dir: SortDirection;
}

/** Which column sections the rows. `mode` only means anything for date
 *  columns, where "relative" buckets into today / yesterday / this week. */
export interface GroupRule {
  field: string;
  mode?: DateGroupMode;
}

/**
 * A view's column layout. Every field is optional, and so is `columns` itself,
 * because "this view does not track that" is a real state and not the same as
 * "this view tracks it and it is empty".
 *
 * A preset or system view stores no layout at all: loading it must leave the
 * current columns alone, and diffing it must not compare them. Encoding that as
 * an absent key rather than an empty object is what lets `diffView` express the
 * rule once instead of at every call site.
 */
export interface ColumnLayoutState {
  /** Column ids in display order. Ids not listed are appended in schema order. */
  order?: string[];
  /** Sparse: absent means visible, `false` means hidden. Matches
   *  `isColumnVisible`, which three other call sites already read. */
  visibility?: Record<string, boolean>;
  /** Pixel widths by column id, overriding each column's own `width`. */
  sizes?: Record<string, number>;
  /** USER pins, merged with the columns' own schema `frozen` flag. */
  pinned?: string[];
}

export interface GridView {
  search: string;
  /** `null` means unfiltered. See `./filter-engine` for the node shape and the
   *  `where` / `all` / `any` builders that make one readable to write. */
  filter: FilterNode | null;
  sort: SortRule[];
  group: GroupRule | null;
  /** Order, visibility, widths and pins. Absent means this view does not carry
   *  a column layout — see `ColumnLayoutState`. */
  columns?: ColumnLayoutState;
}

/**
 * A fresh default view. Every call returns its own object and its own `sort`
 * array, so building one up by mutation cannot reach back into another view —
 * the failure mode a shared frozen constant used to trade one footgun for.
 */
export function emptyGridView(): GridView {
  return { search: "", filter: null, sort: [], group: null };
}

/**
 * The ids a visibility record actually hides.
 *
 * `{}`, `{ a: true }` and a record a column manager rebuilt from scratch all
 * describe the same visible set, so comparing records directly reports
 * differences that no user can see. Every comparison goes through this instead.
 */
export function hiddenColumnIds(
  visibility: Readonly<Record<string, boolean>> | undefined,
): Set<string> {
  const hidden = new Set<string>();
  if (!visibility) return hidden;
  for (const [id, visible] of Object.entries(visibility)) {
    if (visible === false) hidden.add(id);
  }
  return hidden;
}

/** True when a layout describes nothing: no order, no pins, no widths, and
 *  nothing hidden. */
export function isColumnLayoutEmpty(
  columns: ColumnLayoutState | undefined,
): boolean {
  if (!columns) return true;
  return (
    (columns.order?.length ?? 0) === 0 &&
    (columns.pinned?.length ?? 0) === 0 &&
    Object.keys(columns.sizes ?? {}).length === 0 &&
    hiddenColumnIds(columns.visibility).size === 0
  );
}

/** True when nothing is set: no query, no filter, no sort, no grouping and no
 *  column layout. This is "the user has not touched anything", which is the
 *  question a "reset view" button wants answered — not "does this narrow the
 *  rows". */
export function isGridViewEmpty(view: GridView): boolean {
  return (
    view.search === "" &&
    view.filter === null &&
    view.sort.length === 0 &&
    view.group === null &&
    isColumnLayoutEmpty(view.columns)
  );
}
