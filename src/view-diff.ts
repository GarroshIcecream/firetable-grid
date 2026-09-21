// Comparing a live view against the baseline it was loaded from - "does this
// view have unsaved changes?".
//
// Every rule here exists because of a bug that reached users, and each is
// commented with the bug rather than the mechanism. Without that, a rule like
// "compare structurally, never by JSON.stringify" reads as a pointless
// indirection and gets simplified away by the next reader.
//
// `dequal` is this package's only runtime dependency - MIT, dependency-free,
// and the same comparison FireTable's saved views already use.

import { dequal } from "dequal";

import {
  type ColumnLayoutState,
  type GridView,
  hiddenColumnIds,
} from "./grid-view";

export type ViewField = "search" | "filter" | "sort" | "group" | "columns";

export interface ViewDiff {
  dirty: boolean;
  /** Which top-level fields diverge, in `GridView` declaration order. A UI can
   *  say "sort and columns changed" instead of only lighting up a dot. */
  changed: ViewField[];
}

/** Order-insensitive comparison of two id collections. */
function sameIds(a: Iterable<string>, b: Iterable<string>): boolean {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size !== y.size) return false;
  for (const id of x) {
    if (!y.has(id)) return false;
  }
  return true;
}

function columnsDiffer(
  current: ColumnLayoutState | undefined,
  baseline: ColumnLayoutState | undefined,
): boolean {
  // Each field inside the layout is tracked independently, by its presence in
  // the BASELINE - the same rule as the top level. A view that stores `order`
  // but not `sizes` must not flag dirty when someone resizes a column.
  const base = baseline ?? {};
  const live = current ?? {};

  if ("order" in base && !dequal(live.order ?? [], base.order ?? [])) {
    return true;
  }
  if (
    "visibility" in base &&
    !sameIds(hiddenColumnIds(live.visibility), hiddenColumnIds(base.visibility))
  ) {
    return true;
  }
  // A view that has never been resized stores nothing; the live grid holds {}.
  if ("sizes" in base && !dequal(live.sizes ?? {}, base.sizes ?? {})) {
    return true;
  }
  // Pin order is not meaningful, so a reordered but identical list is clean.
  if ("pinned" in base && !sameIds(live.pinned ?? [], base.pinned ?? [])) {
    return true;
  }
  return false;
}

/**
 * Which parts of `current` diverge from `baseline`.
 *
 * `baseline` is a `Partial<GridView>`: a key it does not carry is NOT COMPARED.
 * That is the whole reason for the partial. A preset view stores no column
 * layout, and comparing it against one it never had flags every preset dirty
 * the moment it loads. Presence is tested with `in` rather than against
 * `undefined`, because `filter: null` means "explicitly unfiltered" and has to
 * stay distinguishable from "not tracked".
 *
 * A baseline of `{}` therefore tracks nothing and is never dirty, which is
 * correct: a view that stores no state cannot diverge from one.
 */
export function diffView(
  current: GridView,
  baseline: Partial<GridView>,
): ViewDiff {
  const changed: ViewField[] = [];

  if ("search" in baseline && current.search !== baseline.search) {
    changed.push("search");
  }
  if ("filter" in baseline && !dequal(current.filter, baseline.filter)) {
    changed.push("filter");
  }
  if ("sort" in baseline && !dequal(current.sort, baseline.sort)) {
    changed.push("sort");
  }
  if ("group" in baseline && !dequal(current.group, baseline.group)) {
    changed.push("group");
  }
  if (
    "columns" in baseline &&
    columnsDiffer(current.columns, baseline.columns)
  ) {
    changed.push("columns");
  }

  return { dirty: changed.length > 0, changed };
}

/** Whether a view has unsaved changes against the baseline it was loaded from. */
export function isViewDirty(
  current: GridView,
  baseline: Partial<GridView>,
): boolean {
  return diffView(current, baseline).dirty;
}
