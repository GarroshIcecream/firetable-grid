import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { alias, integer, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { ColumnTypes } from "../examples/column-types";
import { col, emptyGridView, where } from "../src";
import { compileDrizzleQuery } from "../src/drizzle";
import {
  GridConfigError,
  type GridRequest,
  GridRequestError,
} from "../src/sql";

const accounts = pgTable("accounts", {
  id: integer().primaryKey(),
  tenant: text().notNull(),
  name: text().notNull(),
});
const orders = pgTable("orders", {
  id: integer().primaryKey(),
  tenant: text().notNull(),
  accountId: integer("account_id"),
  amount: numeric().notNull(),
});
const customer = alias(accounts, "customer");
const client = new PGlite();
const db = drizzle(client);
afterAll(() => client.close());
beforeAll(async () => {
  await client.exec(`
    CREATE TABLE accounts (id integer PRIMARY KEY, tenant text NOT NULL, name text NOT NULL);
    CREATE TABLE orders (id integer PRIMARY KEY, tenant text NOT NULL, account_id integer, amount numeric NOT NULL);
    INSERT INTO accounts VALUES (1, 'a', 'Alpha_100%'), (2, 'a', 'beta'), (3, 'b', 'Alpha_100%');
    INSERT INTO orders VALUES (1, 'a', 1, 10), (2, 'a', 2, 20), (3, 'a', NULL, 20),
      (4, 'b', 3, 10), (5, 'a', 1, 9007199254740993);
  `);
});
const columns = [
  col({ id: "customerName", label: "Customer", type: ColumnTypes.TEXT }),
  col({
    id: "amount",
    label: "Amount",
    type: ColumnTypes.NUMBER,
    searchable: false,
  }),
];
const fields = { customerName: customer.name, amount: orders.amount };
const request = (view: Partial<GridRequest["view"]> = {}): GridRequest => ({
  view: { ...emptyGridView(), ...view },
  page: { limit: 10, offset: 0 },
});
const run = (input: GridRequest, expressions = fields) => {
  const compiled = compileDrizzleQuery(input, columns, {
    fields: expressions,
    rowKey: orders.id,
  });
  return db
    .select({ id: orders.id })
    .from(orders)
    .leftJoin(customer, eq(orders.accountId, customer.id))
    .where(and(eq(orders.tenant, "a"), compiled.where))
    .orderBy(...compiled.orderBy)
    .limit(compiled.limit)
    .offset(compiled.offset);
};

test("Drizzle predicates compose with tenant scope and joined typed aliases", async () => {
  const rows = await run(
    request({ filter: where("customerName", "is", "Alpha_100%") }),
  );
  expect(rows.map((row) => row.id)).toEqual([1, 5]);
});

test("search keeps wildcard characters literal and respects mapped field ids", async () => {
  const rows = await run(request({ search: "_100%" }));
  expect(rows.map((row) => row.id)).toEqual([1, 5]);
});

test("joined notNull columns still sort outer-join nulls last and paginate ties", async () => {
  const input = request({ sort: [{ field: "customerName", dir: "desc" }] });
  expect((await run(input)).map((row) => row.id)).toEqual([2, 1, 5, 3]);
  input.page = { limit: 2, offset: 1 };
  expect((await run(input)).map((row) => row.id)).toEqual([1, 5]);
});

test("computed expressions retain their parameters and numeric precision", async () => {
  const computed = sql`${orders.amount} + ${"0.0000000000000001"}::numeric`;
  const value = "9007199254740993.0000000000000001";
  const compiled = compileDrizzleQuery(
    request({ filter: where("amount", "=", value) }),
    columns,
    {
      fields: { ...fields, amount: computed },
      rowKey: orders.id,
    },
  );
  const query = db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tenant, "a"), compiled.where))
    .orderBy(...compiled.orderBy);
  expect((await query).map((row) => row.id)).toEqual([5]);
  const generated = query.toSQL();
  expect(generated.sql).not.toContain(value);
  expect(generated.params).toContain(value);
  expect(
    generated.params.filter((param) => param === "0.0000000000000001"),
  ).toHaveLength(3);
});

test("request values remain bound even when they contain SQL and placeholder text", async () => {
  const input = request({
    filter: where("customerName", "is", "x' OR TRUE -- $1 ?"),
  });
  const query = run(input);
  expect(query.toSQL().sql).not.toContain("OR TRUE");
  expect(query.toSQL().params).toContain("x' OR TRUE -- $1 ?");
  expect(await query).toEqual([]);
});

test("unknown fields, missing mappings and invalid pagination fail before query construction", () => {
  const options = { fields, rowKey: orders.id };
  expect(() =>
    compileDrizzleQuery(
      request({ filter: where("unknown", "is", "x") }),
      columns,
      options,
    ),
  ).toThrow(GridRequestError);
  expect(() =>
    compileDrizzleQuery(request({ search: "x" }), columns, {
      ...options,
      fields: {},
    }),
  ).toThrow(GridConfigError);
  expect(() =>
    compileDrizzleQuery(
      { ...request(), page: { limit: 0, offset: 0 } },
      columns,
      options,
    ),
  ).toThrow(GridRequestError);
  expect(() =>
    compileDrizzleQuery(
      { ...request(), page: { limit: 1500, offset: 0 } },
      columns,
      options,
    ),
  ).toThrow(GridRequestError);
  expect(
    compileDrizzleQuery(
      { ...request(), page: { limit: 1500, offset: 0 } },
      columns,
      { ...options, maxLimit: 2000 },
    ).limit,
  ).toBe(1500);
});

test("each sort stays separately composable with the unique row key last", () => {
  const compiled = compileDrizzleQuery(
    request({
      sort: [
        { field: "customerName", dir: "asc" },
        { field: "amount", dir: "desc" },
      ],
    }),
    columns,
    { fields, rowKey: orders.id },
  );
  expect(compiled.orderBy).toHaveLength(3);
});
