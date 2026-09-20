import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { applyAST, col, type FilterAST } from "../src";

// A DATE column filters client-side over loaded rows via the filter engine.
// These tests pin the operator semantics a user relies on: on/before/after are
// strict day comparisons, between is an inclusive range, and rows without a
// date never satisfy an active date condition (so the filter actually narrows).

type Row = { firstSeen: string | null };

const columns = [
  col<Row>({ id: "firstSeen", label: "First Seen", type: ColumnTypes.DATE }),
];

const rows: Row[] = [
  { firstSeen: "2026-01-10" },
  { firstSeen: "2026-03-26" },
  { firstSeen: "2026-06-08T14:42:55.000Z" }, // datetime — compared by day
  { firstSeen: null }, // no date
];

const ast = (op: string, val: string): FilterAST => ({
  search: "",
  and: [{ field: "firstSeen", op: op as never, val }],
  orGroups: [],
});

const days = (result: Row[]) => result.map((r) => r.firstSeen);

describe("date filter operators", () => {
  test("'on' matches the exact calendar day, including for datetimes", () => {
    expect(days(applyAST(rows, ast("on", "2026-06-08"), columns))).toEqual([
      "2026-06-08T14:42:55.000Z",
    ]);
  });

  test("'before' is strictly earlier and excludes null-date rows", () => {
    expect(days(applyAST(rows, ast("before", "2026-03-26"), columns))).toEqual([
      "2026-01-10",
    ]);
  });

  test("'after' is strictly later", () => {
    expect(days(applyAST(rows, ast("after", "2026-03-26"), columns))).toEqual([
      "2026-06-08T14:42:55.000Z",
    ]);
  });

  test("'between' is an inclusive from|to range", () => {
    expect(
      days(applyAST(rows, ast("between", "2026-01-10|2026-03-26"), columns)),
    ).toEqual(["2026-01-10", "2026-03-26"]);
  });

  test("'between' supports an open-ended (from-only) range", () => {
    expect(
      days(applyAST(rows, ast("between", "2026-03-26|"), columns)),
    ).toEqual(["2026-03-26", "2026-06-08T14:42:55.000Z"]);
  });

  test("an empty value is a no-op (does not filter anything out)", () => {
    expect(applyAST(rows, ast("on", ""), columns)).toHaveLength(rows.length);
    expect(applyAST(rows, ast("between", "|"), columns)).toHaveLength(
      rows.length,
    );
  });
});
