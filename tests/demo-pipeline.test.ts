// The demo page has no test hooks, so this exercises the exact pipeline its
// `derive()` runs — filter, sort, group, export — against the same dataset.
// If this passes, the buttons on the page do what the page claims they do.

import { describe, expect, test } from "bun:test";
import { buildColumns, buildRows, type Item } from "../demo/data";
import {
  applyAST,
  buildCsvString,
  buildExportFilename,
  type FilterAST,
  resolveThresholdColor,
  sortRowsForExport,
  thresholdClasses,
} from "../src";
import {
  buildColumnLayout,
  buildFlatItems,
  groupSortDirection,
} from "../src/layout";

const rows = buildRows();
const columns = buildColumns();
const ast = (over: Partial<FilterAST> = {}): FilterAST => ({
  search: "",
  and: [],
  orGroups: [],
  ...over,
});

describe("the demo dataset is stable", () => {
  test("two builds produce identical rows", () => {
    // The page prints engine state next to the table; a reshuffling dataset
    // would make the two impossible to compare across a reload.
    expect(buildRows()).toEqual(rows);
  });

  test("every column the demo declares is usable", () => {
    expect(columns.length).toBeGreaterThan(0);
    for (const c of columns) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.width).toBeGreaterThan(0);
    }
  });
});

describe("search", () => {
  test("matches only columns flagged searchable", () => {
    const searchable = columns.filter((c) => c.searchable).map((c) => c.id);
    expect(searchable).toEqual(["name", "sku"]);

    const hit = rows[3].sku;
    const found = applyAST(rows, ast({ search: hit }), columns);
    expect(found).toHaveLength(1);
    expect(found[0].sku).toBe(hit);
  });

  test("a value present only in a non-searchable column matches nothing", () => {
    // `supplier` is not searchable, so its values must not leak into search.
    const found = applyAST(rows, ast({ search: rows[0].supplier }), columns);
    expect(found).toHaveLength(0);
  });
});

describe("filter conditions", () => {
  test("a numeric bound keeps only rows under it", () => {
    const out = applyAST(
      rows,
      ast({ and: [{ field: "price", op: "≤", val: "500" }] }),
      columns,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(rows.length);
    for (const r of out) expect(r.price).toBeLessThanOrEqual(500);
  });

  test("conditions AND together", () => {
    const one = applyAST(
      rows,
      ast({ and: [{ field: "category", op: "is", val: "Wheels" }] }),
      columns,
    );
    const two = applyAST(
      rows,
      ast({
        and: [
          { field: "category", op: "is", val: "Wheels" },
          { field: "daysInStock", op: ">", val: "60" },
        ],
      }),
      columns,
    );
    expect(two.length).toBeLessThanOrEqual(one.length);
    for (const r of two) {
      expect(r.category).toBe("Wheels");
      expect(r.daysInStock).toBeGreaterThan(60);
    }
  });
});

describe("sorting", () => {
  test("ascending and descending are genuine inversions", () => {
    const asc = sortRowsForExport(
      rows,
      [{ id: "price", desc: false }],
      columns,
    );
    const desc = sortRowsForExport(
      rows,
      [{ id: "price", desc: true }],
      columns,
    );
    expect(asc.map((r) => r.price)).toEqual(
      [...rows].map((r) => r.price).sort((a, b) => a - b),
    );
    expect(desc.map((r) => r.price)).toEqual(asc.map((r) => r.price).reverse());
  });

  test("no sorting leaves the rows untouched", () => {
    expect(sortRowsForExport(rows, [], columns)).toEqual([...rows]);
  });
});

describe("grouping", () => {
  const wrap = (xs: readonly Item[]) => xs.map((original) => ({ original }));

  test("one header per distinct value, every row accounted for", () => {
    const items = buildFlatItems(wrap(rows), "category", "asc");
    const headers = items.filter((i) => i.type === "group-header");
    const distinct = new Set(rows.map((r) => r.category));
    expect(headers).toHaveLength(distinct.size);
    expect(items.filter((i) => i.type === "row")).toHaveLength(rows.length);
    const counted = headers.reduce(
      (n, h) => n + (h.type === "group-header" ? h.count : 0),
      0,
    );
    expect(counted).toBe(rows.length);
  });

  test("collapsing a group hides its rows but keeps its header and count", () => {
    const open = buildFlatItems(wrap(rows), "category", "asc");
    const first = open.find((i) => i.type === "group-header");
    if (first?.type !== "group-header") throw new Error("no header");
    const shut = buildFlatItems(
      wrap(rows),
      "category",
      "asc",
      new Set([first.key]),
    );
    const stillThere = shut.find(
      (i) => i.type === "group-header" && i.key === first.key,
    );
    expect(stillThere).toBeDefined();
    expect(shut.filter((i) => i.type === "row")).toHaveLength(
      rows.length - first.count,
    );
  });

  test("group order follows the grouped column's sort direction", () => {
    expect(
      groupSortDirection([{ id: "category", desc: true }], "category"),
    ).toBe("desc");
    // Sorting a different column must not flip the group order.
    expect(groupSortDirection([{ id: "price", desc: true }], "category")).toBe(
      "asc",
    );
  });
});

describe("thresholds", () => {
  test("every thresholded column resolves a readable pair for every row", () => {
    const thresholded = columns.filter((c) => c.thresholds);
    expect(thresholded.length).toBeGreaterThan(0);
    for (const c of thresholded) {
      for (const row of rows) {
        const value = Number((row as unknown as Record<string, unknown>)[c.id]);
        const classes = thresholdClasses(
          resolveThresholdColor(value, c.thresholds ?? []),
        );
        // Both halves, or half the scale renders unreadable.
        expect(classes).toMatch(/^bg-\S+ text-\S+$/);
      }
    }
  });
});

describe("export", () => {
  test("the CSV header is the exportable column labels, in order", () => {
    const exportable = columns.filter((c) => c.exportable);
    const csv = buildCsvString(rows, exportable);
    // CRLF per RFC 4180 — splitting on "\n" alone leaves a stray \r on every line.
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(exportable.map((c) => c.label).join(","));
    expect(lines).toHaveLength(rows.length + 1);
    expect(csv).not.toEndWith("\r\n");
  });

  test("the filename carries the grouped field as its scope", () => {
    expect(
      buildExportFilename({
        prefix: "inventory",
        scope: "category",
        date: new Date(2026, 8, 20),
        ext: "csv",
      }),
    ).toBe("inventory_category_2026-09-20.csv");
  });
});

// The demo page tells the reader to scroll sideways and watch `#` and `Item`
// stay put. Frozen columns are only *visible* once the table is wider than the
// viewport, so a demo whose columns fit on screen demonstrates nothing while
// every unit test still passes. These assert the page can keep its promise.
describe("the demo can actually show frozen columns", () => {
  const frozen = columns.filter((c) => c.frozen);

  test("the grid is wider than a laptop viewport, so it scrolls sideways", () => {
    const total = columns.reduce((sum, c) => sum + c.width, 0);
    // Comfortably past a 1440px screen minus the demo's own side panel.
    expect(total).toBeGreaterThan(1600);
  });

  test("the frozen block is narrow enough to leave room to scroll", () => {
    const frozenWidth = frozen.reduce((sum, c) => sum + c.width, 0);
    expect(frozenWidth).toBeLessThan(400);
  });

  test("frozen columns resolve to sticky offsets, in order, with an edge", () => {
    const layout = buildColumnLayout(
      columns.map((c) => ({
        id: c.id,
        item: c,
        minWidth: c.minWidth,
        size: c.width,
      })),
      frozen.map((c) => c.id),
    );

    const pinned = layout.filter((entry) => entry.isPinned);
    expect(pinned.map((entry) => entry.id)).toEqual(frozen.map((c) => c.id));

    // Each one sticks at the running width of the ones before it.
    let left = 0;
    for (const entry of pinned) {
      expect(entry.stickyLeft).toBe(left);
      left += entry.size;
    }

    // Exactly one trailing edge, on the last pinned column - that hairline is
    // what stops frozen content floating over the scrolled columns.
    expect(pinned.filter((entry) => entry.isLastPinned)).toHaveLength(1);
    expect(pinned.at(-1)?.isLastPinned).toBe(true);
    expect(layout.filter((entry) => entry.isLastPinned)).toHaveLength(1);
  });
});
