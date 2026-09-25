import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { compileDrizzleQuery } from "../src/drizzle";
import { fixtureQuery, sqlCases, sqlColumns } from "./fixtures/sql-grid";

const fixture = pgTable("drizzle_fixture", {
  id: integer(),
  name: text(),
  price: numeric(),
  ratio: numeric(),
  status: text(),
  tags: text().array(),
  tagsText: text(),
  day: date(),
  instant: timestamp({ withTimezone: true }),
  tenant: text(),
});
const client = new PGlite();
const db = drizzle(client);
afterAll(() => client.close());
beforeAll(async () => {
  const seed = fixtureQuery("postgres").toQuery("postgres");
  await client.query(
    `CREATE TABLE drizzle_fixture AS ${seed.text}`,
    seed.values,
  );
});
for (const c of sqlCases) {
  test(`Drizzle parity: ${c.name}`, async () => {
    const compiled = compileDrizzleQuery(
      { view: c.view, page: { limit: 100, offset: 0 } },
      sqlColumns,
      {
        fields: {
          id: fixture.id,
          name: fixture.name,
          price: fixture.price,
          ratio: fixture.ratio,
          status: fixture.status,
          tags: fixture.tags,
          tagsText: fixture.tagsText,
          day: fixture.day,
          instant: fixture.instant,
        },
        rowKey: fixture.id,
        timeZone: c.timeZone,
      },
    );
    const rows = await db
      .select({ id: fixture.id })
      .from(fixture)
      .where(compiled.where)
      .orderBy(...compiled.orderBy)
      .limit(compiled.limit)
      .offset(compiled.offset);
    expect(rows.map((row) => row.id)).toEqual(c.ids);
  });
}
