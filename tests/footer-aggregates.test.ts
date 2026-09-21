import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { col, formatFooterAggregate, resolveFooterValue } from "../src";
import { computeRowsAgg } from "../src/layout";

// A footer over PAGED data cannot be computed from the loaded rows - the slice
// drifts from the real total as pages arrive - so a server-supplied value has
// to win over a local one. `resolveFooterValue` is that precedence, in one
// place, because getting it wrong shows a confidently wrong number.

type Row = { sku: string; price: number; cost: number | null };

const columns = [
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  // The id and the data key differ - `computeRowsAgg` read `row[colId]`
  // directly and aggregated this to null.
  col<Row>({
    id: "unitCost",
    accessorKey: "cost",
    label: "Cost",
    type: ColumnTypes.CURRENCY,
  }),
];

const rows: Row[] = [
  { sku: "a", price: 100, cost: 10 },
  { sku: "b", price: 200, cost: null },
  { sku: "c", price: 300, cost: 30 },
];
const wrapped = rows.map((original) => ({ original }));

describe("computeRowsAgg respects accessorKey", () => {
  test("a column whose id matches its key aggregates as before", () => {
    expect(computeRowsAgg(wrapped, "price", "sum")).toBe(600);
    expect(computeRowsAgg(wrapped, "price", "avg")).toBe(200);
    expect(computeRowsAgg(wrapped, "price", "count")).toBe(3);
  });

  test("a column whose id differs from its key no longer aggregates to null", () => {
    const read = (row: Row) => row.cost;
    expect(computeRowsAgg(wrapped, "unitCost", "sum", read)).toBe(40);
    expect(computeRowsAgg(wrapped, "unitCost", "count", read)).toBe(2);
    // Without the accessor it reads `row.unitCost`, which does not exist.
    expect(computeRowsAgg(wrapped, "unitCost", "sum")).toBe(null);
  });

  test("non-numeric and missing values are skipped, not coerced", () => {
    const read = (row: Row) => row.cost;
    expect(computeRowsAgg(wrapped, "unitCost", "min", read)).toBe(10);
    expect(computeRowsAgg(wrapped, "unitCost", "max", read)).toBe(30);
  });

  test("no numeric values at all is null, not zero", () => {
    // Zero is a real average; "nothing to average" is not.
    const empty = [{ original: { sku: "z", price: 0, cost: null } as Row }];
    expect(computeRowsAgg(empty, "unitCost", "avg", (r: Row) => r.cost)).toBe(
      null,
    );
  });
});

describe("resolveFooterValue", () => {
  const serverValues = { price: { sum: 99_999, avg: null } };

  test("a server value wins over the loaded rows", () => {
    // With paged data the loaded slice is not the whole set, so a locally
    // computed 600 would understate a total the server knows is 99,999.
    expect(resolveFooterValue("price", "sum", serverValues, () => 600)).toBe(
      99_999,
    );
  });

  test("an explicit server null is still the answer, not a miss", () => {
    // The server saying "no value" must not silently fall back to a local
    // number computed over a different set of rows.
    expect(resolveFooterValue("price", "avg", serverValues, () => 200)).toBe(
      null,
    );
  });

  test("falls back to the local computation when the server has no entry", () => {
    expect(resolveFooterValue("price", "min", serverValues, () => 100)).toBe(
      100,
    );
    expect(resolveFooterValue("other", "sum", serverValues, () => 7)).toBe(7);
  });

  test("falls back to the local computation when there are no server values", () => {
    expect(resolveFooterValue("price", "sum", undefined, () => 600)).toBe(600);
  });

  test("the local computation is lazy, so it is skipped when unused", () => {
    let called = 0;
    resolveFooterValue("price", "sum", serverValues, () => {
      called++;
      return 1;
    });
    expect(called).toBe(0);
  });
});

describe("formatFooterAggregate stays the display half", () => {
  test("a null aggregate renders as an em dash, not as zero", () => {
    const fmt = { number: (v: number) => String(v) };
    expect(formatFooterAggregate(null, "sum", columns[0], fmt)).toBe("—");
  });
});
