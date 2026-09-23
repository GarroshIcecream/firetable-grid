// Runs the whole suite across the size ladder.
//
// Each file × each rung runs as its OWN PROCESS. That is not tidiness - a live
// multi-gigabyte heap changes what every later measurement in the same process
// costs. Measuring the ladder in one process reported `applyView` at 686 ms
// when its real cost is 36 ms, because the first measurement after building a
// 2.3 GB dataset was paying for a full GC. One process per rung is the only way
// the rungs are comparable to each other.
//
//   bun run bench                  the default ladder
//   bun run bench -- --full        adds the 300k × 200 rung (~2.2 GB, slow)
//   bun run bench -- filter        one file, every rung
//   bun run bench -- vs/tanstack   compare against TanStack's own filtering
//
// `vs/tanstack` is deliberately out of the default ladder: it is a comparison,
// not a regression guard, and it spawns a process per (side, case) of its own.
//   BENCH_ROWS=300000 BENCH_COLS=200 bun bench/filter.bench.ts   one shot

import { spawn } from "node:child_process";
import { join } from "node:path";

interface Rung {
  rows: number;
  columns: number;
  /** Excluded from the default ladder: slow to build and ~2.2 GB resident. */
  heavy?: boolean;
}

const LADDER: Rung[] = [
  { rows: 10_000, columns: 20 },
  { rows: 50_000, columns: 20 },
  { rows: 50_000, columns: 200 },
  { rows: 300_000, columns: 20 },
  { rows: 300_000, columns: 200, heavy: true },
];

const FILES = ["filter", "layout", "export"] as const;

const args = process.argv.slice(2);
const full = args.includes("--full");
const only = args.filter((a) => !a.startsWith("--"));

const files = only.length > 0 ? only : [...FILES];
const rungs = LADDER.filter((r) => full || !r.heavy);

function runOne(file: string, rung: Rung): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bun", [join(import.meta.dir, `${file}.bench.ts`)], {
      stdio: "inherit",
      env: {
        ...process.env,
        BENCH_ROWS: String(rung.rows),
        BENCH_COLS: String(rung.columns),
      },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let failed = 0;
for (const file of files) {
  for (const rung of rungs) {
    const label = `${file} @ ${rung.rows.toLocaleString("en-GB")} × ${rung.columns}`;
    console.log(`\n${"═".repeat(72)}\n  ${label}\n${"═".repeat(72)}`);
    const code = await runOne(file, rung);
    if (code !== 0) {
      failed++;
      console.error(`  ✗ ${label} exited ${code}`);
    }
  }
}

if (!full) {
  console.log(
    "\nThe 300,000 × 200 rung was skipped — it builds a ~2.2 GB dataset.\n" +
      "Run `bun run bench -- --full` to include it.",
  );
}
process.exit(failed > 0 ? 1 : 0);
