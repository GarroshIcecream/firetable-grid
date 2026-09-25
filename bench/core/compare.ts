import assert from "node:assert/strict";

type Report = {
  runtime: string;
  machine: { cpu: string; platform: string; arch: string };
  workloads: Array<{
    rowCount: number;
    columnCount: number;
    results: Array<{
      name: string;
      medianMs: number;
      p95Ms: number;
      checksum: number;
    }>;
  }>;
};
const [beforePath, afterPath] = process.argv.slice(2);
assert(
  beforePath && afterPath,
  "Usage: bun bench/core/compare.ts before.json after.json",
);
const before: Report = await Bun.file(beforePath).json();
const after: Report = await Bun.file(afterPath).json();
assert.equal(before.runtime, after.runtime, "Compare the same browser version");
assert.deepEqual(before.machine, after.machine, "Compare the same machine");
const key = (rows: number, columns: number, name: string) =>
  `${rows}x${columns} ${name}`;
const previous = new Map(
  before.workloads.flatMap((w) =>
    w.results.map((r) => [key(w.rowCount, w.columnCount, r.name), r] as const),
  ),
);
const changes = after.workloads.flatMap((w) =>
  w.results.map((r) => {
    const name = key(w.rowCount, w.columnCount, r.name);
    const old = previous.get(name);
    assert(old, `Missing baseline for ${name}`);
    assert.equal(old.checksum, r.checksum, `Workload result changed: ${name}`);
    previous.delete(name);
    return {
      case: name,
      beforeMs: old.medianMs.toFixed(3),
      afterMs: r.medianMs.toFixed(3),
      change: `${((r.medianMs / old.medianMs - 1) * 100).toFixed(1)}%`,
      deltaMs: r.medianMs - old.medianMs,
    };
  }),
);
assert.equal(previous.size, 0, "Candidate omitted baseline cases");
console.table(
  changes
    .sort((a, b) => b.deltaMs - a.deltaMs)
    .map(({ deltaMs, ...rest }) => rest),
);
console.log(
  "Positive change means slower. This is descriptive, not a timing-based CI gate; inspect repeated runs and raw samples.",
);
