import { GridConfigError } from "./errors";
import type { SqlDialect } from "./types";

export type SqlValue = string | number | boolean | Date | null;
type Part = string | { value: SqlValue } | { reference: string } | SqlFragment;

/** @internal Converts structured fragments without reparsing SQL text. */
export interface FragmentVisitor<T> {
  text(text: string): T;
  value(value: SqlValue): T;
  reference(name: string): T;
  join(parts: T[]): T;
}

export class SqlFragment {
  readonly #parts: readonly Part[];
  /** @internal Use the sql tag; raw text construction is internal to the compiler. */
  constructor(parts: readonly Part[]) {
    this.#parts = parts.slice();
  }

  /** @internal Used by integrations to preserve native references and parameters. */
  map<T>(visitor: FragmentVisitor<T>): T {
    return visitor.join(
      this.#parts.map((part) => {
        if (typeof part === "string") return visitor.text(part);
        if (part instanceof SqlFragment) return part.map(visitor);
        if ("reference" in part) return visitor.reference(part.reference);
        return visitor.value(
          part.value instanceof Date ? new Date(part.value) : part.value,
        );
      }),
    );
  }

  toQuery(dialect: SqlDialect): { text: string; values: SqlValue[] } {
    if (dialect !== "postgres" && dialect !== "snowflake")
      throw new GridConfigError("Unknown SQL dialect");
    const values: SqlValue[] = [];
    const render = (fragment: SqlFragment): string =>
      fragment.#parts
        .map((part) => {
          if (typeof part === "string") return part;
          if (part instanceof SqlFragment) return render(part);
          if ("reference" in part)
            throw new GridConfigError(
              "Native SQL references require an integration renderer",
            );
          const value =
            part.value instanceof Date ? new Date(part.value) : part.value;
          values.push(value);
          return dialect === "postgres" ? `$${values.length}` : "?";
        })
        .join("");
    return { text: render(this), values };
  }
}

export function sql(
  strings: TemplateStringsArray,
  ...values: (SqlValue | SqlFragment)[]
): SqlFragment {
  const parts: Part[] = [];
  strings.forEach((text, index) => {
    parts.push(text);
    if (index === values.length) return;
    const value = values[index];
    if (value instanceof SqlFragment) {
      parts.push(value);
      return;
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value)) &&
      !(value instanceof Date && Number.isFinite(value.getTime()))
    ) {
      throw new GridConfigError(
        "SQL parameters must be finite numbers, strings, booleans, valid Dates or null",
      );
    }
    parts.push({ value: value instanceof Date ? new Date(value) : value });
  });
  return new SqlFragment(parts);
}

/** @internal Static SQL and validated identifiers only. Never pass request values. */
export const syntax = (text: string): SqlFragment => new SqlFragment([text]);
/** @internal Named native expression, resolved by the integration renderer. */
export const reference = (name: string): SqlFragment =>
  new SqlFragment([{ reference: name }]);
export const joinSql = (
  parts: readonly SqlFragment[],
  separator: string,
): SqlFragment =>
  new SqlFragment(
    parts.flatMap((part, index) => (index ? [separator, part] : [part])),
  );

export function identifier(name: string): SqlFragment {
  if (!name || name.includes("\0"))
    throw new GridConfigError(
      "SQL identifiers must be non-empty and contain no NUL characters",
    );
  return syntax(`"${name.replaceAll('"', '""')}"`);
}
