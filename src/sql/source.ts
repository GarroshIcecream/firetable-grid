import { compileGridQuery } from "./compiler";
import { GridConfigError } from "./errors";
import { identifier, type SqlValue, sql } from "./fragment";
import { parseGridRequest } from "./request";
import type { GridSource, SqlDialect, SqlSourceOptions } from "./types";

export type SqlExecutor = (
  text: string,
  values: SqlValue[],
  signal?: AbortSignal,
) => Promise<unknown[]>;
export function createSqlSource<TRow extends object>(
  options: SqlSourceOptions & { dialect: SqlDialect; execute: SqlExecutor },
): GridSource<TRow> {
  identifier(options.rowKey);
  return {
    async query(input) {
      input.signal?.throwIfAborted();
      const { view, page } = parseGridRequest(input, input.columns, {
        maxLimit: input.maxLimit,
      });
      const { where, orderBy } = compileGridQuery(view, input.columns, {
        dialect: options.dialect,
        rowKey: options.rowKey,
        timeZone: input.timeZone,
      });
      const execute = async (query: ReturnType<typeof sql>) => {
        input.signal?.throwIfAborted();
        const { text, values } = query.toQuery(options.dialect);
        const rows = await options.execute(text, values, input.signal);
        input.signal?.throwIfAborted();
        return rows;
      };
      const rows = (await execute(
        sql`SELECT * FROM (${options.query}) AS grid WHERE ${where} ORDER BY ${orderBy} LIMIT ${page.limit} OFFSET ${page.offset}`,
      )) as TRow[];
      if (!input.count) return { rows, page };
      const counts = await execute(
        sql`SELECT count(*) AS "__grid_total" FROM (${options.query}) AS grid WHERE ${where}`,
      );
      const raw = (counts[0] as Record<string, unknown> | undefined)
        ?.__grid_total;
      const total =
        typeof raw === "number" ||
        typeof raw === "bigint" ||
        (typeof raw === "string" && /^\d+$/.test(raw))
          ? Number(raw)
          : NaN;
      if (!Number.isSafeInteger(total) || total < 0)
        throw new GridConfigError(
          "Grid total must be a non-negative safe integer",
        );
      return { rows, page, total };
    },
  };
}
