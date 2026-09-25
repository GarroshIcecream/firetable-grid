import { createSqlSource } from "./sql/source";
import type { GridSource, SqlSourceOptions } from "./sql/types";

export { sql } from "./sql/fragment";
export interface PgQueryable {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Uses the caller's pool/client. This minimal driver interface cannot cancel an in-flight query. */
export function pgSource<TRow extends object = Record<string, unknown>>(
  queryable: PgQueryable,
  options: SqlSourceOptions,
): GridSource<TRow> {
  return createSqlSource({
    ...options,
    dialect: "postgres",
    execute: async (text, values) => (await queryable.query(text, values)).rows,
  });
}
