import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { applyView, col, emptyGridView, type GridView, where } from "../src";

// A set-valued enum column holds MULTIPLE values per row (comma-joined via
// getFilterValue). Matching is set intersection, not scalar equality — this is
// what makes "show cars needing photos OR a price change" work.
type Row = { id: string; actions: string[] };

const columns = [
  col<Row>({
    id: "recommendedActions",
    label: "Recommended Actions",
    type: ColumnTypes.RECOMMENDED_ACTIONS,
    getFilterValue: (r) => r.actions.join(","),
  }),
];

const rows: Row[] = [
  { id: "a", actions: ["reducePrice", "addPhotos"] },
  { id: "b", actions: ["improveTitle"] },
  { id: "c", actions: [] },
];

const view = (op: string, value: string): GridView => ({
  ...emptyGridView(),
  filter: where("recommendedActions", op as never, value),
});

const ids = (result: Row[]) => result.map((r) => r.id);

describe("set-valued enum filter", () => {
  test("'is' matches rows containing the single selected action", () => {
    expect(ids(applyView(rows, view("is", "addPhotos"), columns))).toEqual([
      "a",
    ]);
  });

  test("'is' with multiple selected matches rows containing ANY of them", () => {
    expect(
      ids(applyView(rows, view("is", "addPhotos,improveTitle"), columns)),
    ).toEqual(["a", "b"]);
  });

  test("'is not' excludes rows containing any selected action", () => {
    expect(ids(applyView(rows, view("is not", "addPhotos"), columns))).toEqual([
      "b",
      "c",
    ]);
  });

  test("empty-action rows never match an 'is' condition", () => {
    expect(ids(applyView(rows, view("is", "reducePrice"), columns))).toEqual([
      "a",
    ]);
  });
});
