import { afterAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { ColumnTypes } from "../examples/column-types";
import { col, emptyGridView, where } from "../src";
import { pgSource } from "../src/pg";
import {
  compileGridQuery,
  GridConfigError,
  nextGridPage,
  runGrid,
  sql,
} from "../src/sql";
import {
  fixtureQuery,
  type SqlRow,
  sqlCases,
  sqlColumns,
} from "./fixtures/sql-grid";

const db = new PGlite();
afterAll(() => db.close());
const source = pgSource<SqlRow>(db, {
  query: fixtureQuery("postgres"),
  rowKey: "id",
});
test("non-null SQL outputs preserve default index null ordering", () => {
  const view = {
    ...emptyGridView(),
    sort: [{ field: "name", dir: "desc" as const }],
  };
  const compile = (sqlNullable?: boolean) =>
    compileGridQuery(
      view,
      sqlColumns.map((c) => ({ ...c, sqlNullable })),
      { dialect: "postgres", rowKey: "id" },
    ).orderBy.toQuery("postgres").text;
  expect(compile(false)).toContain('grid."name" DESC,');
  expect(compile()).toContain('grid."name" DESC NULLS LAST');
  expect(compile(true)).toContain('grid."name" DESC NULLS LAST');
  const ranked = compileGridQuery(
    { ...view, sort: [{ field: "status", dir: "desc" }] },
    sqlColumns.map((c) => ({ ...c, sqlNullable: false })),
    { dialect: "postgres", rowKey: "id" },
  ).orderBy.toQuery("postgres").text;
  expect(ranked).toContain("ELSE NULL END DESC NULLS LAST");
});
for (const c of sqlCases)
  test(c.name, async () => {
    const result = await runGrid(
      source,
      { view: c.view, page: { limit: 100, offset: 0 } },
      { columns: sqlColumns, timeZone: c.timeZone },
    );
    expect(result.rows.map((row) => row.id)).toEqual(c.ids);
    expect(result.total).toBe(c.ids.length);
  });

test("walking tied pages returns each selected row once", async () => {
  const ids: number[] = [];
  let page: { limit: number; offset: number } | undefined = {
    limit: 2,
    offset: 0,
  };
  while (page) {
    const result = await runGrid(
      source,
      {
        view: { ...emptyGridView(), sort: [{ field: "status", dir: "asc" }] },
        page,
      },
      { columns: sqlColumns, count: false },
    );
    expect(result.total).toBeUndefined();
    ids.push(...result.rows.map((row) => row.id));
    page = nextGridPage(result);
  }
  expect(ids).toEqual([1, 5, 2, 3, 4]);
});

test("identifier quoting and accessor aliases do not become executable SQL", async () => {
  const weird = 'na"me';
  const columns = [{ ...sqlColumns[1], id: "display", accessorKey: weird }];
  const view = { ...emptyGridView(), filter: where("display", "is", "hello") };
  const result = await runGrid(
    pgSource<SqlRow>(db, {
      query: sql`SELECT 1 AS "id", 'hello' AS "na""me"`,
      rowKey: "id",
    }),
    { view, page: { limit: 1, offset: 0 } },
    { columns },
  );
  expect(result.total).toBe(1);
});

test("SQL operations reject JS accessors and missing date storage metadata", () => {
  for (const columns of [
    sqlColumns.map((c) =>
      c.id === "name" ? { ...c, getFilterValue: () => "x" } : c,
    ),
    sqlColumns.map((c) => (c.id === "name" ? { ...c, sortingFn: () => 0 } : c)),
  ]) {
    const view = {
      ...emptyGridView(),
      search: "x",
      sort: [{ field: "name", dir: "asc" as const }],
    };
    expect(() =>
      compileGridQuery(view, columns, { dialect: "postgres", rowKey: "id" }),
    ).toThrow(GridConfigError);
  }
  expect(() =>
    compileGridQuery(
      { ...emptyGridView(), filter: where("day", "on", "2026-09-24") },
      sqlColumns.map((c) => ({ ...c, sqlType: undefined })),
      { dialect: "postgres", rowKey: "id" },
    ),
  ).toThrow(GridConfigError);
});

test("count conversion rejects imprecise totals and driver errors propagate", async () => {
  const query = sql`select 1 as id`;
  const request = { view: emptyGridView(), page: { limit: 1, offset: 0 } };
  const source = pgSource(
    {
      query: async (text: string) => ({
        rows: text.includes("count(*)")
          ? [{ __grid_total: "9007199254740993" }]
          : [{ id: 1 }],
      }),
    },
    { query, rowKey: "id" },
  );
  await expect(runGrid(source, request, { columns: [] })).rejects.toThrow(
    "safe integer",
  );
  const error = new Error("database unavailable");
  await expect(
    runGrid(
      pgSource(
        {
          query: async () => {
            throw error;
          },
        },
        { query, rowKey: "id" },
      ),
      request,
      { columns: [] },
    ),
  ).rejects.toBe(error);
});

test("aborted and invalid requests never execute a database query", async () => {
  let calls = 0;
  const source = pgSource(
    {
      query: async () => {
        calls++;
        return { rows: [] };
      },
    },
    { query: sql`select 1`, rowKey: "id" },
  );
  await expect(
    runGrid(
      source,
      { view: emptyGridView(), page: { limit: 1, offset: 0 } },
      { columns: [], signal: AbortSignal.abort() },
    ),
  ).rejects.toThrow();
  await expect(
    runGrid(
      source,
      { view: emptyGridView(), page: { limit: 0, offset: 0 } },
      { columns: [] },
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("an application can explicitly raise the page limit without bypassing validation", async () => {
  const request = { view: emptyGridView(), page: { limit: 1500, offset: 0 } };
  await expect(
    runGrid(source, request, { columns: sqlColumns, count: false }),
  ).rejects.toThrow();
  const result = await runGrid(source, request, {
    columns: sqlColumns,
    count: false,
    maxLimit: 2000,
  });
  expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
});

test("numeric filters preserve decimal precision beyond JavaScript numbers", async () => {
  const columns = [
    col<{ id: number; price: string }>({
      id: "price",
      label: "Price",
      type: ColumnTypes.NUMBER,
    }),
  ];
  const exact = pgSource<{ price: string; id: number }>(db, {
    query: sql`SELECT 1 AS id, 9007199254740992::numeric AS price UNION ALL SELECT 2, 9007199254740993::numeric`,
    rowKey: "id",
  });
  const result = await runGrid(
    exact,
    {
      view: {
        ...emptyGridView(),
        filter: where("price", "=", "9007199254740993"),
      },
      page: { limit: 10, offset: 0 },
    },
    { columns },
  );
  expect(result.rows.map((row) => row.id)).toEqual([2]);
});

test("ratio scaling preserves exact decimals instead of dividing JavaScript floats", async () => {
  const exact = pgSource<{ id: number; ratio: string }>(db, {
    query: sql`SELECT 1 AS id, 0.0001234567890123456789::numeric AS ratio`,
    rowKey: "id",
  });
  const result = await runGrid(
    exact,
    {
      view: {
        ...emptyGridView(),
        filter: where("ratio", "=", "0.01234567890123456789"),
      },
      page: { limit: 10, offset: 0 },
    },
    {
      columns: [
        col<{ id: number; ratio: string }>({
          id: "ratio",
          label: "Ratio",
          type: ColumnTypes.PROGRESS,
        }),
      ],
    },
  );
  expect(result.total).toBe(1);
});

test("enum sort ranks compare numerically past ten options", async () => {
  const values = Array.from({ length: 12 }, (_, i) => `s${i}`);
  const ranked = pgSource<{ id: number; status: string }>(db, {
    query: sql`SELECT n AS id, 's' || n AS status FROM generate_series(0, 11) AS n`,
    rowKey: "id",
  });
  const result = await runGrid(
    ranked,
    {
      view: { ...emptyGridView(), sort: [{ field: "status", dir: "asc" }] },
      page: { limit: 20, offset: 0 },
    },
    {
      columns: [
        col<{ id: number; status: string }>({
          id: "status",
          label: "Status",
          type: ColumnTypes.BADGE,
          filterOptions: values.map((value) => ({ value, label: value })),
        }),
      ],
    },
  );
  expect(result.rows.map((row) => row.status)).toEqual(values);
});
