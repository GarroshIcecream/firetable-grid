import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { buildDerivedOptions, col } from "../src";

type Row = { id: string; actions: string[]; warehouse: string };

const actionsColumn = col<Row>({
  id: "recommendedActions",
  label: "Recommended Actions",
  type: ColumnTypes.RECOMMENDED_ACTIONS,
  dynamicOptions: true,
  getFilterValue: (r) => r.actions.join(","),
});

const warehouseColumn = col<Row>({
  id: "warehouse",
  label: "Warehouse",
  type: ColumnTypes.BADGE,
  dynamicOptions: true,
});

const rows: Row[] = [
  { id: "a", actions: ["reducePrice", "addPhotos"], warehouse: "Brno" },
  { id: "b", actions: ["improveTitle"], warehouse: "Praha" },
  { id: "c", actions: [], warehouse: "Brno" },
];

const values = (options: readonly { value: string }[]) =>
  options.map((o) => o.value);

describe("derived filter options", () => {
  test("a set-valued column contributes one option per token", () => {
    const derived = buildDerivedOptions([actionsColumn], rows);
    expect(values(derived.get("recommendedActions") ?? [])).toEqual([
      "addPhotos",
      "improveTitle",
      "reducePrice",
    ]);
  });

  test("a scalar column still contributes its whole value", () => {
    const derived = buildDerivedOptions([warehouseColumn], rows);
    expect(values(derived.get("warehouse") ?? [])).toEqual(["Brno", "Praha"]);
  });

  test("an empty set contributes nothing", () => {
    const derived = buildDerivedOptions([actionsColumn], [rows[2] as Row]);
    expect(derived.get("recommendedActions")).toEqual([]);
  });
});
