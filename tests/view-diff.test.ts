import { describe, expect, test } from "bun:test";

import {
  all,
  any,
  diffView,
  emptyGridView,
  type GridView,
  isViewDirty,
  where,
} from "../src";

// Every rule below is carried over from FireTable's `computeIsDirty`, and each
// one exists because of a bug that reached users. The describe names say which
// bug, because the mechanism alone reads as a pointless indirection and gets
// "simplified" away.

const view = (over: Partial<GridView> = {}): GridView => ({
  ...emptyGridView(),
  ...over,
});

describe("a view does not diverge from itself", () => {
  test("a fully populated view is clean against its own copy", () => {
    const v = view({
      search: "estate",
      filter: all(where("price", "≤", "25000"), any(where("fuel", "is", "d"))),
      sort: [{ field: "price", dir: "desc" }],
      group: { field: "make" },
      columns: {
        order: ["a", "b"],
        visibility: { c: false },
        sizes: { a: 120 },
        pinned: ["a"],
      },
    });
    expect(diffView(v, v)).toEqual({ dirty: false, changed: [] });
  });
});

describe("a field the baseline does not track is not compared", () => {
  // A preset view stores no column layout. Comparing against one it never had
  // flags every preset dirty the moment it loads.
  test("an empty baseline tracks nothing and is never dirty", () => {
    expect(isViewDirty(view({ search: "x", sort: [] }), {})).toBe(false);
  });

  test("a baseline without `columns` ignores the whole layout", () => {
    const current = view({ columns: { order: ["a"], sizes: { a: 9 } } });
    expect(isViewDirty(current, { search: "" })).toBe(false);
  });

  test("a baseline tracking only `order` ignores a resize", () => {
    // A view that stores order but not sizes must not flag dirty when someone
    // drags a column edge.
    const current = view({ columns: { order: ["a"], sizes: { a: 300 } } });
    expect(isViewDirty(current, { columns: { order: ["a"] } })).toBe(false);
    expect(isViewDirty(current, { columns: { order: ["b"] } })).toBe(true);
  });
});

describe("an explicit null is tracked, an absent key is not", () => {
  // `filter: null` means "explicitly unfiltered" and has to stay
  // distinguishable from "untracked" - which is why presence is tested with
  // `in` rather than against undefined.
  test("a baseline with filter null flags an added filter", () => {
    const current = view({ filter: where("price", "≤", "1") });
    expect(isViewDirty(current, { filter: null })).toBe(true);
  });

  test("a baseline with no filter key ignores the same change", () => {
    const current = view({ filter: where("price", "≤", "1") });
    expect(isViewDirty(current, {})).toBe(false);
  });

  test("the same holds for group", () => {
    const current = view({ group: { field: "make" } });
    expect(isViewDirty(current, { group: null })).toBe(true);
    expect(isViewDirty(current, {})).toBe(false);
  });
});

describe("key order does not make a view dirty", () => {
  // Postgres `jsonb` does not preserve object key order, so a view round-
  // tripped through the database comes back rearranged. A JSON.stringify
  // comparison reports a spurious diff after every single save.
  test("two filters built with different key order are equal", () => {
    const a: GridView = view({
      filter: { kind: "where", field: "price", op: "≤", value: "1" },
    });
    const b: GridView = view({
      filter: { value: "1", op: "≤", field: "price", kind: "where" } as never,
    });
    expect(isViewDirty(a, b)).toBe(false);
  });

  test("sizes records with different insertion order are equal", () => {
    const a = view({ columns: { sizes: { a: 1, b: 2 } } });
    const b = view({ columns: { sizes: { b: 2, a: 1 } } });
    expect(isViewDirty(a, b)).toBe(false);
  });
});

describe("pins compare as a set", () => {
  // Pin order is not meaningful; comparing arrays flags a reordered but
  // identical pin list dirty.
  test("reordered pins are clean", () => {
    expect(
      isViewDirty(view({ columns: { pinned: ["a", "b"] } }), {
        columns: { pinned: ["b", "a"] },
      }),
    ).toBe(false);
  });

  test("a genuinely different pin set is dirty", () => {
    expect(
      isViewDirty(view({ columns: { pinned: ["a"] } }), {
        columns: { pinned: ["a", "b"] },
      }),
    ).toBe(true);
  });
});

describe("visibility compares hidden ids", () => {
  test("absent and `true` agree", () => {
    expect(
      isViewDirty(view({ columns: { visibility: { a: true } } }), {
        columns: { visibility: {} },
      }),
    ).toBe(false);
  });

  test("hiding a column is dirty", () => {
    expect(
      isViewDirty(view({ columns: { visibility: { a: false } } }), {
        columns: { visibility: {} },
      }),
    ).toBe(true);
  });
});

describe("undefined and empty agree", () => {
  test("a view that has never been resized matches a baseline of {}", () => {
    // The stored view has no `sizes`; the live grid holds `{}`.
    expect(
      isViewDirty(view({ columns: { order: ["a"] } }), {
        columns: { order: ["a"], sizes: {} },
      }),
    ).toBe(false);
  });
});

describe("changed names the fields that moved", () => {
  test("it lists every diverging field in declaration order", () => {
    const current = view({
      search: "x",
      sort: [{ field: "a", dir: "asc" }],
      columns: { order: ["b"] },
    });
    const baseline: Partial<GridView> = {
      search: "",
      filter: null,
      sort: [],
      group: null,
      columns: { order: ["a"] },
    };
    expect(diffView(current, baseline).changed).toEqual([
      "search",
      "sort",
      "columns",
    ]);
  });
});
