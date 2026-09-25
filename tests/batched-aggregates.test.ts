import { expect, test } from "bun:test";
import {
  computeRowsAggregates,
  type RowsAggregation,
} from "../src/layout/aggregates";
import { computeRowsAgg } from "../src/layout/model";

const types = ["sum", "avg", "min", "max", "count"] as const;
const requests = types.map((aggregation) => ({ key: "value", aggregation }));

test("batched aggregates skip non-numbers and preserve zero and fractional values", () => {
  const rows = [
    { value: -2 },
    { value: 0 },
    { value: 2.5 },
    { value: null },
    { value: "10" },
    {},
  ];
  expect(computeRowsAggregates(rows, requests)).toEqual([
    0.5,
    1 / 6,
    -2,
    2.5,
    3,
  ]);
});

test("empty and entirely nonnumeric batches return null for every aggregation", () => {
  expect(computeRowsAggregates([], requests)).toEqual([
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(
    computeRowsAggregates([{ value: false }, { value: undefined }], requests),
  ).toEqual([null, null, null, null, null]);
});

test("custom accessors override keys and separate columns keep separate counts", () => {
  const rows = [
    { value: 100, cost: 0 },
    { value: 200, cost: null },
    { value: 300, cost: 30 },
  ];
  const batch: RowsAggregation<(typeof rows)[number]>[] = [
    { key: "cost", aggregation: "sum" },
    { key: "value", aggregation: "avg", read: (row) => row.cost },
    { key: "missing", aggregation: "count", read: (row) => row.cost },
    { key: "value", aggregation: "sum" },
  ];
  expect(computeRowsAggregates(rows, batch)).toEqual([30, 15, 2, 600]);
});

test("NaN and infinities retain the existing numeric aggregation semantics", () => {
  expect(computeRowsAggregates([{ value: Number.NaN }], requests)).toEqual([
    Number.NaN,
    Number.NaN,
    Infinity,
    -Infinity,
    1,
  ]);
  expect(
    computeRowsAggregates(
      [{ value: -Infinity }, { value: Infinity }, { value: 2 }],
      requests,
    ),
  ).toEqual([Number.NaN, Number.NaN, -Infinity, Infinity, 3]);
});

test("batched results match the existing API across mixed columns and all operations", () => {
  const values = [
    undefined,
    null,
    "3",
    false,
    Number.NaN,
    -Infinity,
    -0,
    0.125,
    9,
    Infinity,
  ];
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    a: values[i % values.length],
    b: values[(i * 7) % values.length],
  }));
  const batch = ["a", "b", "missing"].flatMap((key) =>
    types.map((aggregation) => ({ key, aggregation })),
  );
  expect(computeRowsAggregates(rows, batch)).toEqual(
    batch.map(({ key, aggregation }) =>
      computeRowsAgg(
        rows.map((original) => ({ original })),
        key,
        aggregation,
      ),
    ),
  );
});

test("an empty request batch does not read rows", () => {
  const rows = new Proxy([{ value: 1 }], {
    get() {
      throw new Error("Unexpected row access");
    },
  });
  expect(computeRowsAggregates(rows, [])).toEqual([]);
});
