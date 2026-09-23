// Schema-driven filter engine over typed `SchemaColumn<TData>`.
//
// A filter is a tree of `FilterNode`s: `where` leaves that test one column, and
// `all` / `any` branches that combine them. The names mean what they say at
// every depth, so reading a stored filter never needs a lookup table of which
// array pairs with which operator list.
//
// Condition values are stored as strings — a date range packs as "from|to", a
// multi-select enum comma-joins its values. The wire format is stable and
// readable, so a persisted view stays diffable and a human can fix one by hand.
//
// The whole of a grid's state (search, filter, sort, group) lives in `GridView`
// — see `./grid-view`.

import type { RowData } from "@tanstack/react-table";
import type { SchemaColumn } from "./column-schema";
import type { FilterOp } from "./column-vocabulary";
import { FILTER_OP } from "./column-vocabulary";
import { toYmd } from "./date-grouping";
import type { GridView } from "./grid-view";

/** Tests one column against one value. */
export interface FilterCondition {
  kind: "where";
  field: string;
  op: FilterOp;
  value: string;
}

/** Every child must match. */
export interface FilterAll {
  kind: "all";
  of: FilterNode[];
}

/** At least one child must match. */
export interface FilterAny {
  kind: "any";
  of: FilterNode[];
}

export type FilterNode = FilterCondition | FilterAll | FilterAny;

// ── Builders ───────────────────────────────────────────────────────────────
//
// Filters read like the sentence they represent:
//
//   const { is, lte } = FILTER_OP;
//
//   all(
//     where("price", lte, "25000"),
//     any(where("fuel", is, "diesel"), where("fuel", is, "hybrid")),
//   )
//
// The operator a condition stores is still the symbol - "≤" and FILTER_OP.lte
// are the same value - so a persisted filter stays readable to a human while
// writing one never means hunting for a glyph.

export function where(
  field: string,
  op: FilterOp,
  value = "",
): FilterCondition {
  return { kind: "where", field, op, value };
}

export function all(...of: FilterNode[]): FilterAll {
  return { kind: "all", of };
}

export function any(...of: FilterNode[]): FilterAny {
  return { kind: "any", of };
}

/** Number of `where` leaves — what a "3 filters active" badge counts. */
export function countConditions(node: FilterNode | null): number {
  if (node === null) return 0;
  if (node.kind === "where") return 1;
  let total = 0;
  for (const child of node.of) total += countConditions(child);
  return total;
}

/**
 * Rebuild a filter keeping only the conditions that satisfy `keep`.
 *
 * Returns `null` when nothing survives, and unwraps a branch left holding a
 * single child (`any(a)` and `a` select the same rows, so the wrapper is noise).
 * Because each branch stores its own children, dropping one can no longer
 * misalign an operator with the wrong group — the failure this function used to
 * exist to prevent.
 */
export function projectFilter(
  node: FilterNode | null,
  keep: (condition: FilterCondition) => boolean,
): FilterNode | null {
  if (node === null) return null;
  if (node.kind === "where") return keep(node) ? node : null;

  const of: FilterNode[] = [];
  for (const child of node.of) {
    const kept = projectFilter(child, keep);
    if (kept !== null) of.push(kept);
  }
  if (of.length === 0) return null;
  if (of.length === 1) return of[0];
  return { kind: node.kind, of };
}

// Operators that test presence/absence of a value; they are the only ones that
// must NOT short-circuit on an empty row value. Useful to a filter-builder UI
// deciding whether to render a value input at all.
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

// ── Compilation ────────────────────────────────────────────────────────────
//
// A condition's *value* is fixed for the whole scan; only the row changes. So
// every `Number.parseFloat(value)`, `value.toLowerCase()`, `value.split(",")`
// and column lookup is hoisted into a closure built once per `compileView`, and
// the row loop calls a plain predicate. Evaluating in place instead re-derived
// those constants once per row - 50,000 times over a 50,000-row grid - and
// allocated an array of term results per row before reducing it.
//
// Compiling also buys short-circuiting: an `all` whose first child rejects a
// row never evaluates the rest.

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
  [FILTER_OP.eq]: (n, fv) => n === fv,
  [FILTER_OP.ne]: (n, fv) => n !== fv,
  [FILTER_OP.gt]: (n, fv) => n > fv,
  [FILTER_OP.lt]: (n, fv) => n < fv,
  [FILTER_OP.gte]: (n, fv) => n >= fv,
  [FILTER_OP.lte]: (n, fv) => n <= fv,
};

function compileNumeric<TData extends RowData>(
  read: (row: TData) => unknown,
  col: SchemaColumn<TData>,
  op: FilterOp,
  value: string,
): RowPredicate<TData> {
  let fv = Number.parseFloat(value);
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
  value: string,
): RowPredicate<TData> {
  if (op === "between") {
    const [from, to] = value.split("|");
    if (!from && !to) return ALWAYS_TRUE; // no bounds set yet → don't filter
    return (row) => {
      const ymd = toYmd(read(row));
      if (ymd === "") return false;
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      return true;
    };
  }
  if (!value) return ALWAYS_TRUE; // no value picked yet → don't filter
  switch (op) {
    case "on":
      return (row) => toYmd(read(row)) === value;
    case "before": {
      return (row) => {
        const ymd = toYmd(read(row));
        return ymd !== "" && ymd < value;
      };
    }
    case "after": {
      return (row) => {
        const ymd = toYmd(read(row));
        return ymd !== "" && ymd > value;
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
  value: string,
): RowPredicate<TData> {
  const wanted = new Set(splitLower(value));
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
  const { op, value } = condition;

  // ── Empty / not-empty (checked before every type branch) ──
  // A row value counts as empty when it is null/undefined, a blank string, or
  // NaN. The generic empty-row exclusion is applied lower down, only to the
  // scalar text / enum branches - date, numeric, and set-valued enum each
  // handle empties themselves, so a blanket short-circuit here would wrongly
  // drop e.g. empty-set rows that legitimately satisfy "is not".
  if (op === "is empty") return (row) => isRowValueEmpty(read(row));
  if (op === "is not empty") return (row) => !isRowValueEmpty(read(row));

  const filterType = col.type.filterType;
  if (filterType === "date") return compileDate(read, op, value);
  if (filterType === "numeric") return compileNumeric(read, col, op, value);
  if (filterType === "enum" && col.type.setValued) {
    return compileSetValued(read, op, value);
  }

  // ── Empty-row exclusion for scalar comparisons ──
  // The remaining branches compare a single concrete value; an empty row value
  // is excluded so it can't slip past "is not" / "contains" (the "no value
  // matches every filter" bug). An unset filter value stays a no-op.
  const emptyMatches = value.trim() === "";

  // ── Multi-select enum (comma-joined values) ──
  if (
    col.multiSelect &&
    (op === "is" || op === "is not") &&
    value.includes(",")
  ) {
    const wanted = new Set(splitLower(value));
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
  const fvl = value.toLowerCase();
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

/**
 * Compile one node into a row predicate, recursing through the branches.
 *
 * A branch with no children matches everything, whichever kind it is. That is
 * the same rule as an unset condition value: a filter row the user has started
 * but not finished narrows nothing, rather than emptying the grid under them.
 */
function compileNode<TData extends RowData>(
  node: FilterNode,
  colMap: ColumnMap<TData>,
): RowPredicate<TData> {
  if (node.kind === "where") return compileCondition(node, colMap);
  if (node.of.length === 0) return ALWAYS_TRUE;
  const children = node.of.map((child) => compileNode(child, colMap));
  return node.kind === "all" ? everyOf(children) : someOf(children);
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
 * Compile a view's row-narrowing half — `search` and `filter` — into a single
 * predicate. `sort` and `group` reorder rows rather than remove them, so they
 * play no part here.
 *
 * Exported because the predicate is the useful primitive: it streams, it works
 * a row at a time on a server, and it costs nothing per row beyond the tests
 * the view actually asks for. `applyView` is the array-shaped convenience.
 */
export function compileView<TData extends RowData>(
  view: GridView,
  columns: readonly SchemaColumn<TData>[],
): RowPredicate<TData> {
  const colMap = buildColumnMap(columns);
  const body =
    view.filter === null
      ? (ALWAYS_TRUE as RowPredicate<TData>)
      : compileNode(view.filter, colMap);

  // Search is always an AND-gate over the filter, never a term inside it: a
  // query narrows what the filter selected, whatever boolean shape it has.
  const search = compileSearch(view.search, columns, colMap);
  if (!search) return body;
  return (row) => search(row) && body(row);
}

/** Every row a view's search and filter select, in the order given. */
export function applyView<TData extends RowData>(
  data: readonly TData[],
  view: GridView,
  columns: readonly SchemaColumn<TData>[],
): TData[] {
  if (view.search === "" && view.filter === null) return data.slice();
  const matches = compileView(view, columns);
  const out: TData[] = [];
  for (const row of data) {
    if (matches(row)) out.push(row);
  }
  return out;
}
