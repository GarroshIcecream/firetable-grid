import { GridConfigError } from "./sql/errors";
import { createSqlSource } from "./sql/source";
import type { GridSource, SqlSourceOptions } from "./sql/types";

export { sql } from "./sql/fragment";
export interface SnowflakeStatement {
  cancel(callback: (error?: Error | null) => void): void;
}
export interface SnowflakeExecuteOptions {
  sqlText: string;
  binds: (string | number | boolean | null)[];
  streamResult: false;
  rowMode: "object";
  complete(
    error: Error | null | undefined,
    statement: SnowflakeStatement,
    rows?: unknown[],
  ): void;
}
export interface SnowflakeConnection {
  execute(options: SnowflakeExecuteOptions): SnowflakeStatement;
}

/** The caller owns connection authentication and lifecycle. */
export function snowflakeSource<TRow extends object = Record<string, unknown>>(
  connection: SnowflakeConnection,
  options: SqlSourceOptions,
): GridSource<TRow> {
  return createSqlSource({
    ...options,
    dialect: "snowflake",
    execute: (text, values, signal) =>
      new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        let statement: SnowflakeStatement | undefined;
        let settled = false;
        let cancelRequested = false;
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const cancel = () => {
          try {
            statement?.cancel(() => {});
          } catch {
            /* Cancellation is best effort; the original abort remains the result. */
          }
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          cancelRequested = true;
          cleanup();
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          cancel();
        };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          statement = connection.execute({
            sqlText: text,
            // Snowflake treats arbitrary objects as text; normalize Date explicitly.
            binds: values.map((value) =>
              value instanceof Date ? value.toISOString() : value,
            ),
            streamResult: false,
            rowMode: "object",
            complete(error, _statement, rows) {
              if (settled) return;
              settled = true;
              cleanup();
              if (error) reject(error);
              else if (!Array.isArray(rows))
                reject(
                  new GridConfigError(
                    "Snowflake did not return rows. Supply a SELECT query and disable asynchronous execution.",
                  ),
                );
              else resolve(rows);
            },
          });
          if (cancelRequested) cancel();
        } catch (error) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        }
      }),
  });
}
