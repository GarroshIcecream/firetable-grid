import { describe, expect, test } from "bun:test";

import {
  resolveSelectionClick,
  selectExportColumns,
  selectionColumn,
  selectionStateOf,
  toggleIds,
} from "../src";
import { SELECTION_COLUMN_ID, SELECTION_COLUMN_WIDTH } from "../src/layout";

// Selection is decided against the ORDER THE ROWS ARE RENDERED IN, not the
// order they arrived in. That is the whole reason this is engine logic rather
// than a checkbox handler: a shift-click has to mean "everything between these
// two rows as the user sees them", which after a sort, a filter and a collapsed
// group is nothing like the source array.

const ids = (s: Set<string>) => [...s].sort();

describe("resolveSelectionClick", () => {
  const order = ["a", "b", "c", "d", "e"];

  test("a plain click selects one row and becomes the anchor", () => {
    const r = resolveSelectionClick(new Set(["a", "b"]), order, "d", null);
    expect(ids(r.selected)).toEqual(["d"]);
    expect(r.anchorId).toBe("d");
  });

  test("an additive click toggles one row and keeps the rest", () => {
    const add = resolveSelectionClick(new Set(["a"]), order, "c", "a", {
      additive: true,
    });
    expect(ids(add.selected)).toEqual(["a", "c"]);
    expect(add.anchorId).toBe("c");

    const remove = resolveSelectionClick(new Set(["a", "c"]), order, "c", "a", {
      additive: true,
    });
    expect(ids(remove.selected)).toEqual(["a"]);
  });

  test("a range click selects everything between the anchor and the click", () => {
    const r = resolveSelectionClick(new Set(["b"]), order, "d", "b", {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["b", "c", "d"]);
  });

  test("a range works backwards as well as forwards", () => {
    const r = resolveSelectionClick(new Set(["d"]), order, "b", "d", {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["b", "c", "d"]);
  });

  test("a range keeps the anchor, so dragging the far end re-extends it", () => {
    const first = resolveSelectionClick(new Set(), order, "c", "b", {
      range: true,
    });
    expect(first.anchorId).toBe("b");
    const wider = resolveSelectionClick(first.selected, order, "e", "b", {
      range: true,
    });
    expect(ids(wider.selected)).toEqual(["b", "c", "d", "e"]);
  });

  test("a range unions with what was already selected", () => {
    const r = resolveSelectionClick(new Set(["a"]), order, "d", "c", {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["a", "c", "d"]);
  });

  test("a range with no anchor behaves as a plain click", () => {
    const r = resolveSelectionClick(new Set(["a"]), order, "d", null, {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["d"]);
    expect(r.anchorId).toBe("d");
  });

  test("a range whose anchor is no longer rendered behaves as a plain click", () => {
    // The anchor row was filtered away, or its group was collapsed, between
    // the two clicks. Extending to an index that does not exist would select
    // an arbitrary span.
    const r = resolveSelectionClick(new Set(["a"]), order, "d", "gone", {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["d"]);
    expect(r.anchorId).toBe("d");
  });

  test("a range spans only the rows actually rendered", () => {
    // `order` here is the flat item list with a collapsed group's rows absent,
    // so shift-clicking across it selects what the user can see and nothing
    // hidden underneath.
    const visible = ["a", "e"]; // b, c, d are inside a collapsed group
    const r = resolveSelectionClick(new Set(), visible, "e", "a", {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["a", "e"]);
  });

  test("clicking the anchor itself with shift selects just it", () => {
    const r = resolveSelectionClick(new Set(), order, "c", "c", {
      range: true,
    });
    expect(ids(r.selected)).toEqual(["c"]);
  });

  test("the returned set is always a fresh copy", () => {
    const current = new Set(["a"]);
    const r = resolveSelectionClick(current, order, "b", "a", {
      additive: true,
    });
    expect(r.selected).not.toBe(current);
    expect(ids(current)).toEqual(["a"]);
  });
});

describe("selectionStateOf", () => {
  test("reports none, some or all for a header checkbox", () => {
    const rows = ["a", "b", "c"];
    expect(selectionStateOf(new Set(), rows)).toBe("none");
    expect(selectionStateOf(new Set(["b"]), rows)).toBe("some");
    expect(selectionStateOf(new Set(["a", "b", "c"]), rows)).toBe("all");
  });

  test("selections outside the given rows do not make it 'some'", () => {
    // A row selected before a filter narrowed the view must not leave the
    // header checkbox indeterminate over rows that are all unselected.
    expect(selectionStateOf(new Set(["z"]), ["a", "b"])).toBe("none");
  });

  test("no rows is 'none', never 'all'", () => {
    // Vacuously every row is selected, but an empty grid must not render a
    // ticked select-all.
    expect(selectionStateOf(new Set(), [])).toBe("none");
    expect(selectionStateOf(new Set(["a"]), [])).toBe("none");
  });
});

describe("toggleIds", () => {
  test("selects the whole set when any of it is unselected", () => {
    expect(ids(toggleIds(new Set(["a"]), ["a", "b", "c"]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("clears the whole set when all of it is selected", () => {
    expect(ids(toggleIds(new Set(["a", "b", "c"]), ["a", "b", "c"]))).toEqual(
      [],
    );
  });

  test("leaves selections outside the set alone", () => {
    // This is what makes it usable for a per-group select-all: toggling one
    // group must not clear another group's rows.
    expect(ids(toggleIds(new Set(["z", "a"]), ["a", "b"]))).toEqual([
      "a",
      "b",
      "z",
    ]);
    expect(ids(toggleIds(new Set(["z", "a", "b"]), ["a", "b"]))).toEqual(["z"]);
  });

  test("toggling nothing is a no-op copy", () => {
    const current = new Set(["a"]);
    const next = toggleIds(current, []);
    expect(ids(next)).toEqual(["a"]);
    expect(next).not.toBe(current);
  });
});

describe("selectionColumn", () => {
  test("is frozen, unexportable, and inert to every data operation", () => {
    const c = selectionColumn();
    expect(c.id).toBe(SELECTION_COLUMN_ID);
    expect(c.width).toBe(SELECTION_COLUMN_WIDTH);
    expect(c.frozen).toBe(true);
    // A checkbox column reaching a CSV, or offering itself to the column
    // manager as something to hide, is never what anyone wants.
    expect(c.exportable).toBe(false);
    expect(c.manageable).toBe(false);
    expect(c.sortable).toBe(false);
    expect(c.groupable).toBe(false);
    expect(c.type.aggregatable).toBe(false);
    expect(c.type.filterType).toBe(null);
  });

  test("selectExportColumns leaves it out of a file", () => {
    const columns = [selectionColumn<{ a: string }>()];
    expect(selectExportColumns(columns, [], {}, [{ a: "x" }])).toEqual([]);
  });
});
