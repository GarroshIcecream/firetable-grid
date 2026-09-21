import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { col, resolveColumnOrder, resolveColumnPins } from "../src";

type Row = { a: string; b: string; c: string; d: string };

const columns = [
  col<Row>({ id: "a", label: "A", type: ColumnTypes.TEXT, frozen: true }),
  col<Row>({ id: "b", label: "B", type: ColumnTypes.TEXT }),
  col<Row>({ id: "c", label: "C", type: ColumnTypes.TEXT }),
  // Hidden by the schema itself rather than by the user.
  col<Row>({ id: "d", label: "D", type: ColumnTypes.TEXT, visible: false }),
];

const ids = (out: { id: string }[]) => out.map((c) => c.id);

describe("resolveColumnOrder", () => {
  test("with no layout it falls back to schema order and schema visibility", () => {
    // `d` is `visible: false` in the schema, so it must not appear just
    // because the view carries no visibility record of its own.
    expect(ids(resolveColumnOrder(columns, undefined))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("the layout's order wins", () => {
    expect(
      ids(resolveColumnOrder(columns, { order: ["c", "a", "b"] })),
    ).toEqual(["c", "a", "b"]);
  });

  test("a column the order does not mention is appended", () => {
    // Adding a column to the schema must never make it silently invisible.
    expect(ids(resolveColumnOrder(columns, { order: ["c"] }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("unknown and duplicate ids in the order are ignored", () => {
    expect(
      ids(resolveColumnOrder(columns, { order: ["b", "nosuch", "b", "a"] })),
    ).toEqual(["b", "a", "c"]);
  });

  test("the layout's visibility replaces the schema's, both ways", () => {
    // Showing a schema-hidden column and hiding a schema-visible one.
    expect(
      ids(resolveColumnOrder(columns, { visibility: { d: true, b: false } })),
    ).toEqual(["a", "c", "d"]);
  });
});

describe("resolveColumnPins", () => {
  test("with no layout, the schema's frozen columns are the pins", () => {
    expect(resolveColumnPins(columns, undefined).pinned).toEqual(["a"]);
  });

  test("user pins join the schema's frozen columns", () => {
    expect(resolveColumnPins(columns, { pinned: ["c"] }).pinned).toEqual([
      "a",
      "c",
    ]);
  });

  test("a user pin that repeats a frozen column does not duplicate it", () => {
    expect(resolveColumnPins(columns, { pinned: ["a"] }).pinned).toEqual(["a"]);
  });

  test("locked matches pinned while there is no compact breakpoint", () => {
    // They only diverge under `compact: true`, which this library does not
    // expose yet. Pinned drives stickiness, locked drives the reorder
    // exclusion; wiring the right one now makes compact a config change later.
    const { pinned, locked } = resolveColumnPins(columns, { pinned: ["c"] });
    expect(locked).toEqual(pinned);
  });
});
