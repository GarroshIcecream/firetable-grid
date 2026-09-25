import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { compileGridFragments } from "./sql/compiler";
import { GridConfigError } from "./sql/errors";
import { reference, type SqlFragment } from "./sql/fragment";
import { parseGridRequest } from "./sql/request";
import type { SqlGridColumn } from "./sql/types";

export type DrizzleGridExpression = AnyPgColumn | SQL;

export interface CompileDrizzleOptions {
  /** Trusted server-side expressions keyed by grid field id. */
  fields: Readonly<Record<string, DrizzleGridExpression>>;
  /** Unique, non-null expression for each result row, including after joins. */
  rowKey: DrizzleGridExpression;
  timeZone?: string;
  maxLimit?: number;
}

export interface DrizzleGridQuery {
  where: SQL;
  orderBy: SQL[];
  limit: number;
  offset: number;
}

/** PostgreSQL only. Compose these expressions into your own Drizzle query. */
export function compileDrizzleQuery<TRow extends object>(
  request: unknown,
  columns: readonly SqlGridColumn<TRow>[],
  options: CompileDrizzleOptions,
): DrizzleGridQuery {
  const { view, page } = parseGridRequest(request, columns, options);
  const expressions = new Map<string, DrizzleGridExpression>();
  const rowKey = "row-key";
  expressions.set(rowKey, options.rowKey);
  const fragments = compileGridFragments(
    view,
    columns,
    { dialect: "postgres", timeZone: options.timeZone },
    {
      column: (column) => {
        if (
          !Object.hasOwn(options.fields, column.id) ||
          !options.fields[column.id]
        ) {
          throw new GridConfigError(
            `Missing Drizzle expression for column "${column.id}"`,
          );
        }
        const key = `field:${column.id}`;
        expressions.set(key, options.fields[column.id]);
        return reference(key);
      },
      rowKey: reference(rowKey),
    },
  );
  const convert = (fragment: SqlFragment): SQL =>
    fragment.map<SQL>({
      text: sql.raw,
      value: (value) => sql`${value}`,
      reference: (name) => {
        const expression = expressions.get(name);
        if (!expression)
          throw new GridConfigError(`Missing Drizzle expression "${name}"`);
        return sql`(${expression})`;
      },
      join: (parts) => sql.join(parts, sql.raw("")),
    });
  return {
    where: convert(fragments.where),
    orderBy: fragments.orderBy.map(convert),
    ...page,
  };
}
