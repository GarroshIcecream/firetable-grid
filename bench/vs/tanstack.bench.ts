// firetable-grid's filter engine vs TanStack Table's own column filtering.
//
// WHAT THIS CAN AND CANNOT COMPARE
//
// Only the overlapping subset is measurable: a FLAT AND of per-column
// conditions. TanStack's `columnFilters` state is `{id, value}[]`, one entry
// per column, implicitly ANDed - `all(a, any(b, c))` has no representation in
// it, so the engine's boolean tree is not something TanStack is slower at, it
// is something TanStack does not have. Nothing here scores that difference.
// This file answers the narrower question the flat case does decide: what does
// the row model cost on top of the same predicate work?
//
// TWO TRAPS, BOTH MEASURED RATHER THAN ASSUMED
//
// 1. MEMOIZATION. `getFilteredRowModel` is memoized on `[preFilteredRowModel,
//    columnFilters, globalFilter]`. Calling it in a loop measures a cache hit.
//    Re-setting the same value does not invalidate it, and neither does a
//    freshly allocated array with equal contents - both were tried, and both
//    left the filter function at exactly the call count of a single pass. Only
//    a CHANGED value invalidates. So every case alternates between two
//    thresholds an EPSILON apart, which over this dataset select the same rows
//    (asserted below, not assumed). The engine alternates over the same pair
//    even though it has no cache to defeat, so both sides run the same work.
//
// 2. HEAP CONTAMINATION. A TanStack row model allocates megabytes per
//    iteration. Measured in one process alongside it, `applyView` on the
//    numeric-AND-enum case reported 39.33 ms against a true cost of 2.76 ms -
//    a 14x lie, entirely GC. This is the same hazard `bench/index.ts` spawns a
//    process per rung for. So every (side, case) here gets its OWN process,
//    each one measuring the raw-loop baseline next to the thing it normalizes.
//    The comparable number is the MULTIPLE OF THE BASELINE, never the
//    milliseconds - the floor moves with column count (see `bench/filter`).
//
//   bun run bench -- vs/tanstack
//   BENCH_ROWS=300000 BENCH_COLS=20 bun bench/vs/tanstack.bench.ts

import { spawn } from "node:child_process";
import {
  columnFilteringFeature,
  constructTable,
  createFilteredRowModel,
  filterFn_greaterThan,
  tableFeatures,
} from "@tanstack/react-table";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { bench, do_not_optimize, run } from "mitata";
import {
  all,
  applyView,
  emptyGridView,
  FILTER_OP,
  type GridView,
  where,
} from "../../src";
import {
  type BenchRow,
  datasetFromEnv,
  describeSize,
  FIELD,
  PASS_FEW,
  PASS_HALF,
  sizeFromEnv,
} from "../dataset";

const { gt, is } = FILTER_OP;

const CASE_KEYS = ["half", "few", "both"] as const;
type CaseKey = (typeof CASE_KEYS)[number];
type Side = "engine" | "tanstack";

const CASE_LABEL: Record<CaseKey, string> = {
  half: "one numeric condition, ~50% pass",
  few: "one numeric condition, ~0.5% pass",
  both: "numeric AND enum",
};

/** Smaller than the dataset's 2-decimal quantisation, so the alternate
 *  threshold selects exactly the rows the primary one does. */
const EPSILON = 0.001;
const ENUM_VALUE = "Wheels";
const MARKER = "##VS-RESULT ";

interface ChildResult {
  side: Side;
  case: CaseKey;
  /** Nanoseconds per iteration. */
  baseline: number;
  subject: number;
  /** Rows the filter selected, for the cross-side agreement check. */
  count: number;
}

// ── Child: one side, one case, one process ─────────────────────────────────

async function child(side: Side, key: CaseKey): Promise<void> {
  const { rows, columns, rowCount, columnCount } = datasetFromEnv();

  const view = (filter: GridView["filter"]): GridView => ({
    ...emptyGridView(),
    filter,
  });
  const alt = (v: string) => String(Number(v) + EPSILON);

  const views: Record<CaseKey, [GridView, GridView]> = {
    half: [
      view(where(FIELD.number, gt, PASS_HALF)),
      view(where(FIELD.number, gt, alt(PASS_HALF))),
    ],
    few: [
      view(where(FIELD.number, gt, PASS_FEW)),
      view(where(FIELD.number, gt, alt(PASS_FEW))),
    ],
    both: [
      view(
        all(
          where(FIELD.number, gt, PASS_HALF),
          where(FIELD.enum, is, ENUM_VALUE),
        ),
      ),
      view(
        all(
          where(FIELD.number, gt, alt(PASS_HALF)),
          where(FIELD.enum, is, ENUM_VALUE),
        ),
      ),
    ],
  };

  // TanStack filter values are PRE-COERCED - a number, and an already
  // lowercased string. `filterFn(row, columnId, filterValue)` is handed the raw
  // value once per row with nowhere to hoist a parse into, while the engine's
  // `compileNumeric` parses the threshold once when it compiles the predicate.
  // Passing a string here measured 3.2x the numeric cost at the 50% rung, which
  // is a fact about the two APIs rather than about filtering speed.
  const enumLower = ENUM_VALUE.toLowerCase();
  const filters: Record<CaseKey, [TsFilter[], TsFilter[]]> = {
    half: [
      [{ id: FIELD.number, value: Number(PASS_HALF) }],
      [{ id: FIELD.number, value: Number(PASS_HALF) + EPSILON }],
    ],
    few: [
      [{ id: FIELD.number, value: Number(PASS_FEW) }],
      [{ id: FIELD.number, value: Number(PASS_FEW) + EPSILON }],
    ],
    both: [
      [
        { id: FIELD.number, value: Number(PASS_HALF) },
        { id: FIELD.enum, value: enumLower },
      ],
      [
        { id: FIELD.number, value: Number(PASS_HALF) + EPSILON },
        { id: FIELD.enum, value: enumLower },
      ],
    ],
  };

  const threshold = Number(PASS_HALF);
  const numberField = FIELD.number;
  let flip = 0;
  const turn = () => flip++ % 2;
  let count = 0;

  console.log(
    `\n  ${side} · ${CASE_LABEL[key]} · ${describeSize(rowCount, columnCount)}`,
  );

  // The same baseline in both processes: one numeric read per row, by hand.
  // Everything is reported as a multiple of THIS, measured on this heap.
  bench("baseline: raw loop, one numeric read", () => {
    const out: BenchRow[] = [];
    for (const row of rows) {
      if ((row[numberField] as number) > threshold) out.push(row);
    }
    do_not_optimize(out.length);
  }).baseline(true);

  if (side === "engine") {
    count = applyView(rows, views[key][0], columns).length;
    bench("engine: applyView", () => {
      do_not_optimize(applyView(rows, views[key][turn()], columns).length);
    });
  } else {
    const table = buildTable(rows, columns, false);
    count = setAndCount(table, filters[key][0]);
    bench("tanstack: setColumnFilters + getFilteredRowModel", () => {
      do_not_optimize(setAndCount(table, filters[key][turn()]));
    });
    if (key === "half") {
      const builtIn = buildTable(rows, columns, true);
      bench("tanstack: same, via its own filterFn_greaterThan", () => {
        do_not_optimize(setAndCount(builtIn, filters[key][turn()]));
      });
    }
  }

  const res = await run();
  const timings = new Map<string, number>();
  for (const b of res.benchmarks) {
    const r = b.runs?.[0];
    if (r?.stats) timings.set(String(r.name), r.stats.avg);
  }

  const result: ChildResult = {
    side,
    case: key,
    baseline: timings.get("baseline: raw loop, one numeric read") ?? 0,
    subject:
      timings.get("engine: applyView") ??
      timings.get("tanstack: setColumnFilters + getFilteredRowModel") ??
      0,
    count,
  };
  console.log(MARKER + JSON.stringify(result));
}

// ── The TanStack side ──────────────────────────────────────────────────────

interface TsFilter {
  id: string;
  value: unknown;
}
interface FilterRow {
  getValue: (columnId: string) => unknown;
}
interface TsTable {
  getFilteredRowModel: () => { rows: { original: BenchRow }[] };
  setColumnFilters: (next: TsFilter[]) => void;
}

/** `compileNumeric`'s ">" branch: a non-numeric row value is excluded rather
 *  than compared, so it cannot slip through as NaN. */
function numericGreaterThan(row: FilterRow, id: string, fv: number): boolean {
  const n = Number(row.getValue(id));
  return Number.isNaN(n) ? false : n > fv;
}

/** The scalar-enum "is" branch: case-insensitive equality, empty excluded.
 *  `fv` arrives already lowercased - see the note on `filters`. */
function enumIs(row: FilterRow, id: string, fv: string): boolean {
  const raw = row.getValue(id);
  if (raw === null || raw === undefined || String(raw).trim() === "")
    return false;
  return String(raw).toLowerCase() === fv;
}

/** `constructTable`'s generics resolve from a feature set assembled here, so
 *  the shape used afterwards is asserted by `TsTable` rather than inferred. */
function buildTable(
  rows: BenchRow[],
  columns: { id: string }[],
  builtIn: boolean,
): TsTable {
  const features = {
    ...tableFeatures({
      columnFilteringFeature,
      filteredRowModel: createFilteredRowModel(),
      filterFns: { greaterThan: filterFn_greaterThan },
    }),
    coreReactivityFeature: storeReactivityBindings(),
  };
  const defs = columns.map((c) => ({
    id: c.id,
    accessorKey: c.id,
    filterFn:
      c.id === FIELD.enum
        ? enumIs
        : builtIn
          ? "greaterThan"
          : numericGreaterThan,
  }));
  return constructTable({
    features,
    data: rows,
    columns: defs,
    initialState: { columnFilters: [] },
  } as never) as never as TsTable;
}

function setAndCount(table: TsTable, filters: TsFilter[]): number {
  table.setColumnFilters(filters);
  return table.getFilteredRowModel().rows.length;
}

// ── Parent: spawn every (side, case), then compare the multiples ───────────

function runChild(side: Side, key: CaseKey): Promise<ChildResult | null> {
  return new Promise((resolve) => {
    const proc = spawn("bun", [import.meta.path], {
      stdio: ["inherit", "pipe", "inherit"],
      env: { ...process.env, BENCH_SIDE: side, BENCH_CASE: key },
    });
    let found: ChildResult | null = null;
    let tail = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      tail += chunk.toString();
      const at = tail.indexOf(MARKER);
      if (at !== -1) {
        const line = tail.slice(at + MARKER.length).split("\n")[0];
        try {
          found = JSON.parse(line) as ChildResult;
        } catch {
          /* the line is still arriving; a later chunk completes it */
        }
      }
    });
    proc.on("exit", () => resolve(found));
  });
}

function ratio(r: ChildResult | null): string {
  if (!r || r.baseline === 0) return "—";
  return `${(r.subject / r.baseline).toFixed(1)}×`;
}

async function parent(): Promise<void> {
  const { rows, columns } = sizeFromEnv();
  console.log(
    `\n${"═".repeat(72)}\n  filter engine vs TanStack column filtering — ` +
      `${describeSize(rows, columns)}\n${"═".repeat(72)}`,
  );

  const results = new Map<string, ChildResult | null>();
  for (const key of CASE_KEYS) {
    for (const side of ["engine", "tanstack"] as const) {
      console.log(`\n${"─".repeat(72)}`);
      results.set(`${side}:${key}`, await runChild(side, key));
    }
  }

  const rule = "═".repeat(72);
  console.log(
    `\n${rule}\n  Each number is that process's own raw-loop baseline multiplied.\n` +
      `  Milliseconds across processes are not comparable; these are.\n${rule}\n`,
  );
  console.log(
    `  ${"case".padEnd(34)}${"engine".padEnd(10)}${"tanstack".padEnd(10)}rows`,
  );
  let disagreed = false;
  for (const key of CASE_KEYS) {
    const ours = results.get(`engine:${key}`) ?? null;
    const theirs = results.get(`tanstack:${key}`) ?? null;
    const agree = ours && theirs && ours.count === theirs.count;
    if (!agree) disagreed = true;
    console.log(
      `  ${CASE_LABEL[key].padEnd(34)}${ratio(ours).padEnd(10)}` +
        `${ratio(theirs).padEnd(10)}` +
        `${agree ? ours.count : `✗ ${ours?.count} vs ${theirs?.count}`}`,
    );
  }
  if (disagreed) {
    console.error(
      "\n  ✗ The two sides did not select the same rows, so the multiples above\n" +
        "    compare different workloads. Treat this run as void.",
    );
    process.exit(1);
  }
  // The baseline pushes ~50% of rows into an output array, so a case that
  // selects almost nothing does less total work than the thing normalizing it.
  // Under 1.0x means "cheaper than one numeric read per row plus the appends",
  // not a measurement error.
  console.log("\n  Under 1.0x is real: a ~0.5% filter appends far fewer rows");
  console.log("  than the baseline does, so it does less work overall.\n");
}

const side = process.env.BENCH_SIDE as Side | undefined;
const key = process.env.BENCH_CASE as CaseKey | undefined;
if (side && key) await child(side, key);
else await parent();
