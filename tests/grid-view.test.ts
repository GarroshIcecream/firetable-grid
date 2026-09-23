import { describe, expect, test } from "bun:test";

import {
  all,
  any,
  applyView,
  emptyGridView,
  FILTER_OP,
  type GridView,
  hiddenColumnIds,
  isColumnLayoutEmpty,
  isGridViewEmpty,
  where,
} from "../src";

const { lte, is } = FILTER_OP;

// The shape this replaced exposed a shared frozen `EMPTY_FILTER_AST` whose
// documented spread copied array *references*, so one `push` downstream
// appended to the constant every other view was also spreading - a filter
// leaking into unrelated views and, on a server, across requests and tenants.
// There is no shared constant now: `emptyGridView()` hands back fresh state
// every time, so there is nothing to corrupt.

describe("emptyGridView()", () => {
  test("returns a fresh view, with its own arrays, each call", () => {
    const a = emptyGridView();
    const b = emptyGridView();
    expect(a).not.toBe(b);
    expect(a.sort).not.toBe(b.sort);
  });

  test("building one up by mutation cannot reach another", () => {
    const a = emptyGridView();
    const b = emptyGridView();

    a.sort.push({ field: "price", dir: "desc" });
    a.filter = where("fuel", is, "diesel");
    a.search = "estate";
    a.group = { field: "make" };

    expect(b).toEqual(emptyGridView());
    expect(isGridViewEmpty(b)).toBe(true);
  });

  test("starts out empty and unfiltering", () => {
    const view = emptyGridView();
    expect(isGridViewEmpty(view)).toBe(true);
    expect(view).toEqual({ search: "", filter: null, sort: [], group: null });
    expect(applyView([{ price: 1 }], view, [])).toHaveLength(1);
  });

  test("an unfiltered view returns a copy, not the caller's array", () => {
    const rows = [{ price: 1 }, { price: 2 }];
    const out = applyView(rows, emptyGridView(), []);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
});

describe("isGridViewEmpty", () => {
  test("any one field being set makes the view non-empty", () => {
    const cases: Array<Partial<GridView>> = [
      { search: "estate" },
      { filter: where("price", lte, "1") },
      { sort: [{ field: "price", dir: "asc" }] },
      { group: { field: "make" } },
    ];
    for (const over of cases) {
      expect(isGridViewEmpty({ ...emptyGridView(), ...over })).toBe(false);
    }
  });
});

// A view is worth having as one object only if it survives a round trip to
// storage. No functions, no class instances, no `undefined`-only fields.
describe("a view is plain JSON", () => {
  test("survives JSON.stringify → JSON.parse unchanged", () => {
    const view: GridView = {
      search: "estate",
      filter: all(
        where("price", lte, "25000"),
        any(where("fuel", is, "diesel"), where("fuel", is, "hybrid")),
      ),
      sort: [
        { field: "price", dir: "desc" },
        { field: "make", dir: "asc" },
      ],
      group: { field: "added", mode: "relative" },
    };

    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  test("a default view round-trips too", () => {
    const view = emptyGridView();
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("hiddenColumnIds", () => {
  test("collects only the ids explicitly mapped to false", () => {
    // The visibility record is sparse: absent means visible, and a `true`
    // entry is a column manager writing the default back. Both must read as
    // "not hidden", or a view that has been through a column manager looks
    // different from one that has not.
    expect([...hiddenColumnIds({ a: false, b: true, c: false })]).toEqual([
      "a",
      "c",
    ]);
    expect(hiddenColumnIds({ a: true }).size).toBe(0);
    expect(hiddenColumnIds({}).size).toBe(0);
    expect(hiddenColumnIds(undefined).size).toBe(0);
  });
});

describe("isColumnLayoutEmpty", () => {
  test("an absent or blank layout is empty", () => {
    expect(isColumnLayoutEmpty(undefined)).toBe(true);
    expect(isColumnLayoutEmpty({})).toBe(true);
    expect(isColumnLayoutEmpty({ order: [], pinned: [], sizes: {} })).toBe(
      true,
    );
  });

  test("a visibility record of nothing but `true` is still empty", () => {
    expect(isColumnLayoutEmpty({ visibility: { a: true } })).toBe(true);
  });

  test("any real layout is not empty", () => {
    expect(isColumnLayoutEmpty({ order: ["a"] })).toBe(false);
    expect(isColumnLayoutEmpty({ visibility: { a: false } })).toBe(false);
    expect(isColumnLayoutEmpty({ sizes: { a: 120 } })).toBe(false);
    expect(isColumnLayoutEmpty({ pinned: ["a"] })).toBe(false);
  });
});

describe("a view carrying a column layout", () => {
  test("isGridViewEmpty accounts for the layout", () => {
    expect(
      isGridViewEmpty({
        ...emptyGridView(),
        columns: { visibility: { a: true } },
      }),
    ).toBe(true);
    expect(
      isGridViewEmpty({ ...emptyGridView(), columns: { order: ["a"] } }),
    ).toBe(false);
  });

  test("emptyGridView carries no layout at all", () => {
    // Absent, not `{}`: a default view tracks no columns, and the diff reads
    // an absent key as "not tracked".
    expect("columns" in emptyGridView()).toBe(false);
  });

  test("a layout survives the JSON round trip", () => {
    const view: GridView = {
      ...emptyGridView(),
      columns: {
        order: ["b", "a"],
        visibility: { c: false },
        sizes: { a: 120 },
        pinned: ["b"],
      },
    };
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
