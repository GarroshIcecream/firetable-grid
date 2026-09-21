// Export: the one path where COLUMN count is the workload rather than a
// multiplier on cache misses.
//
// Filtering reads one column per row per condition. Export touches every
// exportable column of every row - at the top of the ladder that is 60M cell
// resolutions and a CSV string measured in hundreds of megabytes. If anything
// in this suite is going to hit a memory ceiling, it is here, which is why the
// row counts below are deliberately smaller than the filter file's.

import { barplot, bench, do_not_optimize, group, run, summary } from "mitata";
import {
  buildCsvString,
  escapeCsvCell,
  resolveCellValue,
  selectExportColumns,
} from "../src";
import { datasetFromEnv, describeSize, FIELD } from "./dataset";

const { rows, columns, rowCount, columnCount } = datasetFromEnv();

// Export benchmarks run over a slice: a full 300k x 200 CSV is ~450 MB of
// string, which measures the allocator rather than the engine.
const EXPORT_ROWS = Number(process.env.BENCH_EXPORT_ROWS ?? 10_000);
const slice = rows.slice(0, Math.min(EXPORT_ROWS, rows.length));

const visibility: Record<string, boolean> = {};
const exportColumns = selectExportColumns(columns, [], visibility, slice);

const csv = buildCsvString(slice, columns);
console.log(`\nexport — ${describeSize(rowCount, columnCount)}`);
console.log(
  `  CSV over ${slice.length.toLocaleString("en-GB")} rows × ${columns.length} cols ` +
    `= ${(csv.length / 1024 / 1024).toFixed(1)} MB, ` +
    `${exportColumns.length} columns selected as exportable\n`,
);

const numberColumn = columns.find((c) => c.id === FIELD.number);
const dateColumn = columns.find((c) => c.id === FIELD.date);
const enumColumn = columns.find((c) => c.id === FIELD.enum);
if (!numberColumn || !dateColumn || !enumColumn) {
  throw new Error("bench columns missing");
}
const sampleRow = slice[0];

// Benchmarks are grouped BY SCALE, and only compared within a group. A
// per-cell function and a whole-dataset one in the same `summary()` produce
// ratios like "4,176,331x slower", which is not a finding - it is the two
// measurements being four orders of magnitude apart, and it flattens the
// barplot into a single bar plus noise.

group("whole dataset", () => {
  barplot(() => {
    summary(() => {
      // Reading every cell without assembling anything, so the difference
      // against buildCsvString is the escape-and-join half of the work.
      bench("resolve every cell, no string assembly", () => {
        let n = 0;
        for (const row of slice) {
          for (const column of columns)
            n += resolveCellValue(row, column).length;
        }
        do_not_optimize(n);
      }).baseline(true);

      bench("buildCsvString, all columns", () => {
        do_not_optimize(buildCsvString(slice, columns).length);
      });
    });
  });
});

group("one column × every row", () => {
  barplot(() => {
    summary(() => {
      bench("resolveCellValue, numeric column", () => {
        let n = 0;
        for (const row of slice)
          n += resolveCellValue(row, numberColumn).length;
        do_not_optimize(n);
      }).baseline(true);

      bench("resolveCellValue, date column", () => {
        let n = 0;
        for (const row of slice) n += resolveCellValue(row, dateColumn).length;
        do_not_optimize(n);
      });

      bench("resolveCellValue, enum column", () => {
        let n = 0;
        for (const row of slice) n += resolveCellValue(row, enumColumn).length;
        do_not_optimize(n);
      });
    });
  });
});

group("per call, not per row", () => {
  barplot(() => {
    summary(() => {
      bench("escapeCsvCell, one cell", () => {
        do_not_optimize(escapeCsvCell(String(sampleRow[FIELD.text])));
      }).baseline(true);

      bench("selectExportColumns", () => {
        do_not_optimize(
          selectExportColumns(columns, [], visibility, slice).length,
        );
      });
    });
  });
});

await run();
