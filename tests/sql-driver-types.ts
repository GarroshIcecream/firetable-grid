import type { Client, Pool } from "pg";
import type { Connection } from "snowflake-sdk";
import { pgSource } from "../src/pg";
import { snowflakeSource } from "../src/snowflake";
import { sql } from "../src/sql";

// Compiled by tsc: real driver types must satisfy the public structural interfaces.
export function driverCompatibility(
  pool: Pool,
  client: Client,
  connection: Connection,
) {
  const options = { query: sql`SELECT 1 AS "id"`, rowKey: "id" };
  pgSource(pool, options);
  pgSource(client, options);
  snowflakeSource(connection, options);
}
