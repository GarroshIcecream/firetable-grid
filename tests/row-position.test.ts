import { describe, expect, test } from "bun:test";
import {
  columnFilteringFeature,
  constructTable,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import {
  buildFlatItems,
  buildRowPositionsFromFlatItems,
  displayRowPosition,
  type FlatItem,
} from "../src/layout";

// The `#` column is documented as "Sequential row position", but TanStack's
// `row.index` is the index in the ROOT data array. Rendering `row.index + 1`
// showed "1, 4, 7, 10" once a filter dropped rows — reported as the AI making
// row numbers jump, though any filter did it. These tests pin the invariant:
// the rendered numbers are always 1..n over the VISIBLE rows.

type Row = { id: string; fuel: string; km: number };

// v9 owns table state internally (`table.store`), so the manual
// `state`/`onStateChange` round-trip v8 needed here is gone; the row models and
// the filter/sort comparators are registered on the feature set instead of
// being passed per table.
const testFeatures = tableFeatures({
  // `constructTable` is the framework-agnostic constructor, so it needs its
  // reactivity bindings supplied - the React adapter does this for us in the app.
  coreReactivityFeature: storeReactivityBindings(),
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { equalsString: filterFn_equalsString },
  sortFns: { basic: sortFn_basic },
});

function makeTable(rows: number) {
  const data: Row[] = Array.from({ length: rows }, (_, i) => ({
    id: `car-${i + 1}`,
    fuel: i % 3 === 0 ? "diesel" : "petrol",
    km: (rows - i) * 1000,
  }));
  return constructTable<typeof testFeatures, Row>({
    features: testFeatures,
    data,
    columns: [
      { id: "id", accessorKey: "id" },
      { id: "fuel", accessorKey: "fuel", filterFn: "equalsString" },
      { id: "km", accessorKey: "km", sortFn: "basic" },
    ],
    getRowId: (r) => r.id,
    renderFallbackValue: null,
  });
}

/** What the `#` column renders for every visible row. */
function rendered(table: ReturnType<typeof makeTable>): number[] {
  const rows = table.getRowModel().rows;
  const positions = buildRowPositionsFromFlatItems(
    buildFlatItems(rows, "", "asc"),
    rows,
  );
  table.setOptions((prev) => ({
    ...prev,
    meta: { rowPositions: { current: positions } },
  }));
  return rows.map((r) => displayRowPosition(table, r));
}

const sequential = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("the # column counts visible rows", () => {
  test("unfiltered", () => {
    expect(rendered(makeTable(10))).toEqual(sequential(10));
  });

  test("filtered — the reported bug", () => {
    const table = makeTable(10);
    // Before the fix this returned [1, 4, 7, 10].
    table.setColumnFilters([{ id: "fuel", value: "diesel" }]);
    expect(rendered(table)).toEqual(sequential(4));
  });

  test("filtered and sorted together", () => {
    const table = makeTable(10);
    table.setColumnFilters([{ id: "fuel", value: "diesel" }]);
    table.setSorting([{ id: "km", desc: true }]);
    expect(rendered(table)).toEqual(sequential(4));
  });

  test("sorting alone stays sequential", () => {
    const table = makeTable(10);
    table.setSorting([{ id: "km", desc: true }]);
    expect(rendered(table)).toEqual(sequential(10));
  });

  test("clearing a filter restores the full run", () => {
    const table = makeTable(10);
    table.setColumnFilters([{ id: "fuel", value: "diesel" }]);
    table.setColumnFilters([]);
    expect(rendered(table)).toEqual(sequential(10));
  });

  test("a filter matching nothing renders no numbers", () => {
    const table = makeTable(10);
    table.setColumnFilters([{ id: "fuel", value: "hydrogen" }]);
    expect(rendered(table)).toEqual([]);
  });
});

describe("buildRowPositionsFromFlatItems", () => {
  test("ungrouped flat items match getRowModel order", () => {
    const table = makeTable(4);
    const rows = table.getRowModel().rows;
    const flatItems: FlatItem[] = rows.map((_, rowIndex) => ({
      type: "row",
      rowIndex,
    }));
    expect(buildRowPositionsFromFlatItems(flatItems, rows)).toEqual(
      new Map([
        ["car-1", 1],
        ["car-2", 2],
        ["car-3", 3],
        ["car-4", 4],
      ]),
    );
  });

  test("grouped flat items count in visual order, not getRowModel order", () => {
    // Same fixture as stock-table-grouping.test.ts: grouped by make, price-desc
    // rows within each group. Visual order is Audi 80, Audi 30, BMW 90, BMW 40.
    const originals = [
      { id: "bmw-90", make: "BMW", price: 90 },
      { id: "audi-80", make: "Audi", price: 80 },
      { id: "bmw-40", make: "BMW", price: 40 },
      { id: "audi-30", make: "Audi", price: 30 },
    ];
    const rows = originals.map((original, index) => ({
      id: original.id,
      index,
      original,
    }));
    const flatItems = buildFlatItems(rows, "make", "asc");
    const positions = buildRowPositionsFromFlatItems(
      flatItems,
      rows as unknown as Parameters<typeof buildRowPositionsFromFlatItems>[1],
    );
    const rowIdAt = (rowIndex: number) => rows[rowIndex]?.id;
    expect(
      flatItems
        .filter((item) => item.type === "row")
        .map((item) => positions.get(rowIdAt(item.rowIndex) ?? "")),
    ).toEqual([1, 2, 3, 4]);
    // getRowModel order would have been 1, 2, 3, 4 on indices 0..3 — wrong on screen.
    expect(positions.get("audi-80")).toBe(1);
    expect(positions.get("audi-30")).toBe(2);
    expect(positions.get("bmw-90")).toBe(3);
    expect(positions.get("bmw-40")).toBe(4);
  });
});

describe("displayRowPosition fallback", () => {
  test("falls back to row.index + 1 when no lookup is provided", () => {
    // A table that hasn't opted in (or a Storybook render) must still show a
    // number rather than a blank cell.
    const table = makeTable(3);
    table.setOptions((prev) => ({ ...prev, meta: undefined }));
    const rows = table.getRowModel().rows;
    expect(rows.map((r) => displayRowPosition(table, r))).toEqual([1, 2, 3]);
  });
});
