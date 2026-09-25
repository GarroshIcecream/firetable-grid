import type { FilterNode } from "../filter-engine";
import type { SortRule } from "../grid-view";
import { GridConfigError, GridRequestError } from "./errors";
import type { GridPage, GridRequest, GridResult, SqlGridColumn } from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (path: string, message: string): never => {
  throw new GridRequestError([{ path, message }]);
};
const text = (value: unknown, path: string, max = 10000): string => {
  if (typeof value !== "string" || value.length > max)
    return fail(path, `Expected a string of at most ${max} characters`);
  return value;
};

export function columnMap<TRow extends object>(
  columns: readonly SqlGridColumn<TRow>[],
): Map<string, SqlGridColumn<TRow>> {
  const map = new Map<string, SqlGridColumn<TRow>>();
  for (const column of columns) {
    if (!column.id || map.has(column.id))
      throw new GridConfigError(`Duplicate or empty column id: "${column.id}"`);
    map.set(column.id, column);
  }
  return map;
}

function validDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function parseGridRequest<TRow extends object>(
  body: unknown,
  columns: readonly SqlGridColumn<TRow>[],
  { maxLimit = 1000 }: { maxLimit?: number } = {},
): GridRequest {
  if (!Number.isSafeInteger(maxLimit) || maxLimit < 1)
    throw new GridConfigError("maxLimit must be a positive safe integer");
  const map = columnMap(columns);
  if (!record(body) || !record(body.view) || !record(body.page))
    return fail("request", "Expected view and page objects");
  const { limit, offset } = body.page;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maxLimit
  )
    return fail("page.limit", `Expected an integer in 1..${maxLimit}`);
  if (
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(offset + limit)
  )
    return fail("page.offset", "Expected a non-negative safe offset");
  const view = body.view;
  const search = text(view.search, "view.search", 1000);
  if (view.group !== null)
    return fail(
      "view.group",
      "Server grouping is not supported yet; set group to null",
    );
  let nodes = 0;
  const parseNode = (
    node: unknown,
    path: string,
    depth: number,
  ): FilterNode => {
    if (++nodes > 200 || depth > 20)
      return fail(path, "Filter exceeds 200 nodes or 20 levels");
    if (!record(node)) return fail(path, "Expected a filter object");
    if (node.kind === "all" || node.kind === "any") {
      if (!Array.isArray(node.of) || node.of.length > 200)
        return fail(`${path}.of`, "Expected at most 200 child filters");
      return {
        kind: node.kind,
        of: node.of.map((child, i) =>
          parseNode(child, `${path}.of.${i}`, depth + 1),
        ),
      };
    }
    if (node.kind !== "where")
      return fail(`${path}.kind`, "Expected where, all or any");
    const field = text(node.field, `${path}.field`);
    const column = map.get(field);
    if (!column?.filterable)
      return fail(`${path}.field`, `Column "${field}" is not filterable`);
    const op = column.operators.find((allowed) => allowed === node.op);
    if (!op)
      return fail(`${path}.op`, `Operator is not allowed for "${field}"`);
    const value = text(node.value, `${path}.value`);
    if (op !== "is empty" && op !== "is not empty") {
      if (
        column.type.filterType === "numeric" &&
        value.trim() !== "" &&
        (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ||
          !Number.isFinite(Number(value)))
      ) {
        return fail(`${path}.value`, "Expected a finite numeric value");
      }
      if (column.type.filterType === "date" && value !== "") {
        const bounds = op === "between" ? value.split("|") : [value];
        if (
          (op === "between" && bounds.length !== 2) ||
          bounds.some((bound) => bound !== "" && !validDay(bound))
        )
          return fail(`${path}.value`, "Expected YYYY-MM-DD or from|to dates");
        if (
          bounds.length === 2 &&
          bounds[0] &&
          bounds[1] &&
          bounds[0] > bounds[1]
        )
          return fail(`${path}.value`, "Date range starts after it ends");
      }
    }
    return { kind: "where", field, op, value };
  };
  const filter =
    view.filter === null ? null : parseNode(view.filter, "view.filter", 0);
  if (!Array.isArray(view.sort) || view.sort.length > 32)
    return fail("view.sort", "Expected at most 32 sort rules");
  const seen = new Set<string>();
  const sort: SortRule[] = view.sort.map((rule, index) => {
    const path = `view.sort.${index}`;
    if (!record(rule)) return fail(path, "Expected a sort object");
    const field = text(rule.field, `${path}.field`);
    if (!map.get(field)?.sortable || seen.has(field))
      return fail(
        `${path}.field`,
        `Unknown, unsortable or duplicate field "${field}"`,
      );
    if (rule.dir !== "asc" && rule.dir !== "desc")
      return fail(`${path}.dir`, "Expected asc or desc");
    seen.add(field);
    return { field, dir: rule.dir };
  });
  return {
    view: { search, filter, sort, group: null },
    page: { limit, offset },
  };
}

export function nextGridPage(last: GridResult<unknown>): GridPage | undefined {
  const { limit, offset } = last.page;
  const next = offset + limit;
  if (
    !last.rows.length ||
    last.rows.length < limit ||
    (last.total !== undefined && next >= last.total)
  )
    return undefined;
  if (!Number.isSafeInteger(next) || limit < 1) return undefined;
  return { limit, offset: next };
}
