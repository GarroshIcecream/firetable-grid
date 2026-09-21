import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { applyView, col, emptyGridView, type GridView } from "../src";

// Free-text search matches through a case-insensitive regex built from the
// query. These cover the two things that buys us trouble if it regresses: the
// query must stay a LITERAL (regex metacharacters are escaped, not compiled),
// and the matcher must not carry state between rows.

type Row = { name: string; sku: string; note: number | null };

const columns = [
  col<Row>({ id: "name", label: "Name", type: ColumnTypes.TEXT }),
  col<Row>({ id: "sku", label: "SKU", type: ColumnTypes.TEXT }),
  // Not searchable, and not a string - it must never be scanned.
  col<Row>({ id: "note", label: "Note", type: ColumnTypes.NUMBER }),
];

const rows: Row[] = [
  { name: "Carbon Fork", sku: "SKU-1", note: 1 },
  { name: "3.5 inch (new)", sku: "SKU-2", note: 2 },
  { name: "365 inch", sku: "SKU-3", note: 3 },
  { name: "a+b bracket", sku: "SKU-4", note: 4 },
  { name: "aXb bracket", sku: "SKU-5", note: 5 },
  { name: "Ünïcode Ärm", sku: "SKU-6", note: 6 },
];

const search = (query: string): GridView => ({
  ...emptyGridView(),
  search: query,
});

const names = (query: string) =>
  applyView(rows, search(query), columns).map((r) => r.name);

describe("free-text search", () => {
  test("matches case-insensitively", () => {
    expect(names("carbon")).toEqual(["Carbon Fork"]);
    expect(names("CARBON")).toEqual(["Carbon Fork"]);
  });

  test("folds case for non-ASCII letters", () => {
    expect(names("ÜNÏCODE")).toEqual(["Ünïcode Ärm"]);
    expect(names("ärm")).toEqual(["Ünïcode Ärm"]);
  });

  test("treats '.' as a literal dot, not a wildcard", () => {
    // "3.5" must not match "365" the way an uncompiled `.` would.
    expect(names("3.5")).toEqual(["3.5 inch (new)"]);
  });

  test("treats '+' as a literal plus, not a repeat quantifier", () => {
    expect(names("a+b")).toEqual(["a+b bracket"]);
  });

  test("treats brackets and parens as literals", () => {
    expect(names("(new)")).toEqual(["3.5 inch (new)"]);
    expect(names("[")).toEqual([]);
    expect(names("\\")).toEqual([]);
  });

  test("searches every searchable column", () => {
    expect(names("sku-4")).toEqual(["a+b bracket"]);
  });

  test("does not carry match state between rows", () => {
    // A global regex would advance `lastIndex` and make a row's result depend
    // on the row before it; every "inch" row must match on a single pass.
    expect(names("inch")).toEqual(["3.5 inch (new)", "365 inch"]);
  });

  test("a query with no searchable column matches nothing", () => {
    const noneSearchable = [
      col<Row>({ id: "note", label: "Note", type: ColumnTypes.NUMBER }),
    ];
    expect(applyView(rows, search("carbon"), noneSearchable)).toEqual([]);
  });
});
