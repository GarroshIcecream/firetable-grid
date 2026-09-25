// Server-only application code. The application supplies its own Drizzle db/tx.
import { and, count, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { alias, integer, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { col } from "../src";
import { compileDrizzleQuery } from "../src/drizzle";
import { ColumnTypes } from "./column-types";

const sellers = pgTable("sellers", {
  id: integer().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text().notNull(),
});
const listings = pgTable("listings", {
  id: integer().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  sellerId: integer("seller_id"),
  price: numeric().notNull(),
});
const seller = alias(sellers, "seller");
const columns = [
  col({ id: "sellerName", label: "Seller", type: ColumnTypes.TEXT }),
  col({
    id: "grossPrice",
    label: "Gross price",
    type: ColumnTypes.CURRENCY,
    searchable: false,
  }),
];

export async function queryDrizzleListings<
  TQueryResult extends PgQueryResultHKT,
>(
  db: PgDatabase<TQueryResult>,
  body: unknown,
  authenticatedTenantId: string,
  taxMultiplier: string,
) {
  const grossPrice = sql<string>`${listings.price} * ${taxMultiplier}::numeric`;
  const compiled = compileDrizzleQuery(body, columns, {
    fields: { sellerName: seller.name, grossPrice },
    rowKey: listings.id,
  });
  const predicate = and(
    eq(listings.tenantId, authenticatedTenantId),
    compiled.where,
  );
  const join = and(
    eq(listings.sellerId, seller.id),
    eq(seller.tenantId, authenticatedTenantId),
  );
  const rows = await db
    .select({ id: listings.id, sellerName: seller.name, grossPrice })
    .from(listings)
    .leftJoin(seller, join)
    .where(predicate)
    .orderBy(...compiled.orderBy)
    .limit(compiled.limit)
    .offset(compiled.offset);
  const [total] = await db
    .select({ value: count() })
    .from(listings)
    .leftJoin(seller, join)
    .where(predicate);
  // Pass a transaction instead of db when rows/count require one consistent snapshot.
  return {
    rows,
    total: total.value,
    page: { limit: compiled.limit, offset: compiled.offset },
  };
}
