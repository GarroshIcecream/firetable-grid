import { describe, expect, test } from "bun:test";

import {
  buildColumnLayout,
  buildFlatItems,
  buildVirtualRenderPlan,
  computeRowsAgg,
  pendingRowRunway,
  resolvePinnedColumns,
  resolveRowTap,
} from "../src/layout";

describe("resolveRowTap", () => {
  test("opens on the first tap when no confirmation is required, so nothing about the desktop row click changes", () => {
    expect(resolveRowTap("ad-1", null, false)).toEqual({
      armedRowId: null,
      open: true,
    });
  });

  test("arms instead of opening on the first tap of an unconfirmed row, so a mis-tap on a phone cannot open a detail", () => {
    expect(resolveRowTap("ad-1", null, true)).toEqual({
      armedRowId: "ad-1",
      open: false,
    });
  });

  test("opens on the second tap of the already-armed row and disarms it, so the highlight never outlives the tap that consumed it", () => {
    expect(resolveRowTap("ad-1", "ad-1", true)).toEqual({
      armedRowId: null,
      open: true,
    });
  });

  test("moves the arm rather than opening when a different row is tapped, so the confirmation is per row and never inherited", () => {
    expect(resolveRowTap("ad-2", "ad-1", true)).toEqual({
      armedRowId: "ad-2",
      open: false,
    });
  });

  test("ignores a stale arm once confirmation stops being required, so a rotation to a wide viewport cannot swallow the next click", () => {
    expect(resolveRowTap("ad-2", "ad-1", false)).toEqual({
      armedRowId: null,
      open: true,
    });
  });
});

describe("resolvePinnedColumns", () => {
  const desktop = {
    compact: false,
    compactFrozenColumns: ["rowIndex", "thumbnail"],
    frozenColumns: ["rowIndex", "thumbnail", "adTitle"],
    selectionColumnId: "__select__",
    userPinnedColumns: ["price"],
  };

  test("renders selection, schema-frozen columns and user pins in that order above the compact breakpoint", () => {
    expect(resolvePinnedColumns(desktop).pinned).toEqual([
      "__select__",
      "rowIndex",
      "thumbnail",
      "adTitle",
      "price",
    ]);
  });

  test("substitutes the compact list and suppresses user pins when compact, so the frozen prefix cannot outgrow a phone", () => {
    expect(resolvePinnedColumns({ ...desktop, compact: true }).pinned).toEqual([
      "__select__",
      "rowIndex",
      "thumbnail",
    ]);
  });

  test("keeps every schema-frozen column and user pin locked when compact, so a column unfrozen for layout cannot be hidden away by the header context menu", () => {
    const { locked } = resolvePinnedColumns({ ...desktop, compact: true });
    expect(locked).toEqual([
      "__select__",
      "rowIndex",
      "thumbnail",
      "adTitle",
      "price",
    ]);
  });

  test("falls back to the full frozen list when a surface declares no compact list, but still suppresses user pins - opting out of the compact prefix is not opting out of pin suppression", () => {
    const { pinned } = resolvePinnedColumns({
      ...desktop,
      compact: true,
      compactFrozenColumns: undefined,
    });
    expect(pinned).toEqual(["__select__", "rowIndex", "thumbnail", "adTitle"]);
  });

  test("omits the selection column when selection is disabled and dedupes an id declared both frozen and pinned", () => {
    const { locked, pinned } = resolvePinnedColumns({
      compact: false,
      frozenColumns: ["thumbnail", "adTitle"],
      selectionColumnId: undefined,
      userPinnedColumns: ["adTitle", "price"],
    });
    expect(pinned).toEqual(["thumbnail", "adTitle", "price"]);
    expect(locked).toEqual(["thumbnail", "adTitle", "price"]);
  });
});

describe("stock-table model", () => {
  test("buildColumnLayout moves visible pinned columns first and marks the last visible pinned column", () => {
    const layout = buildColumnLayout(
      [
        { id: "make", item: "make", size: 80 },
        { id: "rowIndex", item: "rowIndex", size: 44 },
        { id: "price", item: "price", size: 120 },
        { id: "adTitle", item: "adTitle", size: 260 },
      ],
      ["rowIndex", "thumbnail", "adTitle"],
    );

    expect(layout.map((entry) => entry.id)).toEqual([
      "rowIndex",
      "adTitle",
      "make",
      "price",
    ]);
    expect(layout.map((entry) => entry.stickyLeft)).toEqual([
      0,
      44,
      undefined,
      undefined,
    ]);
    expect(layout.map((entry) => entry.isLastPinned)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  test("buildFlatItems groups row indices without object identity lookups and respects collapsed groups", () => {
    const rows = [
      { original: { adId: "1", sellerKeys: "Beta" } },
      { original: { adId: "2", sellerKeys: "Alpha" } },
      { original: { adId: "3", sellerKeys: "Beta" } },
    ];

    expect(buildFlatItems(rows, "sellerKeys", "asc")).toEqual([
      { type: "group-header", key: "Alpha", label: "Alpha", count: 1 },
      { type: "row", rowIndex: 1 },
      { type: "group-header", key: "Beta", label: "Beta", count: 2 },
      { type: "row", rowIndex: 0 },
      { type: "row", rowIndex: 2 },
    ]);

    expect(
      buildFlatItems(rows, "sellerKeys", "asc", new Set(["Beta"])),
    ).toEqual([
      { type: "group-header", key: "Alpha", label: "Alpha", count: 1 },
      { type: "row", rowIndex: 1 },
      { type: "group-header", key: "Beta", label: "Beta", count: 2 },
    ]);
  });

  test("buildVirtualRenderPlan keeps spacer gaps between non-contiguous virtual items", () => {
    const plan = buildVirtualRenderPlan(
      [
        { index: 0, start: 0, end: 40 },
        { index: 50, start: 2600, end: 2652 },
        { index: 51, start: 2652, end: 2704 },
      ],
      5000,
    );

    expect(plan.slots.map((slot) => slot.before)).toEqual([0, 2560, 0]);
    expect(plan.after).toBe(2296);
  });

  test("computeRowsAgg ignores non-numeric values", () => {
    const rows: Array<{ original: Record<string, unknown> }> = [
      { original: { price: 100 } },
      { original: { price: null } },
      { original: { price: 250 } },
      { original: { price: "300" } },
    ];

    expect(computeRowsAgg(rows, "price", "avg")).toBe(175);
    expect(computeRowsAgg(rows, "price", "count")).toBe(2);
  });

  test("keeps aggregate precision until the column formats the result", () => {
    const rows: { original: { percentage: number | null } }[] = [
      { original: { percentage: 0.125 } },
      { original: { percentage: 0.375 } },
      { original: { percentage: null } },
    ];

    expect(computeRowsAgg(rows, "percentage", "avg")).toBe(0.25);
    expect(computeRowsAgg(rows, "percentage", "sum")).toBe(0.5);
    expect(computeRowsAgg(rows, "percentage", "min")).toBe(0.125);
    expect(computeRowsAgg(rows, "percentage", "max")).toBe(0.375);
    expect(computeRowsAgg(rows, "percentage", "count")).toBe(2);
  });

  test("aggregates a row count that would overflow an argument list", () => {
    // `Math.min(...values)` passes one argument per row, and V8 throws
    // `RangeError: Maximum call stack size exceeded` past ~125k of them - so
    // min/max used to crash on exactly the datasets a footer aggregate is for.
    const rows = Array.from({ length: 300_000 }, (_, i) => ({
      original: { price: i },
    }));

    expect(computeRowsAgg(rows, "price", "min")).toBe(0);
    expect(computeRowsAgg(rows, "price", "max")).toBe(299_999);
    expect(computeRowsAgg(rows, "price", "count")).toBe(300_000);
  });

  test("returns null when no row carries a numeric value", () => {
    const rows: Array<{ original: Record<string, unknown> }> = [
      { original: { price: null } },
      { original: {} },
    ];

    for (const agg of ["avg", "sum", "min", "max", "count"] as const) {
      expect(computeRowsAgg(rows, "price", agg)).toBeNull();
    }
  });
});

describe("pendingRowRunway", () => {
  test("is a full page while more rows remain, so the scroller always has somewhere to go", () => {
    expect(
      pendingRowRunway({
        loadedRowCount: 150,
        totalCount: 4000,
        pageSize: 150,
        hasNextPage: true,
      }),
    ).toBe(150);
  });

  test("stops at the last page's real size, so the grid never promises rows the query cannot return", () => {
    expect(
      pendingRowRunway({
        loadedRowCount: 150,
        totalCount: 190,
        pageSize: 150,
        hasNextPage: true,
      }),
    ).toBe(40);
  });

  test("is zero on the last page, so the scroll height matches the loaded set once paging is done", () => {
    expect(
      pendingRowRunway({
        loadedRowCount: 190,
        totalCount: 190,
        pageSize: 150,
        hasNextPage: false,
      }),
    ).toBe(0);
  });

  test("falls back to one page when the server withheld a count, because a cursor still exists", () => {
    expect(
      pendingRowRunway({
        loadedRowCount: 150,
        totalCount: null,
        pageSize: 150,
        hasNextPage: true,
      }),
    ).toBe(150);
  });

  test("clamps a stale count that undershoots the loaded rows instead of going negative", () => {
    expect(
      pendingRowRunway({
        loadedRowCount: 300,
        totalCount: 190,
        pageSize: 150,
        hasNextPage: true,
      }),
    ).toBe(0);
  });

  test("is zero before the first page lands, when no page size is known yet", () => {
    expect(
      pendingRowRunway({
        loadedRowCount: 0,
        totalCount: null,
        pageSize: 0,
        hasNextPage: true,
      }),
    ).toBe(0);
  });
});
