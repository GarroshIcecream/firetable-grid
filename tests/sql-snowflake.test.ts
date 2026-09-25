import { expect, test } from "bun:test";
import { emptyGridView, where } from "../src";
import {
  type SnowflakeConnection,
  type SnowflakeExecuteOptions,
  snowflakeSource,
} from "../src/snowflake";
import { compileGridQuery, runGrid, sql } from "../src/sql";
import { sqlColumns } from "./fixtures/sql-grid";

const request = { view: emptyGridView(), page: { limit: 2, offset: 0 } };
const statement = { cancel: (_callback: (error?: Error | null) => void) => {} };

test("Snowflake binds source, filter and paging values separately and preserves row objects", async () => {
  const calls: SnowflakeExecuteOptions[] = [];
  const connection: SnowflakeConnection = {
    execute(options) {
      calls.push(options);
      queueMicrotask(() =>
        options.complete(
          undefined,
          statement,
          options.sqlText.includes("count(*)")
            ? [{ __grid_total: "1" }]
            : [{ id: 7 }],
        ),
      );
      return statement;
    },
  };
  const source = snowflakeSource(connection, {
    query: sql`SELECT 7 AS "id" WHERE ${"tenant"} = ${"tenant"}`,
    rowKey: "id",
  });
  const result = await runGrid(source, request, { columns: [] });
  expect(result).toEqual({
    rows: [{ id: 7 }],
    total: 1,
    page: { limit: 2, offset: 0 },
  });
  expect(calls[0].sqlText).toContain("LIMIT ? OFFSET ?");
  expect(calls[0].sqlText).not.toContain("tenant");
  expect(calls[0].binds).toEqual(["tenant", "tenant", 2, 0]);
  expect(calls[0].streamResult).toBe(false);
  expect(calls[0].rowMode).toBe("object");
});

test("dialect uses explicit timezone conversion and array membership with bound tokens", () => {
  const dates = compileGridQuery(
    { ...emptyGridView(), filter: where("instant", "on", "2026-09-25") },
    sqlColumns,
    { dialect: "snowflake", rowKey: "id", timeZone: "Europe/Prague" },
  ).where.toQuery("snowflake");
  expect(dates.text).toContain('TO_DATE(CONVERT_TIMEZONE(?, grid."instant"))');
  expect(dates.values).toContain("Europe/Prague");
  const arrays = compileGridQuery(
    { ...emptyGridView(), filter: where("tags", "is not", "RED, blue") },
    sqlColumns,
    { dialect: "snowflake", rowKey: "id" },
  ).where.toQuery("snowflake");
  expect(arrays.text).toContain("ARRAYS_OVERLAP(TRANSFORM(");
  expect(arrays.text).toContain("ARRAY_CONSTRUCT(?, ?)");
  expect(arrays.values.slice(-2)).toEqual(["red", "blue"]);
});

test("abort cancels its statement once and ignores late completion", async () => {
  let cancels = 0;
  let pending: SnowflakeExecuteOptions | undefined;
  const handle = {
    cancel: () => {
      cancels++;
    },
  };
  const connection = {
    execute(options: SnowflakeExecuteOptions) {
      pending = options;
      return handle;
    },
  };
  const controller = new AbortController();
  const promise = runGrid(
    snowflakeSource(connection, { query: sql`SELECT 1 AS "id"`, rowKey: "id" }),
    request,
    { columns: [], signal: controller.signal },
  );
  const reason = new Error("changed search");
  controller.abort(reason);
  await expect(promise).rejects.toBe(reason);
  pending?.complete(undefined, handle, [{ id: 1 }]);
  expect(cancels).toBe(1);
});

test("abort occurring during execute still cancels the returned handle", async () => {
  const controller = new AbortController();
  let cancels = 0;
  const connection = {
    execute() {
      controller.abort();
      return {
        cancel() {
          cancels++;
        },
      };
    },
  };
  await expect(
    runGrid(
      snowflakeSource(connection, { query: sql`SELECT 1`, rowKey: "id" }),
      request,
      { columns: [], signal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(cancels).toBe(1);
});

test("completed statements are not canceled by later aborts", async () => {
  const controller = new AbortController();
  let cancels = 0;
  const handle = {
    cancel() {
      cancels++;
    },
  };
  const connection = {
    execute(options: SnowflakeExecuteOptions) {
      queueMicrotask(() => options.complete(undefined, handle, []));
      return handle;
    },
  };
  await runGrid(
    snowflakeSource(connection, { query: sql`SELECT 1`, rowKey: "id" }),
    request,
    { columns: [], count: false, signal: controller.signal },
  );
  controller.abort();
  expect(cancels).toBe(0);
});

test("synchronous driver throws and callback errors propagate unchanged", async () => {
  const error = new Error("warehouse unavailable");
  for (const connection of [
    {
      execute() {
        throw error;
      },
    },
    {
      execute(options: SnowflakeExecuteOptions) {
        queueMicrotask(() => options.complete(error, statement, undefined));
        return statement;
      },
    },
  ]) {
    await expect(
      runGrid(
        snowflakeSource(connection, { query: sql`SELECT 1`, rowKey: "id" }),
        request,
        { columns: [] },
      ),
    ).rejects.toBe(error);
  }
});
