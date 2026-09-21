import { describe, expect, test } from "bun:test";

import {
  buildFlatItems,
  EMPTY_GROUP_KEY,
  type GroupValueFn,
  groupSortDirection,
} from "../src/layout";

// buildFlatItems turns rows + a grouping field into a flat list of group
// headers and rows. The default behaviour groups on the stringified raw value;
// date columns inject a custom resolver. These tests lock in both paths and the
// key-vs-label split that lets relative buckets display a name while sorting by
// a recency ordinal.

const make = (vals: unknown[]) =>
  vals.map(
    (v) => ({ original: { make: v } }) as { original: { make: unknown } },
  );

const headers = (items: ReturnType<typeof buildFlatItems>) =>
  items
    .filter((i) => i.type === "group-header")
    .map((i) => i as { key: string; label: string; count: number });

describe("buildFlatItems — default grouping", () => {
  test("groups by raw value; header label mirrors the key", () => {
    const items = buildFlatItems(make(["BMW", "Audi", "BMW"]), "make", "asc");
    expect(headers(items)).toEqual([
      { type: "group-header", key: "Audi", label: "Audi", count: 1 } as never,
      { type: "group-header", key: "BMW", label: "BMW", count: 2 } as never,
    ]);
  });

  test("nulls collapse into the em-dash group", () => {
    const items = buildFlatItems(make([null, "BMW"]), "make", "asc");
    const keys = headers(items).map((h) => h.key);
    expect(keys).toContain(EMPTY_GROUP_KEY);
  });

  test("no group field yields a flat row list", () => {
    const items = buildFlatItems(make(["BMW", "Audi"]), "", "asc");
    expect(items.every((i) => i.type === "row")).toBe(true);
  });
});

describe("buildFlatItems — custom (date-like) resolver", () => {
  // Resolver mimics relative-bucket grouping: distinct sortKey drives ordering
  // and grouping identity, label is the human bucket name.
  const resolver: GroupValueFn = (raw) => {
    if (raw === "2026-06-24") return { sortKey: "0", label: "Today" };
    if (raw === "2026-06-23") return { sortKey: "1", label: "Yesterday" };
    return { sortKey: "4", label: "Older" };
  };

  test("merges rows sharing a sortKey and orders by it, not by label", () => {
    const rows = make(["2026-06-23", "2026-01-01", "2026-06-24", "2025-12-01"]);
    const items = buildFlatItems(rows, "make", "asc", undefined, resolver);
    expect(headers(items)).toEqual([
      { type: "group-header", key: "0", label: "Today", count: 1 } as never,
      { type: "group-header", key: "1", label: "Yesterday", count: 1 } as never,
      { type: "group-header", key: "4", label: "Older", count: 2 } as never,
    ]);
  });

  test("desc flips group order", () => {
    const rows = make(["2026-06-24", "2026-06-23"]);
    const items = buildFlatItems(rows, "make", "desc", undefined, resolver);
    expect(headers(items).map((h) => h.label)).toEqual(["Yesterday", "Today"]);
  });
});

// Group ordering is the *sort's* job, not a separate group-direction control.
// The group headers follow the grouped column's sort direction; sorting any
// other column must leave the group order untouched (only rows within a group
// move). groupSortDirection encodes that rule for the table to feed into
// buildFlatItems.
describe("groupSortDirection — group order follows the grouped column's sort", () => {
  test("grouped column sorted desc flips the groups to desc", () => {
    expect(groupSortDirection([{ field: "make", dir: "desc" }], "make")).toBe(
      "desc",
    );
  });

  test("grouped column sorted asc keeps the groups asc", () => {
    expect(groupSortDirection([{ field: "make", dir: "asc" }], "make")).toBe(
      "asc",
    );
  });

  test("sorting a non-grouped column leaves groups in default asc order", () => {
    // The user sorts price while grouped by make: groups stay A→Z and only the
    // rows inside each group reorder — so the group direction must be asc.
    expect(groupSortDirection([{ field: "price", dir: "desc" }], "make")).toBe(
      "asc",
    );
  });

  test("no active sort defaults to asc", () => {
    expect(groupSortDirection([], "make")).toBe("asc");
  });
});

describe("buildFlatItems — rows keep their pre-sorted order within a group", () => {
  test("a non-group sort reorders rows inside each group, not the group headers", () => {
    // Rows arrive already sorted by price desc (TanStack's job); grouped by
    // make with the default asc group order (price sort doesn't touch groups).
    const rows = [
      { original: { make: "BMW", price: 90 } },
      { original: { make: "Audi", price: 80 } },
      { original: { make: "BMW", price: 40 } },
      { original: { make: "Audi", price: 30 } },
    ];
    const items = buildFlatItems(rows, "make", "asc");
    // Groups A→Z (Audi, BMW); within each, the incoming price-desc order holds.
    expect(items).toEqual([
      { type: "group-header", key: "Audi", label: "Audi", count: 2 },
      { type: "row", rowIndex: 1 }, // Audi 80
      { type: "row", rowIndex: 3 }, // Audi 30
      { type: "group-header", key: "BMW", label: "BMW", count: 2 },
      { type: "row", rowIndex: 0 }, // BMW 90
      { type: "row", rowIndex: 2 }, // BMW 40
    ]);
  });
});
