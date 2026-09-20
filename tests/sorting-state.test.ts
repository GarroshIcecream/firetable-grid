import { describe, expect, test } from "bun:test";
import type { SortingState } from "@tanstack/react-table";

import {
  areSortingStatesEqual,
  getColumnSortState,
  normalizeSortingState,
  toggleColumnSorting,
} from "../src";

describe("sorting-state", () => {
  const sortableIds = new Set(["price", "make", "year", "mileage"]);

  test("normalizeSortingState drops unsortable ids and duplicate columns", () => {
    const input: SortingState = [
      { id: "price", desc: true },
      { id: "thumbnail", desc: false },
      { id: "make", desc: false },
      { id: "price", desc: false },
    ];

    expect(normalizeSortingState(input, sortableIds)).toEqual([
      { id: "price", desc: true },
      { id: "make", desc: false },
    ]);
  });

  test("normalizeSortingState normalizes desc and caps sort count", () => {
    const input = [
      { id: "price", desc: true },
      { id: "make", desc: undefined },
      { id: "year", desc: false },
      { id: "mileage", desc: true },
    ] as unknown as SortingState;

    expect(normalizeSortingState(input, sortableIds, 3)).toEqual([
      { id: "price", desc: true },
      { id: "make", desc: false },
      { id: "year", desc: false },
    ]);
  });

  test("areSortingStatesEqual compares order and direction", () => {
    expect(
      areSortingStatesEqual(
        [
          { id: "price", desc: true },
          { id: "make", desc: false },
        ],
        [
          { id: "price", desc: true },
          { id: "make", desc: false },
        ],
      ),
    ).toBe(true);

    expect(
      areSortingStatesEqual(
        [
          { id: "price", desc: true },
          { id: "make", desc: false },
        ],
        [
          { id: "make", desc: false },
          { id: "price", desc: true },
        ],
      ),
    ).toBe(false);
  });

  test("getColumnSortState returns direction and visible sort order", () => {
    const sorting: SortingState = [
      { id: "price", desc: true },
      { id: "make", desc: false },
    ];

    expect(getColumnSortState(sorting, "price")).toEqual({
      direction: "desc",
      index: 0,
    });
    expect(getColumnSortState(sorting, "make")).toEqual({
      direction: "asc",
      index: 1,
    });
    expect(getColumnSortState(sorting, "thumbnail")).toBe(null);
  });

  test("toggleColumnSorting cycles single-column sorting asc, desc, none", () => {
    const first = toggleColumnSorting([], "price", { sortableIds });
    expect(first).toEqual([{ id: "price", desc: false }]);

    const second = toggleColumnSorting(first, "price", { sortableIds });
    expect(second).toEqual([{ id: "price", desc: true }]);

    expect(toggleColumnSorting(second, "price", { sortableIds })).toEqual([]);
  });

  test("toggleColumnSorting supports multi-sort without duplicating columns", () => {
    const existing: SortingState = [
      { id: "price", desc: false },
      { id: "make", desc: false },
    ];

    expect(
      toggleColumnSorting(existing, "year", { multi: true, sortableIds }),
    ).toEqual([
      { id: "price", desc: false },
      { id: "make", desc: false },
      { id: "year", desc: false },
    ]);

    expect(
      toggleColumnSorting(existing, "price", { multi: true, sortableIds }),
    ).toEqual([
      { id: "price", desc: true },
      { id: "make", desc: false },
    ]);
  });

  test("toggleColumnSorting refuses to add a new column once multi-sort is at the cap", () => {
    const input: SortingState = [
      { id: "price", desc: false },
      { id: "make", desc: false },
      { id: "year", desc: false },
    ];

    expect(
      toggleColumnSorting(input, "mileage", {
        multi: true,
        sortableIds,
        maxSortColumns: 3,
      }),
    ).toEqual(input);
  });

  test("toggleColumnSorting still cycles an already-sorted column at the cap", () => {
    const full: SortingState = [
      { id: "price", desc: false },
      { id: "make", desc: false },
      { id: "year", desc: false },
    ];

    const flipped = toggleColumnSorting(full, "make", {
      multi: true,
      sortableIds,
      maxSortColumns: 3,
    });
    expect(flipped).toEqual([
      { id: "price", desc: false },
      { id: "make", desc: true },
      { id: "year", desc: false },
    ]);

    expect(
      toggleColumnSorting(flipped, "make", {
        multi: true,
        sortableIds,
        maxSortColumns: 3,
      }),
    ).toEqual([
      { id: "price", desc: false },
      { id: "year", desc: false },
    ]);
  });
});
