// Schema-driven filter engine over typed `SchemaColumn<TData>`. State shape is a flat AST:
//   - `and` conditions must all match (AND)
//   - each `orGroups[i]` must have at least one match (AND across groups, OR within)
//   - `search` matches against columns flagged `searchable`
// Values are stored as strings; multi-select enums serialize as comma-joined
// values. The wire format is stable, so a persisted view stays readable.

import type { RowData } from "@tanstack/react-table";
import type { SchemaColumn } from "./column-schema";
import type { FilterOp } from "./column-vocabulary";
import { isYmd, toYmd } from "./date-grouping";

export type LogicalOp = "and" | "or";

export interface FilterCondition {
  field: string;
  op: FilterOp;
  val: string;
}

export interface FilterAST {
  search: string;
  and: FilterCondition[];
  orGroups: FilterCondition[][];
  // How the top-level terms (each `and` condition + each `orGroups` group) are
  // combined. Optional for backward compatibility with saved views written
  // before per-boundary operators existed — absent means "and" (legacy).
  andOp?: LogicalOp;
  // Inner operator for each `orGroups[i]`, index-aligned. Absent entry means
  // "or" (legacy: groups were OR-within).
  groupOps?: LogicalOp[];
}

export const EMPTY_FILTER_AST: FilterAST = Object.freeze({
  search: "",
  and: [],
  orGroups: [],
}) as FilterAST;

/**
 * Rebuild an AST keeping only the conditions that satisfy `keep`.
 *
 * Use this instead of hand-writing a `{ search, and, orGroups }` literal:
 * that shape silently drops `andOp` / `groupOps`, which turns a user's OR
 * filter into an AND one. Groups that lose every condition are dropped and
 * `groupOps` is reindexed with them - the two arrays are index-aligned, so
 * filtering groups alone rewires which operator applies to which group.
 */
export function projectFilterAST(
  ast: FilterAST,
  keep: (condition: FilterCondition) => boolean,
): FilterAST {
  const orGroups: FilterCondition[][] = [];
  const groupOps: LogicalOp[] = [];
  ast.orGroups.forEach((group, i) => {
    const kept = group.filter(keep);
    if (kept.length === 0) return;
    orGroups.push(kept);
    groupOps.push(ast.groupOps?.[i] ?? "or");
  });
  return {
    search: ast.search,
    and: ast.and.filter(keep),
    orGroups,
    ...(ast.andOp === undefined ? {} : { andOp: ast.andOp }),
    ...(ast.groupOps === undefined ? {} : { groupOps }),
  };
}

// Operators that test presence/absence of a value; they are the only ones that
// must NOT short-circuit on an empty row value.
export function isEmptyOp(op: FilterOp): boolean {
  return op === "is empty" || op === "is not empty";
}

type ColumnMap<TData extends RowData> = ReadonlyMap<
  string,
  SchemaColumn<TData>
>;

function buildColumnMap<TData extends RowData>(
  columns: readonly SchemaColumn<TData>[],
): ColumnMap<TData> {
  return new Map(columns.map((c) => [c.id, c]));
}

export function isFilterASTEmpty(ast: FilterAST): boolean {
  return (
    ast.search.length === 0 &&
    ast.and.length === 0 &&
    ast.orGroups.every((g) => g.length === 0)
  );
}

export function countFilters(ast: FilterAST): number {
  return (
    ast.and.length +
    ast.orGroups.reduce((n, g) => n + (g.length > 0 ? 1 : 0), 0)
  );
}

function resolveFilterValue<TData extends RowData>(
  row: TData,
  col: SchemaColumn<TData> | undefined,
): unknown {
  if (!col) return undefined;
  if (col.getFilterValue) return col.getFilterValue(row);
  const key = col.accessorKey ?? col.id;
  return (row as Record<string, unknown>)[key];
}

function isRowValueEmpty(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === "string") return raw.trim() === "";
  if (typeof raw === "number") return Number.isNaN(raw);
  return false;
}

function matchCondition<TData extends RowData>(
  row: TData,
  condition: FilterCondition,
  colMap: ColumnMap<TData>,
): boolean {
  const col = colMap.get(condition.field);
  if (!col) return true; // unknown column → skip rather than exclude the row

  const raw = resolveFilterValue(row, col);
  const val = condition.val;
  const filterType = col.type.filterType;

  // ── Empty / not-empty (checked before every type branch) ──
  // A row value counts as empty when it is null/undefined, a blank string, or
  // NaN. The generic empty-row exclusion is applied lower down, only to the
  // scalar text / enum branches — date, numeric, and set-valued enum each
  // handle empties themselves (see below), so a blanket short-circuit here
  // would wrongly drop e.g. empty-set rows that legitimately satisfy "is not".
  const rowEmpty = isRowValueEmpty(raw);
  if (condition.op === "is empty") return rowEmpty;
  if (condition.op === "is not empty") return !rowEmpty;

  // ── Date (compares on the YYYY-MM-DD prefix) ──
  if (filterType === "date") {
    return matchDate(toYmd(raw), condition.op, val);
  }

  // ── Numeric ──
  if (filterType === "numeric") {
    const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    let fv = Number.parseFloat(val);
    // Percentage-point entry: ratio columns store 0..1 fractions but the user
    // types points (50 → 50%). Scale the typed value into the stored unit.
    if (col.type.ratioStored) fv /= 100;
    if (Number.isNaN(fv)) return true; // filter value not set yet → don't filter
    if (Number.isNaN(n)) return false; // non-numeric row value → excluded
    switch (condition.op) {
      case "=":
        return n === fv;
      case "≠":
        return n !== fv;
      case ">":
        return n > fv;
      case "<":
        return n < fv;
      case "≥":
        return n >= fv;
      case "≤":
        return n <= fv;
      default:
        return true;
    }
  }

  // ── Set-valued enum (row holds MULTIPLE values, comma-joined) ──
  // e.g. Recommended Actions: a row may be {reducePrice, addPhotos}. Match is
  // "does the row's set intersect the selected set?" — scalar enum equality
  // (below) would never match a multi-value row.
  if (filterType === "enum" && col.type.setValued) {
    const parse = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
    const wanted = parse(val);
    if (wanted.length === 0) return true;
    const rowVals = parse(raw == null ? "" : String(raw));
    const hitsAny = wanted.some((w) => rowVals.includes(w));
    return condition.op === "is not" ? !hitsAny : hitsAny;
  }

  // ── Empty-row exclusion for scalar comparisons ──
  // The remaining branches compare a single concrete value; an empty row value
  // is excluded so it can't slip past "is not" / "contains" (the "no value
  // matches every filter" bug). An unset filter value stays a no-op.
  if (rowEmpty) return val.trim() === "";

  // ── Multi-select enum (comma-joined values) ──
  if (
    col.multiSelect &&
    (condition.op === "is" || condition.op === "is not") &&
    val.includes(",")
  ) {
    const vals = val
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (vals.length === 0) return true;
    const s = raw == null ? "" : String(raw).toLowerCase();
    return condition.op === "is" ? vals.includes(s) : !vals.includes(s);
  }

  // ── Text / single-enum ──
  const s = raw == null ? "" : String(raw).toLowerCase();
  const fvl = val.toLowerCase();
  switch (condition.op) {
    case "is":
      return s === fvl;
    case "is not":
      return s !== fvl;
    case "contains":
      return s.includes(fvl);
    default:
      return true;
  }
}

// Date comparison on YYYY-MM-DD strings (ISO dates sort lexically, so plain
// string compare is chronological). A row with no comparable date never matches
// an active date condition. `between` carries "from|to"; either side may be
// empty for an open-ended range.
function matchDate(ymd: string, op: FilterOp, val: string): boolean {
  if (op === "between") {
    const [from, to] = val.split("|");
    if (!from && !to) return true; // no bounds set yet → don't filter
    if (!isYmd(ymd)) return false;
    if (from && ymd < from) return false;
    if (to && ymd > to) return false;
    return true;
  }
  if (!val) return true; // no value picked yet → don't filter
  if (!isYmd(ymd)) return false;
  switch (op) {
    case "on":
      return ymd === val;
    case "before":
      return ymd < val;
    case "after":
      return ymd > val;
    default:
      return true;
  }
}

function matchSearch<TData extends RowData>(
  row: TData,
  query: string,
  searchFields: readonly string[],
  colMap: ColumnMap<TData>,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  for (const id of searchFields) {
    const col = colMap.get(id);
    if (!col) continue;
    const v = resolveFilterValue(row, col);
    if (v == null) continue;
    if (String(v).toLowerCase().includes(q)) return true;
  }
  return false;
}

function evaluateAST<TData extends RowData>(
  row: TData,
  ast: FilterAST,
  colMap: ColumnMap<TData>,
  searchFields: readonly string[],
): boolean {
  // Free-text search is always an AND-gate, independent of the top-level op.
  if (ast.search && !matchSearch(row, ast.search, searchFields, colMap)) {
    return false;
  }

  // Each `and` condition and each non-empty group is a top-level term; terms
  // are combined with `andOp` (default "and" for legacy views). A group is
  // reduced with its own inner op (default "or").
  const terms: boolean[] = [];
  for (const c of ast.and) {
    terms.push(matchCondition(row, c, colMap));
  }
  ast.orGroups.forEach((group, gi) => {
    if (group.length === 0) return;
    const groupOp = ast.groupOps?.[gi] ?? "or";
    const matched =
      groupOp === "and"
        ? group.every((c) => matchCondition(row, c, colMap))
        : group.some((c) => matchCondition(row, c, colMap));
    terms.push(matched);
  });

  if (terms.length === 0) return true;
  return (ast.andOp ?? "and") === "and"
    ? terms.every(Boolean)
    : terms.some(Boolean);
}

export function applyAST<TData extends RowData>(
  data: readonly TData[],
  ast: FilterAST,
  columns: readonly SchemaColumn<TData>[],
): TData[] {
  if (isFilterASTEmpty(ast)) return data.slice();
  const colMap = buildColumnMap(columns);
  const searchFields = columns.filter((c) => c.searchable).map((c) => c.id);
  const out: TData[] = [];
  for (const row of data) {
    if (evaluateAST(row, ast, colMap, searchFields)) out.push(row);
  }
  return out;
}
