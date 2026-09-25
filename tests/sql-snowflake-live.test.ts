import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import type { Connection } from "snowflake-sdk";
import { ColumnTypes } from "../examples/column-types";
import { col, emptyGridView, where } from "../src";
import { snowflakeSource } from "../src/snowflake";
import { type GridSource, runGrid, sql } from "../src/sql";
import {
  fixtureQuery,
  type SqlRow,
  sqlCases,
  sqlColumns,
} from "./fixtures/sql-grid";

// Explicit opt-in: fixture is SELECT-only and never reads application tables.
describe.skipIf(process.env.SNOWFLAKE_TEST !== "1")(
  "live Snowflake SELECT fixture",
  () => {
    let connection: Connection | undefined;
    let source: GridSource<SqlRow>;
    beforeAll(async () => {
      const { default: snowflake } = await import("snowflake-sdk");
      snowflake.configure({ logLevel: "OFF" });
      const account = process.env.SNOWFLAKE_ACCOUNT;
      const username = process.env.SNOWFLAKE_USER;
      if (!account || !username)
        throw new Error("Set SNOWFLAKE_ACCOUNT and SNOWFLAKE_USER");
      connection = snowflake.createConnection({
        account,
        username,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE,
        role: process.env.SNOWFLAKE_ROLE,
        ...(process.env.SNOWFLAKE_PRIVATE_KEY
          ? {
              authenticator: "SNOWFLAKE_JWT",
              privateKey: createPrivateKey(
                process.env.SNOWFLAKE_PRIVATE_KEY.replaceAll("\\n", "\n")
                  .replace(/(-----BEGIN [A-Z ]+-----)\s*/, "$1\n")
                  .replace(/\s*(-----END [A-Z ]+-----)/, "\n$1\n"),
              )
                .export({ format: "pem", type: "pkcs8" })
                .toString(),
            }
          : { password: process.env.SNOWFLAKE_PASSWORD }),
        clientSessionKeepAlive: false,
      });
      await new Promise<void>((resolve, reject) =>
        connection?.connect((error) => (error ? reject(error) : resolve())),
      );
      source = snowflakeSource<SqlRow>(connection, {
        query: fixtureQuery("snowflake"),
        rowKey: "id",
      });
    }, 60000);
    afterAll(async () => {
      if (connection)
        await new Promise<void>((resolve, reject) =>
          connection?.destroy((error) => (error ? reject(error) : resolve())),
        );
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
      }, 30000);
    test("large decimal filters select the exact row", async () => {
      if (!connection) throw new Error("Missing connection");
      const source = snowflakeSource<{ id: number; price: unknown }>(
        connection,
        {
          query: sql`SELECT 1 AS "id", 9007199254740992::NUMBER(38,0) AS "price" UNION ALL SELECT 2, 9007199254740993::NUMBER(38,0)`,
          rowKey: "id",
        },
      );
      const result = await runGrid(
        source,
        {
          view: {
            ...emptyGridView(),
            filter: where("price", "=", "9007199254740993"),
          },
          page: { limit: 10, offset: 0 },
        },
        {
          columns: [
            col({ id: "price", label: "Price", type: ColumnTypes.NUMBER }),
          ],
        },
      );
      expect(result.rows.map((row) => row.id)).toEqual([2]);
    }, 30000);
    test("ratio scaling retains exact fractional digits", async () => {
      if (!connection) throw new Error("Missing connection");
      const source = snowflakeSource(connection, {
        query: sql`SELECT 1 AS "id", 0.0001234567890123456789::NUMBER(38,22) AS "ratio"`,
        rowKey: "id",
      });
      const result = await runGrid(
        source,
        {
          view: {
            ...emptyGridView(),
            filter: where("ratio", "=", "0.01234567890123456789"),
          },
          page: { limit: 10, offset: 0 },
        },
        {
          columns: [
            col({ id: "ratio", label: "Ratio", type: ColumnTypes.PROGRESS }),
          ],
        },
      );
      expect(result.total).toBe(1);
    }, 30000);
  },
);
