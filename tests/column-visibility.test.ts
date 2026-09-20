import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import {
  buildFooterAggregateQuery,
  buildVisibility,
  col,
  isColumnVisible,
  selectExportColumns,
} from "../src";

// `columnVisibility` is one contract shared by three call sites - the grid's
// render path, the export column selection and the footer aggregate query.
// These lock the contract down, because a second reading of it is what makes
// "the export is exactly what is on screen" quietly stop being true.

type Row = { sku: string; price: number; cost: number };

const columns = [
  col<Row>({ id: "sku", label: "SKU", type: ColumnTypes.TEXT }),
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  // Hidden by the schema itself rather than by the user.
  col<Row>({
    id: "cost",
    label: "Cost",
    type: ColumnTypes.CURRENCY,
    visible: false,
  }),
];

const rows: Row[] = [{ sku: "A-1", price: 10, cost: 4 }];
const order = columns.map((c) => c.id);

describe("isColumnVisible", () => {
  test("a column the record does not mention is visible", () => {
    expect(isColumnVisible("price", {})).toBe(true);
    expect(isColumnVisible("price", undefined)).toBe(true);
  });

  test("only an explicit false hides a column", () => {
    expect(isColumnVisible("price", { price: false })).toBe(false);
    expect(isColumnVisible("price", { price: true })).toBe(true);
  });
});

describe("buildVisibility", () => {
  test("seeds the record from the schema's own defaults", () => {
    // Only the hidden one is listed: absent already means visible, so writing
    // `true` for every column would be redundant state to keep in sync.
    expect(buildVisibility(columns)).toEqual({ cost: false });
  });

  test("round-trips through isColumnVisible", () => {
    const visibility = buildVisibility(columns);
    expect(columns.filter((c) => isColumnVisible(c.id, visibility))).toEqual([
      columns[0],
      columns[1],
    ]);
  });
});

describe("one record, every consumer", () => {
  test("hiding a column drops it from the export and the footer query alike", () => {
    const visibility = { ...buildVisibility(columns), price: false };

    expect(
      selectExportColumns(columns, order, visibility, rows).map((c) => c.id),
    ).toEqual(["sku"]);

    expect(
      buildFooterAggregateQuery({ price: "sum" }, columns, visibility).metrics,
    ).toEqual([]);
  });

  test("a visible column reaches both", () => {
    const visibility = buildVisibility(columns);

    expect(
      selectExportColumns(columns, order, visibility, rows).map((c) => c.id),
    ).toEqual(["sku", "price"]);

    expect(
      buildFooterAggregateQuery({ price: "sum" }, columns, visibility).metrics,
    ).toHaveLength(1);
  });

  test("a schema-hidden column is hidden everywhere without extra wiring", () => {
    const visibility = buildVisibility(columns);

    expect(
      selectExportColumns(columns, order, visibility, rows).map((c) => c.id),
    ).not.toContain("cost");
    expect(
      buildFooterAggregateQuery({ cost: "sum" }, columns, visibility).metrics,
    ).toEqual([]);
  });
});
