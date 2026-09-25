import type { FilterCondition, FilterNode } from "../filter-engine";
import type { GridView } from "../grid-view";
import { sqlDialect } from "./dialect";
import { GridConfigError } from "./errors";
import { identifier, joinSql, type SqlFragment, sql, syntax } from "./fragment";
import { columnMap, parseGridRequest } from "./request";
import type { SqlDialect, SqlGridColumn } from "./types";

export interface CompileGridOptions {
  dialect: SqlDialect;
  rowKey: string;
  timeZone?: string;
}
const TRUE = syntax("TRUE");
const FALSE = syntax("FALSE");
const numericOperators: Record<string, string> = {
  "=": "=",
  "≠": "<>",
  ">": ">",
  "<": "<",
  "≥": ">=",
  "≤": "<=",
};
const tokens = (value: string) =>
  value
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

export function compileGridQuery<TRow extends object>(
  view: GridView,
  columns: readonly SqlGridColumn<TRow>[],
  options: CompileGridOptions,
): { where: SqlFragment; orderBy: SqlFragment } {
  const compiled = compileGridFragments(view, columns, options, {
    column: (col) => sql`grid.${identifier(col.accessorKey ?? col.id)}`,
    rowKey: sql`grid.${identifier(options.rowKey)}`,
  });
  return { where: compiled.where, orderBy: joinSql(compiled.orderBy, ", ") };
}

/** @internal Shared compiler for native SQL integrations. */
export function compileGridFragments<TRow extends object>(
  view: GridView,
  columns: readonly SqlGridColumn<TRow>[],
  options: Omit<CompileGridOptions, "rowKey">,
  references: {
    column: (column: SqlGridColumn<TRow>) => SqlFragment;
    rowKey: SqlFragment;
  },
): { where: SqlFragment; orderBy: SqlFragment[] } {
  view = parseGridRequest(
    { view, page: { limit: 1, offset: 0 } },
    columns,
  ).view;
  const map = columnMap(columns);
  const dialect = sqlDialect(options.dialect);
  const timeZone = options.timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new GridConfigError(`Invalid timeZone: "${timeZone}"`);
  }
  const column = (id: string) => {
    const found = map.get(id);
    if (!found) throw new GridConfigError(`Unknown column "${id}"`);
    return found;
  };
  const ref = (col: SqlGridColumn<TRow>, operation: "filter" | "sort") => {
    if (
      (operation === "filter" && col.getFilterValue) ||
      (operation === "sort" && col.sortingFn)
    ) {
      throw new GridConfigError(
        `Column "${col.id}" has a JavaScript ${operation} function. Expose its value in the SELECT and use a SQL column definition.`,
      );
    }
    return references.column(col);
  };
  const empty = (x: SqlFragment, col: SqlGridColumn<TRow>): SqlFragment => {
    if (col.sqlType === "text[]" || col.type.filterType === "date")
      return sql`(${x} IS NULL)`;
    const text = dialect.asText(x);
    if (col.type.filterType === "numeric" || col.sqlType === "number")
      return sql`(${x} IS NULL OR lower(${text}) = 'nan')`;
    return sql`(${x} IS NULL OR ${dialect.trim(text)} = '')`;
  };
  const condition = ({ field, op, value }: FilterCondition): SqlFragment => {
    const col = column(field);
    const x = ref(col, "filter");
    const isEmpty = empty(x, col);
    if (op === "is empty") return isEmpty;
    if (op === "is not empty") return sql`NOT ${isEmpty}`;
    const type = col.type.filterType;
    if (type === "numeric") {
      if (value.trim() === "") return TRUE;
      const operator = numericOperators[op];
      return operator
        ? sql`(NOT ${isEmpty} AND ${x} ${syntax(operator)} ${dialect.numeric(value, col.type.ratioStored ?? false)})`
        : sql`NOT ${isEmpty}`;
    }
    if (type === "date") {
      const bounds = op === "between" ? value.split("|") : [value];
      if (bounds.every((bound) => bound === "")) return TRUE;
      let day: SqlFragment;
      try {
        day = dialect.day(x, col.sqlType, timeZone);
      } catch (error) {
        throw new GridConfigError(
          `Column "${field}": ${(error as Error).message}`,
        );
      }
      if (op === "between") {
        const conditions: SqlFragment[] = [];
        if (bounds[0])
          conditions.push(sql`${day} >= CAST(${bounds[0]} AS DATE)`);
        if (bounds[1])
          conditions.push(sql`${day} <= CAST(${bounds[1]} AS DATE)`);
        return sql`(${joinSql(conditions, " AND ")})`;
      }
      const operator = { on: "=", before: "<", after: ">" }[
        op as "on" | "before" | "after"
      ];
      return operator
        ? sql`${day} ${syntax(operator)} CAST(${value} AS DATE)`
        : sql`${day} IS NOT NULL`;
    }
    if (type === "enum" && col.type.setValued) {
      const wanted = tokens(value);
      if (!wanted.length) return TRUE;
      const overlap = dialect.overlaps(x, col.sqlType, wanted);
      return op === "is not" ? sql`NOT (${overlap})` : overlap;
    }
    const text = dialect.asText(x);
    let match: SqlFragment;
    if (
      col.multiSelect &&
      (op === "is" || op === "is not") &&
      value.includes(",")
    ) {
      const wanted = tokens(value);
      if (!wanted.length) match = TRUE;
      else {
        match = sql`lower(${text}) IN (${joinSql(
          wanted.map((token) => sql`${token}`),
          ", ",
        )})`;
        if (op === "is not") match = sql`NOT (${match})`;
      }
    } else if (op === "contains") match = dialect.contains(x, value);
    else if (op === "is" || op === "is not")
      match = sql`lower(${text}) ${syntax(op === "is" ? "=" : "<>")} lower(${value})`;
    else match = TRUE;
    return value.trim() === ""
      ? sql`(${isEmpty} OR (NOT ${isEmpty} AND ${match}))`
      : sql`(NOT ${isEmpty} AND ${match})`;
  };
  const node = (filter: FilterNode): SqlFragment => {
    if (filter.kind === "where") return condition(filter);
    if (!filter.of.length) return TRUE;
    return sql`(${joinSql(filter.of.map(node), filter.kind === "all" ? " AND " : " OR ")})`;
  };
  const predicates = [view.filter ? node(view.filter) : TRUE];
  if (view.search) {
    const searchable = columns.filter((col) => col.searchable);
    predicates.push(
      searchable.length
        ? sql`(${joinSql(
            searchable.map((col) =>
              dialect.contains(ref(col, "filter"), view.search),
            ),
            " OR ",
          )})`
        : FALSE,
    );
  }
  const order = view.sort.map((rule) => {
    const col = column(rule.field);
    let expression = ref(col, "sort");
    let nullable = col.sqlNullable !== false;
    if (
      col.type.filterType === "enum" &&
      col.filterOptions &&
      !col.dynamicOptions
    ) {
      nullable = true;
      // Inline ranks: untyped bound params would make Postgres compare them as text.
      const cases = col.filterOptions.map(
        (option, index) =>
          sql`WHEN ${dialect.asText(expression)} = ${option.value} THEN ${syntax(String(index))}`,
      );
      expression = cases.length
        ? sql`CASE ${joinSql(cases, " ")} ELSE NULL END`
        : syntax("0 + 0");
    }
    return sql`${expression} ${syntax(rule.dir.toUpperCase())}${syntax(nullable ? " NULLS LAST" : "")}`;
  });
  order.push(sql`${references.rowKey} ASC NULLS LAST`);
  return {
    where: sql`(${joinSql(predicates, " AND ")})`,
    orderBy: order,
  };
}
