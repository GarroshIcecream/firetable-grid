import { describe, expect, test } from "bun:test";

import {
  fromTanstackSorting,
  getColumnSort,
  normalizeSort,
  type SortRule,
  sortRulesEqual,
  toggleSort,
  toTanstackSorting,
} from "../src";

describe("sorting-state", () => {
  const sortableFields = new Set(["price", "make", "year", "mileage"]);

  test("normalizeSort drops unsortable fields and duplicate columns", () => {
    const input: SortRule[] = [
      { field: "price", dir: "desc" },
      { field: "thumbnail", dir: "asc" },
      { field: "make", dir: "asc" },
      { field: "price", dir: "asc" },
    ];

    expect(normalizeSort(input, sortableFields)).toEqual([
      { field: "price", dir: "desc" },
      { field: "make", dir: "asc" },
    ]);
  });

  test("normalizeSort coerces an unrecognized direction and caps the count", () => {
    // A stored view written against an older schema can carry anything here;
    // it must degrade to ascending rather than sorting by a garbage value.
    const input = [
      { field: "price", dir: "desc" },
      { field: "make", dir: undefined },
      { field: "year", dir: "asc" },
      { field: "mileage", dir: "desc" },
    ] as unknown as SortRule[];

    expect(normalizeSort(input, sortableFields, 3)).toEqual([
      { field: "price", dir: "desc" },
      { field: "make", dir: "asc" },
      { field: "year", dir: "asc" },
    ]);
  });

  test("sortRulesEqual compares order and direction", () => {
    expect(
      sortRulesEqual(
        [
          { field: "price", dir: "desc" },
          { field: "make", dir: "asc" },
        ],
        [
          { field: "price", dir: "desc" },
          { field: "make", dir: "asc" },
        ],
      ),
    ).toBe(true);

    expect(
      sortRulesEqual(
        [
          { field: "price", dir: "desc" },
          { field: "make", dir: "asc" },
        ],
        [
          { field: "make", dir: "asc" },
          { field: "price", dir: "desc" },
        ],
      ),
    ).toBe(false);
  });

  test("getColumnSort returns direction and visible sort order", () => {
    const sort: SortRule[] = [
      { field: "price", dir: "desc" },
      { field: "make", dir: "asc" },
    ];

    expect(getColumnSort(sort, "price")).toEqual({ dir: "desc", index: 0 });
    expect(getColumnSort(sort, "make")).toEqual({ dir: "asc", index: 1 });
    expect(getColumnSort(sort, "thumbnail")).toBe(null);
  });

  test("toggleSort cycles single-column sorting asc, desc, none", () => {
    const first = toggleSort([], "price", { sortableFields });
    expect(first).toEqual([{ field: "price", dir: "asc" }]);

    const second = toggleSort(first, "price", { sortableFields });
    expect(second).toEqual([{ field: "price", dir: "desc" }]);

    expect(toggleSort(second, "price", { sortableFields })).toEqual([]);
  });

  test("toggleSort replaces the whole sort when not additive", () => {
    const existing: SortRule[] = [
      { field: "price", dir: "asc" },
      { field: "make", dir: "asc" },
    ];
    expect(toggleSort(existing, "year", { sortableFields })).toEqual([
      { field: "year", dir: "asc" },
    ]);
  });

  test("toggleSort supports multi-sort without duplicating columns", () => {
    const existing: SortRule[] = [
      { field: "price", dir: "asc" },
      { field: "make", dir: "asc" },
    ];

    expect(
      toggleSort(existing, "year", { multi: true, sortableFields }),
    ).toEqual([
      { field: "price", dir: "asc" },
      { field: "make", dir: "asc" },
      { field: "year", dir: "asc" },
    ]);

    expect(
      toggleSort(existing, "price", { multi: true, sortableFields }),
    ).toEqual([
      { field: "price", dir: "desc" },
      { field: "make", dir: "asc" },
    ]);
  });

  test("toggleSort ignores a column that cannot sort", () => {
    const existing: SortRule[] = [{ field: "price", dir: "asc" }];
    expect(toggleSort(existing, "thumbnail", { sortableFields })).toEqual(
      existing,
    );
  });

  test("toggleSort refuses to add a new column once multi-sort is at the cap", () => {
    const input: SortRule[] = [
      { field: "price", dir: "asc" },
      { field: "make", dir: "asc" },
      { field: "year", dir: "asc" },
    ];

    expect(
      toggleSort(input, "mileage", {
        multi: true,
        sortableFields,
        maxSortColumns: 3,
      }),
    ).toEqual(input);
  });

  test("toggleSort still cycles an already-sorted column at the cap", () => {
    const full: SortRule[] = [
      { field: "price", dir: "asc" },
      { field: "make", dir: "asc" },
      { field: "year", dir: "asc" },
    ];

    const flipped = toggleSort(full, "make", {
      multi: true,
      sortableFields,
      maxSortColumns: 3,
    });
    expect(flipped).toEqual([
      { field: "price", dir: "asc" },
      { field: "make", dir: "desc" },
      { field: "year", dir: "asc" },
    ]);

    expect(
      toggleSort(flipped, "make", {
        multi: true,
        sortableFields,
        maxSortColumns: 3,
      }),
    ).toEqual([
      { field: "price", dir: "asc" },
      { field: "year", dir: "asc" },
    ]);
  });
});

// TanStack's `{ id, desc }` is confined to these two functions. If they stop
// round-tripping, every sort in the grid and every exported file drifts from
// what the stored view says - silently, because both shapes are plausible.
describe("the TanStack boundary", () => {
  const sort: SortRule[] = [
    { field: "price", dir: "desc" },
    { field: "make", dir: "asc" },
  ];

  test("toTanstackSorting maps field→id and dir→desc", () => {
    expect(toTanstackSorting(sort)).toEqual([
      { id: "price", desc: true },
      { id: "make", desc: false },
    ]);
  });

  test("fromTanstackSorting inverts it", () => {
    expect(fromTanstackSorting(toTanstackSorting(sort))).toEqual(sort);
  });

  test("an empty sort stays empty in both directions", () => {
    expect(toTanstackSorting([])).toEqual([]);
    expect(fromTanstackSorting([])).toEqual([]);
  });
});
