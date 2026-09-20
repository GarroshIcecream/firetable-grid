// Schema-driven filter engine over typed `SchemaColumn<TData>`. State shape is a flat AST:
//   - `and` conditions must all match (AND)
//   - each `orGroups[i]` must have at least one match (AND across groups, OR within)
//   - `search` matches against columns flagged `searchable`
// Values are stored as strings; multi-select enums serialize as comma-joined
// values. The wire format is stable, so a persisted view stays readable.

import type { RowData } from "@tanstack/react-table";
import type { SchemaColumn } from "./column-schema";
import type { FilterOp } from "./column-vocabulary";
import { toYmd } from "./date-grouping";

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

/**
 * The no-filter AST, deeply frozen.
 *
 * `Object.freeze` alone would leave `and` and `orGroups` writable, and the
 * usual way to reach a new AST - `{ ...EMPTY_FILTER_AST, search: "estate" }` -
 * copies those array *references* rather than their contents. A single
 * `ast.and.push(condition)` downstream would then append to this module-level
 * constant, which every other spread is also sharing: the filter leaks into
 * unrelated views and, on a server, across requests and tenants.
 *
 * Frozen, that push throws at the call site instead (module code is strict).
 * Use `emptyFilterAST()` when you want an AST you can mutate in place, or keep
 * spreading and supply your own arrays for the keys you are changing.
 */
export const EMPTY_FILTER_AST: FilterAST = Object.freeze({
  search: "",
  and: Object.freeze([]) as unknown as FilterCondition[],
  orGroups: Object.freeze([]) as unknown as FilterCondition[][],
}) as FilterAST;

/** A fresh, fully mutable no-filter AST. Prefer this over spreading
 *  `EMPTY_FILTER_AST` anywhere the result is built up by mutation. */
export function emptyFilterAST(): FilterAST {
  return { search: "", and: [], orGroups: [] };
}

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

// ── Compilation ────────────────────────────────────────────────────────────
//
// A condition's *value* is fixed for the whole scan; only the row changes. So
// every `Number.parseFloat(val)`, `val.toLowerCase()`, `val.split(",")` and
// column lookup is hoisted into a closure built once per `applyAST`, and the
// row loop calls a plain predicate. Evaluating in place instead re-derived
// those constants once per row - 50,000 times over a 50,000-row grid - and
// allocated an array of term results per row before reducing it.
//
// Compiling also buys short-circuiting: an AND whose first term rejects a row
// never evaluates the rest, which the old `terms.every(Boolean)` could not do
// because every term was computed before the reduce ran.

type RowPredicate<TData> = (row: TData) => boolean;

const ALWAYS_TRUE: RowPredicate<unknown> = () => true;

/** Reads a column's filter value off a row. `getFilterValue` is invoked as a
 *  method so a resolver written with `this` behaves as it did when called
 *  inline. */
function accessorFor<TData extends RowData>(
  col: SchemaColumn<TData>,
): (row: TData) => unknown {
  if (col.getFilterValue) return (row) => col.getFilterValue?.(row);
  const key = col.accessorKey ?? col.id;
  return (row) => (row as Record<string, unknown>)[key];
}

function isRowValueEmpty(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === "string") return raw.trim() === "";
  if (typeof raw === "number") return Number.isNaN(raw);
  return false;
}

/** Comma-separated filter value → lowercased, trimmed, blank-free tokens.
 *  Compile-time only, so clarity beats allocation here. */
function splitLower(value: string): string[] {
  return value
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/** Does any comma-separated token of `text` appear in `wanted`? Walks the
 *  string in place rather than materializing a token array per row, and stops
 *  at the first hit. */
function anyTokenIn(text: string, wanted: ReadonlySet<string>): boolean {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf(",", start);
    if (end === -1) end = text.length;
    const token = text.slice(start, end).trim().toLowerCase();
    if (token !== "" && wanted.has(token)) return true;
    start = end + 1;
  }
  return false;
}

function toNumber(raw: unknown): number {
  return typeof raw === "number" ? raw : Number.parseFloat(String(raw));
}

const NUMERIC_COMPARATORS: Partial<
  Record<FilterOp, (n: number, fv: number) => boolean>
> = {
  "=": (n, fv) => n === fv,
  "≠": (n, fv) => n !== fv,
  ">": (n, fv) => n > fv,
  "<": (n, fv) => n < fv,
  "≥": (n, fv) => n >= fv,
  "≤": (n, fv) => n <= fv,
};

function compileNumeric<TData extends RowData>(
  read: (row: TData) => unknown,
  col: SchemaColumn<TData>,
  op: FilterOp,
  val: string,
): RowPredicate<TData> {
  let fv = Number.parseFloat(val);
  // Percentage-point entry: ratio columns store 0..1 fractions but the user
  // types points (50 → 50%). Scale the typed value into the stored unit.
  if (col.type.ratioStored) fv /= 100;
  if (Number.isNaN(fv)) return ALWAYS_TRUE; // filter value not set yet
  const compare = NUMERIC_COMPARATORS[op];
  // An operator this column does not define compares nothing - but the row
  // value still has to BE numeric, so a non-numeric row stays excluded rather
  // than passing a filter that never applied to it.
  if (!compare) return (row) => !Number.isNaN(toNumber(read(row)));
  return (row) => {
    const n = toNumber(read(row));
    if (Number.isNaN(n)) return false; // non-numeric row value → excluded
    return compare(n, fv);
  };
}

// Date comparison on YYYY-MM-DD strings (ISO dates sort lexically, so plain
// string compare is chronological). A row with no comparable date never
// matches an active date condition. `between` carries "from|to"; either side
// may be empty for an open-ended range.
//
// `toYmd` returns either "" or a well-formed YYYY-MM-DD, so testing against ""
// is the same gate the old `isYmd(ymd)` call was.
function compileDate<TData extends RowData>(
  read: (row: TData) => unknown,
  op: FilterOp,
  val: string,
): RowPredicate<TData> {
  if (op === "between") {
    const [from, to] = val.split("|");
    if (!from && !to) return ALWAYS_TRUE; // no bounds set yet → don't filter
    return (row) => {
      const ymd = toYmd(read(row));
      if (ymd === "") return false;
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      return true;
    };
  }
  if (!val) return ALWAYS_TRUE; // no value picked yet → don't filter
  switch (op) {
    case "on":
      return (row) => toYmd(read(row)) === val;
    case "before": {
      return (row) => {
        const ymd = toYmd(read(row));
        return ymd !== "" && ymd < val;
      };
    }
    case "after": {
      return (row) => {
        const ymd = toYmd(read(row));
        return ymd !== "" && ymd > val;
      };
    }
    default:
      // An operator a date column does not define: every parsable day passes,
      // an unparsable one still does not.
      return (row) => toYmd(read(row)) !== "";
  }
}

// Set-valued enum: the row holds MULTIPLE values, comma-joined (e.g. a row may
// be {reducePrice, addPhotos}). Match is "does the row's set intersect the
// selected set?" - scalar enum equality would never match a multi-value row.
function compileSetValued<TData extends RowData>(
  read: (row: TData) => unknown,
  op: FilterOp,
  val: string,
): RowPredicate<TData> {
  const wanted = new Set(splitLower(val));
  if (wanted.size === 0) return ALWAYS_TRUE;
  const negate = op === "is not";
  return (row) => {
    const raw = read(row);
    const hitsAny = raw == null ? false : anyTokenIn(String(raw), wanted);
    return hitsAny !== negate;
  };
}

function compileCondition<TData extends RowData>(
  condition: FilterCondition,
  colMap: ColumnMap<TData>,
): RowPredicate<TData> {
  const col = colMap.get(condition.field);
  if (!col) return ALWAYS_TRUE; // unknown column → skip rather than exclude

  const read = accessorFor(col);
  const { op, val } = condition;

  // ── Empty / not-empty (checked before every type branch) ──
  // A row value counts as empty when it is null/undefined, a blank string, or
  // NaN. The generic empty-row exclusion is applied lower down, only to the
  // scalar text / enum branches - date, numeric, and set-valued enum each
  // handle empties themselves, so a blanket short-circuit here would wrongly
  // drop e.g. empty-set rows that legitimately satisfy "is not".
  if (op === "is empty") return (row) => isRowValueEmpty(read(row));
  if (op === "is not empty") return (row) => !isRowValueEmpty(read(row));

  const filterType = col.type.filterType;
  if (filterType === "date") return compileDate(read, op, val);
  if (filterType === "numeric") return compileNumeric(read, col, op, val);
  if (filterType === "enum" && col.type.setValued) {
    return compileSetValued(read, op, val);
  }

  // ── Empty-row exclusion for scalar comparisons ──
  // The remaining branches compare a single concrete value; an empty row value
  // is excluded so it can't slip past "is not" / "contains" (the "no value
  // matches every filter" bug). An unset filter value stays a no-op.
  const emptyMatches = val.trim() === "";

  // ── Multi-select enum (comma-joined values) ──
  if (
    col.multiSelect &&
    (op === "is" || op === "is not") &&
    val.includes(",")
  ) {
    const wanted = new Set(splitLower(val));
    // A value of nothing but separators ("," / " , ") selects nothing, so it
    // filters nothing - but an empty row is still judged by the exclusion
    // above rather than waved through.
    if (wanted.size === 0) {
      return (row) => (isRowValueEmpty(read(row)) ? emptyMatches : true);
    }
    const negate = op === "is not";
    return (row) => {
      const raw = read(row);
      if (isRowValueEmpty(raw)) return emptyMatches;
      return wanted.has(String(raw).toLowerCase()) !== negate;
    };
  }

  // ── Text / single-enum ──
  const fvl = val.toLowerCase();
  switch (op) {
    case "is":
      return (row) => {
        const raw = read(row);
        if (isRowValueEmpty(raw)) return emptyMatches;
        return String(raw).toLowerCase() === fvl;
      };
    case "is not":
      return (row) => {
        const raw = read(row);
        if (isRowValueEmpty(raw)) return emptyMatches;
        return String(raw).toLowerCase() !== fvl;
      };
    case "contains":
      return (row) => {
        const raw = read(row);
        if (isRowValueEmpty(raw)) return emptyMatches;
        return String(raw).toLowerCase().includes(fvl);
      };
    default:
      // An operator this column does not define matches every non-empty row.
      return (row) => (isRowValueEmpty(read(row)) ? emptyMatches : true);
  }
}

function everyOf<TData>(
  preds: readonly RowPredicate<TData>[],
): RowPredicate<TData> {
  if (preds.length === 1) return preds[0];
  return (row) => {
    for (const pred of preds) if (!pred(row)) return false;
    return true;
  };
}

function someOf<TData>(
  preds: readonly RowPredicate<TData>[],
): RowPredicate<TData> {
  if (preds.length === 1) return preds[0];
  return (row) => {
    for (const pred of preds) if (pred(row)) return true;
    return false;
  };
}

/** Escapes the characters a regex treats specially, so a query like "3.5 (new)"
 *  searches for that literal text instead of compiling into a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Free-text search across the columns flagged `searchable`. Columns resolve
 * through `colMap` (not the schema list) so a duplicated id reads the same
 * column the conditions do.
 *
 * Matching runs through a case-insensitive regex rather than
 * `value.toLowerCase().includes(query)`: the latter allocates a lowercased
 * copy of every searchable cell on every row - 150,000 throwaway strings to
 * search three columns of a 50,000-row grid - where the regex engine folds
 * case as it scans. The query is escaped, so the pattern is still a literal
 * substring search.
 */
function compileSearch<TData extends RowData>(
  query: string,
  columns: readonly SchemaColumn<TData>[],
  colMap: ColumnMap<TData>,
): RowPredicate<TData> | null {
  if (!query) return null;
  // No `g` flag: `test` on a global regex advances `lastIndex` between calls,
  // which would make the same row match or miss depending on the row before it.
  const matcher = new RegExp(escapeRegExp(query), "i");
  const readers: Array<(row: TData) => unknown> = [];
  for (const column of columns) {
    if (!column.searchable) continue;
    const resolved = colMap.get(column.id);
    if (resolved) readers.push(accessorFor(resolved));
  }
  // A search with nothing to search against matches nothing.
  if (readers.length === 0) return () => false;
  return (row) => {
    for (const read of readers) {
      const v = read(row);
      if (v == null) continue;
      if (matcher.test(typeof v === "string" ? v : String(v))) return true;
    }
    return false;
  };
}

/**
 * Compile an AST into a single row predicate.
 *
 * Each `and` condition and each non-empty group is a top-level term; terms are
 * combined with `andOp` (default "and" for legacy views). A group is reduced
 * with its own inner op (default "or"). Free-text search is always an AND-gate,
 * independent of the top-level op.
 */
function compileAST<TData extends RowData>(
  ast: FilterAST,
  columns: readonly SchemaColumn<TData>[],
): RowPredicate<TData> {
  const colMap = buildColumnMap(columns);

  const terms: Array<RowPredicate<TData>> = [];
  for (const condition of ast.and) {
    terms.push(compileCondition(condition, colMap));
  }
  ast.orGroups.forEach((group, gi) => {
    if (group.length === 0) return;
    const inner = group.map((c) => compileCondition(c, colMap));
    const groupOp = ast.groupOps?.[gi] ?? "or";
    terms.push(groupOp === "and" ? everyOf(inner) : someOf(inner));
  });

  const body =
    terms.length === 0
      ? (ALWAYS_TRUE as RowPredicate<TData>)
      : (ast.andOp ?? "and") === "and"
        ? everyOf(terms)
        : someOf(terms);

  const search = compileSearch(ast.search, columns, colMap);
  if (!search) return body;
  return (row) => search(row) && body(row);
}

export function applyAST<TData extends RowData>(
  data: readonly TData[],
  ast: FilterAST,
  columns: readonly SchemaColumn<TData>[],
): TData[] {
  if (isFilterASTEmpty(ast)) return data.slice();
  const matches = compileAST(ast, columns);
  const out: TData[] = [];
  for (const row of data) {
    if (matches(row)) out.push(row);
  }
  return out;
}
