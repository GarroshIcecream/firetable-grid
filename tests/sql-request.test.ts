import { expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { any, col, emptyGridView, where } from "../src";
import { GridRequestError, nextGridPage, parseGridRequest } from "../src/sql";

const columns = [
  col({ id: "price", label: "Price", type: ColumnTypes.NUMBER }),
  col({ id: "name", label: "Name", type: ColumnTypes.TEXT }),
  col({ id: "day", label: "Day", type: ColumnTypes.DATE }),
  col({
    id: "private",
    label: "Private",
    type: ColumnTypes.TEXT,
    filterable: false,
    sortable: false,
  }),
];
const request = (filter = emptyGridView().filter) => ({
  view: { ...emptyGridView(), filter },
  page: { limit: 2, offset: 0 },
});

test("accepts empty input states and strips layout from a server request", () => {
  const input = request(any(where("price", "<", ""), any()));
  const parsed = parseGridRequest(
    { ...input, view: { ...input.view, columns: { order: ["unknown"] } } },
    columns,
  );
  expect(parsed).toEqual(input);
});

test("rejects invalid page boundaries, operators, hidden capabilities and unknown fields", () => {
  for (const page of [
    { limit: 0, offset: 0 },
    { limit: 1001, offset: 0 },
    { limit: 2, offset: -1 },
    { limit: 1.5, offset: 0 },
    { limit: 2, offset: Number.MAX_SAFE_INTEGER },
  ]) {
    expect(() => parseGridRequest({ ...request(), page }, columns)).toThrow(
      GridRequestError,
    );
  }
  for (const filter of [
    where("missing", "is", "x"),
    where("price", "contains", "1"),
    where("private", "is", "x"),
    where("price", "<", "12oops"),
    where("day", "on", "2026-02-30"),
  ]) {
    expect(() => parseGridRequest(request(filter), columns)).toThrow(
      GridRequestError,
    );
  }
  expect(() =>
    parseGridRequest(
      {
        ...request(),
        view: { ...emptyGridView(), sort: [{ field: "private", dir: "asc" }] },
      },
      columns,
    ),
  ).toThrow(GridRequestError);
  expect(() =>
    parseGridRequest(
      { ...request(), view: { ...emptyGridView(), group: { field: "name" } } },
      columns,
    ),
  ).toThrow(GridRequestError);
});

test("bounded validation handles deep, broad, cyclic and malformed trees", () => {
  let tree = any();
  for (let i = 0; i < 30; i++) tree = any(tree);
  const cycle = any();
  cycle.of.push(cycle);
  for (const filter of [
    tree,
    cycle,
    any(...Array.from({ length: 201 }, () => where("name", "is", "x"))),
    { kind: "any", of: null },
    null,
  ]) {
    if (filter === null) continue;
    expect(() => parseGridRequest(request(filter as never), columns)).toThrow(
      GridRequestError,
    );
  }
});

test("rejects reversed date ranges and permits open-ended dates", () => {
  expect(() =>
    parseGridRequest(
      request(where("day", "between", "2026-09-25|2026-09-24")),
      columns,
    ),
  ).toThrow();
  expect(
    parseGridRequest(request(where("day", "between", "2026-09-24|")), columns)
      .view.filter,
  ).toEqual(where("day", "between", "2026-09-24|"));
});

test("paging terminates with totals, short pages and an empty page", () => {
  expect(
    nextGridPage({ rows: [1, 2], page: { limit: 2, offset: 0 }, total: 3 }),
  ).toEqual({ limit: 2, offset: 2 });
  expect(
    nextGridPage({ rows: [3], page: { limit: 2, offset: 2 }, total: 3 }),
  ).toBeUndefined();
  expect(nextGridPage({ rows: [1, 2], page: { limit: 2, offset: 0 } })).toEqual(
    { limit: 2, offset: 2 },
  );
  expect(
    nextGridPage({ rows: [1], page: { limit: 2, offset: 0 } }),
  ).toBeUndefined();
  expect(
    nextGridPage({ rows: [], page: { limit: 2, offset: 4 }, total: 10 }),
  ).toBeUndefined();
});
