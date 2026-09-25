import { decimal } from "./decimal";
import { GridConfigError, GridRequestError } from "./errors";
import { joinSql, type SqlFragment, sql, syntax } from "./fragment";
import type { SqlColumnType, SqlDialect } from "./types";

const WHITESPACE =
  " \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export function sqlDialect(name: SqlDialect) {
  if (name !== "postgres" && name !== "snowflake")
    throw new GridConfigError("Unknown SQL dialect");
  const asText = (x: SqlFragment) =>
    name === "postgres" ? sql`CAST(${x} AS text)` : sql`CAST(${x} AS VARCHAR)`;
  const trim = (x: SqlFragment) =>
    name === "postgres"
      ? sql`btrim(${x}, ${WHITESPACE})`
      : sql`TRIM(${x}, ${WHITESPACE})`;
  return {
    asText,
    trim,
    contains(x: SqlFragment, value: string) {
      // Explicit escape character avoids backslash/session escaping differences.
      const pattern = `%${value.replace(/[!%_]/g, (char) => `!${char}`)}%`;
      return sql`${asText(x)} ILIKE ${pattern} ESCAPE '!'`;
    },
    numeric(value: string, ratio: boolean) {
      const parsed = decimal(value, ratio);
      if (name === "postgres") return sql`CAST(${parsed.value} AS numeric)`;
      if (parsed.scale > 37 || parsed.integerDigits + parsed.scale > 38) {
        throw new GridRequestError([
          {
            path: "view.filter.value",
            message:
              "Snowflake numeric filters support at most 38 digits and 37 decimal places",
          },
        ]);
      }
      return sql`CAST(${parsed.value} AS NUMBER(38, ${syntax(String(parsed.scale))}))`;
    },
    day(x: SqlFragment, type: SqlColumnType | undefined, timeZone: string) {
      if (type === "date" || type === "timestamp")
        return sql`CAST(${x} AS DATE)`;
      if (type === "timestamptz")
        return name === "postgres"
          ? sql`CAST((${x} AT TIME ZONE ${timeZone}) AS DATE)`
          : sql`TO_DATE(CONVERT_TIMEZONE(${timeZone}, ${x}))`;
      throw new GridConfigError(
        "Date filtering requires sqlType: 'date', 'timestamp' or 'timestamptz'",
      );
    },
    overlaps(
      x: SqlFragment,
      type: SqlColumnType | undefined,
      tokens: readonly string[],
    ) {
      const values = joinSql(
        tokens.map((value) => sql`${value}`),
        ", ",
      );
      if (name === "postgres") {
        const array =
          type === "text[]" ? x : sql`string_to_array(${asText(x)}, ',')`;
        return sql`EXISTS (SELECT 1 FROM unnest(${array}) AS grid_element(value) WHERE lower(${trim(syntax("grid_element.value"))}) IN (${values}))`;
      }
      const array =
        type === "text[]"
          ? sql`CAST(${x} AS ARRAY)`
          : sql`SPLIT(${asText(x)}, ',')`;
      return sql`COALESCE(ARRAYS_OVERLAP(TRANSFORM(${array}, grid_element -> LOWER(${trim(asText(syntax("grid_element")))})), ARRAY_CONSTRUCT(${values})), FALSE)`;
    },
  };
}
