import { describe, expect, test } from "bun:test";

import {
  all,
  any,
  applyView,
  emptyGridView,
  type GridView,
  isGridViewEmpty,
  where,
} from "../src";

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
    a.filter = where("fuel", "is", "diesel");
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
      { filter: where("price", "≤", "1") },
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
        where("price", "≤", "25000"),
        any(where("fuel", "is", "diesel"), where("fuel", "is", "hybrid")),
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
