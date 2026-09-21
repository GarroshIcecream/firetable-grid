// Export: the one path where COLUMN count is the workload rather than a
// multiplier on cache misses.
//
// Filtering reads one column per row per condition. Export touches every
// exportable column of every row - at the top of the ladder that is 60M cell
// resolutions and a CSV string measured in hundreds of megabytes. If anything
// in this suite is going to hit a memory ceiling, it is here, which is why the
// row counts below are deliberately smaller than the filter file's.

import { barplot, bench, do_not_optimize, run, summary } from "mitata";
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
if (!numberColumn || !dateColumn) throw new Error("bench columns missing");
const sampleRow = slice[0];

barplot(() => {
  summary(() => {
    bench("buildCsvString, all columns", () => {
      do_not_optimize(buildCsvString(slice, columns).length);
    }).baseline(true);

    bench("selectExportColumns", () => {
      do_not_optimize(
        selectExportColumns(columns, [], visibility, slice).length,
      );
    });

    bench("resolveCellValue × rows (numeric column)", () => {
      let n = 0;
      for (const row of slice) {
        n += resolveCellValue(row, numberColumn).length;
      }
      do_not_optimize(n);
    });

    bench("resolveCellValue × rows (date column)", () => {
      let n = 0;
      for (const row of slice) {
        n += resolveCellValue(row, dateColumn).length;
      }
      do_not_optimize(n);
    });

    bench("escapeCsvCell, one cell", () => {
      do_not_optimize(escapeCsvCell(String(sampleRow[FIELD.text])));
    });
  });
});

await run();
