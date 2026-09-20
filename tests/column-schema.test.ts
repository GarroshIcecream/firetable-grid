import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { col, toColumnDefs } from "../src";

// `category` is a UI-only taxonomy hint consumed by the Column Manager. The
// schema layer must (a) leave it `undefined` when callers don't pass it,
// (b) carry whatever value they do pass through unchanged, and (c) surface
// it on the TanStack `meta` object just like the existing `frozen` flag so
// downstream code can read either path.

describe("column-schema — category field", () => {
  test("col() leaves category as undefined when omitted", () => {
    const c = col({
      id: "make",
      label: "Make",
      type: ColumnTypes.TEXT,
    });
    expect(c.category).toBeUndefined();
  });

  test("col() propagates explicit category through to SchemaColumn", () => {
    const c = col({
      id: "make",
      label: "Make",
      type: ColumnTypes.TEXT,
      category: "vehicleInfo",
    });
    expect(c.category).toBe("vehicleInfo");
  });

  test("toColumnDefs() carries category into TanStack meta", () => {
    const schema = [
      col({
        id: "make",
        label: "Make",
        type: ColumnTypes.TEXT,
        category: "vehicleInfo",
      }),
      col({
        id: "noCat",
        label: "No Category",
        type: ColumnTypes.TEXT,
      }),
    ];
    const defs = toColumnDefs(schema);
    const meta0 = defs[0]?.meta as Record<string, unknown> | undefined;
    const meta1 = defs[1]?.meta as Record<string, unknown> | undefined;
    expect(meta0?.category).toBe("vehicleInfo");
    expect(meta1?.category).toBeUndefined();
  });
});

// Explicit per-column sortingFn (used by the Listings peer/CPL columns for
// deterministic null/special-state ordering) must reach the TanStack
// ColumnDef and win over the enum-order default.
describe("column-schema — explicit sortingFn passthrough", () => {
  test("toColumnDefs surfaces a custom sortingFn", () => {
    const custom = () => 0;
    const c = col<{ x: number | null }>({
      id: "x",
      label: "X",
      type: ColumnTypes.NUMBER,
      sortingFn: custom,
    });
    const [def] = toColumnDefs([c]);
    expect(def.sortFn).toBe(custom);
  });

  test("columns without sortingFn keep the default behaviour", () => {
    const c = col<{ x: number | null }>({
      id: "x",
      label: "X",
      type: ColumnTypes.NUMBER,
    });
    const [def] = toColumnDefs([c]);
    expect(def.sortFn).toBeUndefined();
  });
});
