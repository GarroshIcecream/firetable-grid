// Server-only application code. Authenticate before constructing the tenant's source.
import { type PgQueryable, pgSource } from "../src/pg";
import { type SnowflakeConnection, snowflakeSource } from "../src/snowflake";
import {
  GridRequestError,
  type GridSource,
  parseGridRequest,
  runGrid,
  sql,
} from "../src/sql";
import { type ListingRow, listingColumns } from "./sql-columns";

export function pgListings(pool: PgQueryable, authenticatedTenantId: string) {
  return pgSource<ListingRow>(pool, {
    query: sql`SELECT id::text AS "id", make AS "make", price::float8 AS "price", created_at::date::text AS "createdAt" FROM listings WHERE tenant_id = ${authenticatedTenantId}`,
    rowKey: "id",
  });
}

export function snowflakeListings(
  connection: SnowflakeConnection,
  authenticatedTenantId: string,
) {
  return snowflakeSource<ListingRow>(connection, {
    query: sql`SELECT TO_VARCHAR(ID) AS "id", MAKE AS "make", PRICE::DOUBLE AS "price", TO_CHAR(CREATED_AT::DATE, 'YYYY-MM-DD') AS "createdAt" FROM ANALYTICS.LISTINGS WHERE TENANT_ID = ${authenticatedTenantId}`,
    rowKey: "id",
  });
}

// An app route obtains the tenant from its authenticated session, creates the
// appropriate source above, then delegates here. Never use a body-supplied tenant.
export async function handleListingsRequest(
  request: Request,
  source: GridSource<ListingRow>,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const input = parseGridRequest(body, listingColumns);
    const result = await runGrid(source, input, {
      columns: listingColumns,
      count: false,
      signal: request.signal,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof GridRequestError)
      return Response.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}
