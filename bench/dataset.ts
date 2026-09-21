// The benchmark dataset: a fictional wide inventory table, generated from a
// seed so two runs on two machines compare like for like.
//
// Three things about this generator are load-bearing, each learned by getting
// it wrong first:
//
//   1. String cells draw from SHARED pools. Synthesising unique text per cell
//      is the obvious way to write this and it costs ~68% more memory at 50k
//      rows (and the gap widens with size) - every cell becomes its own heap
//      string instead of a pointer to one of five.
//
//   2. Values are ranged so the SELECTIVITY of a filter is predictable. The
//      first draft used `> 50000` against values of 0..1000, so the benchmark
//      measured "reject every row and never grow the output array" - the
//      cheapest possible path, and not one any user hits. `NUMERIC_MAX` and
//      the `PASS_*` thresholds below exist so a benchmark can ask for ~50% or
//      ~0.5% and get it.
//
//   3. One column (`rare`) draws from a 1000-value pool so free-text search
//      has something genuinely rare to find. With only the 5-value pools, a
//      search for any category matched all 300k rows, which measures the
//      "append every row" path rather than searching.

import { ColumnTypes } from "../examples/column-types";
import { col, type SchemaColumn } from "../src";

export type BenchRow = Record<string, unknown>;

/** Deterministic PRNG - the same one `demo/data.ts` uses, so the demo and the
 *  benchmarks generate comparable data. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NUMERIC_MAX = 1000;
/** Threshold a numeric filter can use for ~50% selectivity. */
export const PASS_HALF = String(NUMERIC_MAX / 2);
/** Threshold for ~0.5% selectivity - the "needle" case. */
export const PASS_FEW = String(NUMERIC_MAX * 0.995);

const CATEGORIES = ["Wheels", "Frames", "Brakes", "Drivetrain", "Tyres"];
const SUPPLIERS = ["Acme", "Borealis", "Cyclon", "Deltaworks", "Everest"];
/** 1000 shared-but-varied values, so a search for one hits ~0.1% of rows. */
const RARE_POOL = Array.from({ length: 1000 }, (_, i) => `SKU-${i}`);
/** A token present in roughly one row per thousand. */
export const RARE_TOKEN = "SKU-777";

/** Column ids are `c000`…; `columnId(0)` is always numeric, so every benchmark
 *  can filter on it whatever the width. */
export function columnId(index: number): string {
  return `c${String(index).padStart(3, "0")}`;
}

/** Which of the four column flavours index `c` is. Fixed by position so a
 *  benchmark can name a column of the kind it wants without searching. */
function kindOf(index: number): "number" | "enum" | "text" | "date" | "rare" {
  if (index === 1) return "rare";
  const slot = index % 10;
  if (slot <= 5) return "number";
  if (slot <= 7) return "enum";
  if (slot === 8) return "text";
  return "date";
}

/** Index of the first column of each kind, for benchmarks to filter against. */
export const FIELD = {
  number: columnId(0),
  rare: columnId(1),
  enum: columnId(6),
  text: columnId(8),
  date: columnId(9),
} as const;

export function buildBenchRows(
  rowCount: number,
  columnCount: number,
  seed = 42,
): BenchRow[] {
  const rnd = mulberry32(seed);
  // Keys are hoisted: rebuilding `c000`-style strings inside the row loop is
  // 60M string allocations at the top of the ladder, which would make
  // generation itself the slowest thing in the suite.
  const keys = Array.from({ length: columnCount }, (_, c) => columnId(c));
  const kinds = keys.map((_, c) => kindOf(c));

  const rows: BenchRow[] = new Array(rowCount);
  for (let r = 0; r < rowCount; r++) {
    // Built key-by-key in the same order every time, so every row shares one
    // hidden class and property access stays as fast as the layout allows.
    const row: BenchRow = {};
    for (let c = 0; c < columnCount; c++) {
      switch (kinds[c]) {
        case "number":
          row[keys[c]] = Math.round(rnd() * NUMERIC_MAX * 100) / 100;
          break;
        case "enum":
          row[keys[c]] = CATEGORIES[(rnd() * CATEGORIES.length) | 0];
          break;
        case "text":
          row[keys[c]] = SUPPLIERS[(rnd() * SUPPLIERS.length) | 0];
          break;
        case "rare":
          row[keys[c]] = RARE_POOL[(rnd() * RARE_POOL.length) | 0];
          break;
        case "date":
          row[keys[c]] =
            `2026-${String(1 + ((r + c) % 12)).padStart(2, "0")}-${String(1 + ((r * 7 + c) % 28)).padStart(2, "0")}`;
          break;
      }
    }
    rows[r] = row;
  }
  return rows;
}

export function buildBenchColumns(
  columnCount: number,
): SchemaColumn<BenchRow>[] {
  return Array.from({ length: columnCount }, (_, c) => {
    const kind = kindOf(c);
    const type =
      kind === "number"
        ? ColumnTypes.NUMBER
        : kind === "date"
          ? ColumnTypes.DATE
          : kind === "enum"
            ? ColumnTypes.BADGE
            : ColumnTypes.TEXT;
    return col<BenchRow>({ id: columnId(c), label: columnId(c), type });
  });
}

/**
 * Dataset size for this process, from the environment.
 *
 * Every benchmark file runs as its OWN process, one rung at a time, because a
 * live multi-gigabyte heap changes what every later measurement costs. Sharing
 * one process across rungs is how a single-shot probe reported `applyView` at
 * 686 ms when its true cost is 36 ms - the first measurement after building the
 * dataset was paying for a full GC.
 */
export function sizeFromEnv(): { rows: number; columns: number } {
  return {
    rows: Number(process.env.BENCH_ROWS ?? 50_000),
    columns: Number(process.env.BENCH_COLS ?? 20),
  };
}

/** Builds the dataset this process was asked for, and prints what it is. */
export function datasetFromEnv() {
  const { rows: rowCount, columns: columnCount } = sizeFromEnv();
  const rows = buildBenchRows(rowCount, columnCount);
  const columns = buildBenchColumns(columnCount);
  return { rows, columns, rowCount, columnCount };
}

export function describeSize(rowCount: number, columnCount: number): string {
  const cells = (rowCount * columnCount) / 1e6;
  return `${rowCount.toLocaleString("en-GB")} rows × ${columnCount} cols (${cells.toFixed(1)}M cells)`;
}
