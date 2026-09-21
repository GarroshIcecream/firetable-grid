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

export interface GridView {
  search: string;
  /** `null` means unfiltered. See `./filter-engine` for the node shape and the
   *  `where` / `all` / `any` builders that make one readable to write. */
  filter: FilterNode | null;
  sort: SortRule[];
  group: GroupRule | null;
}

/**
 * A fresh default view. Every call returns its own object and its own `sort`
 * array, so building one up by mutation cannot reach back into another view —
 * the failure mode a shared frozen constant used to trade one footgun for.
 */
export function emptyGridView(): GridView {
  return { search: "", filter: null, sort: [], group: null };
}

/** True when nothing is set: no query, no filter, no sort, no grouping. This
 *  is "the user has not touched anything", which is the question a "reset
 *  view" button wants answered — not "does this narrow the rows". */
export function isGridViewEmpty(view: GridView): boolean {
  return (
    view.search === "" &&
    view.filter === null &&
    view.sort.length === 0 &&
    view.group === null
  );
}
