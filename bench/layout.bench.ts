// Sorting, grouping and layout.
//
// Sorting is the outlier in this suite: `sortRowsForExport` constructs a whole
// throwaway TanStack table per call, because the exported file and the screen
// have to agree on every comparator. That is a deliberate correctness trade,
// and this benchmark exists to keep its cost visible rather than to celebrate
// it - if it ever becomes the reason an export times out, the number is here.
//
// Layout is per COLUMN, not per row, so it barely moves with the row count.
// It is measured at the top of the ladder anyway, to prove that.

import { barplot, bench, do_not_optimize, group, run, summary } from "mitata";
import { type SortRule, sortRowsForExport } from "../src";
import {
  buildCellSpecs,
  buildColumnLayout,
  buildFlatItems,
  buildRowPositionsByIndex,
  computeRowsAgg,
  type FlatItem,
  groupSortDirection,
} from "../src/layout";
import { datasetFromEnv, describeSize, FIELD } from "./dataset";

const { rows, columns, rowCount, columnCount } = datasetFromEnv();

// Sorting builds a TanStack table per call; at the top of the ladder that is
// minutes, not milliseconds, so it runs over a slice.
const SORT_ROWS = Number(process.env.BENCH_SORT_ROWS ?? 50_000);
const sortSlice = rows.slice(0, Math.min(SORT_ROWS, rows.length));

const oneColumn: SortRule[] = [{ field: FIELD.number, dir: "desc" }];
const threeColumns: SortRule[] = [
  { field: FIELD.enum, dir: "asc" },
  { field: FIELD.number, dir: "desc" },
  { field: FIELD.date, dir: "asc" },
];

const wrapped = rows.map((original) => ({ original }));
const layoutInput = columns.map((c) => ({
  id: c.id,
  item: c,
  minWidth: c.minWidth,
  size: c.width,
}));
const frozen = columns.slice(0, 3).map((c) => c.id);
const layout = buildColumnLayout(layoutInput, frozen);
const grouped: FlatItem[] = buildFlatItems(wrapped, FIELD.enum, "asc");
const firstHeader = grouped.find((i: FlatItem) => i.type === "group-header");
const firstGroupKey =
  firstHeader?.type === "group-header" ? firstHeader.key : "";

console.log(`\nsort + group + layout — ${describeSize(rowCount, columnCount)}`);
console.log(
  `  sorting over ${sortSlice.length.toLocaleString("en-GB")} rows, ` +
    `grouping ${rowCount.toLocaleString("en-GB")} into ` +
    `${grouped.filter((i: FlatItem) => i.type === "group-header").length} groups\n`,
);

group("sort", () => {
  barplot(() => {
    summary(() => {
      bench("sortRowsForExport, one column", () => {
        do_not_optimize(
          sortRowsForExport(sortSlice, oneColumn, columns).length,
        );
      }).baseline(true);

      bench("sortRowsForExport, three columns", () => {
        do_not_optimize(
          sortRowsForExport(sortSlice, threeColumns, columns).length,
        );
      });
    });
  });
});

group("group", () => {
  barplot(() => {
    summary(() => {
      bench("buildFlatItems, ungrouped", () => {
        do_not_optimize(buildFlatItems(wrapped, "", "asc").length);
      }).baseline(true);

      bench("buildFlatItems, grouped by enum", () => {
        do_not_optimize(buildFlatItems(wrapped, FIELD.enum, "asc").length);
      });

      bench("buildFlatItems, one group collapsed", () => {
        do_not_optimize(
          buildFlatItems(wrapped, FIELD.enum, "asc", new Set([firstGroupKey]))
            .length,
        );
      });

      bench("buildFlatItems, grouped by date", () => {
        do_not_optimize(buildFlatItems(wrapped, FIELD.date, "asc").length);
      });

      bench("buildRowPositionsByIndex", () => {
        do_not_optimize(buildRowPositionsByIndex(grouped).size);
      });

      bench("computeRowsAgg, avg", () => {
        do_not_optimize(computeRowsAgg(wrapped, FIELD.number, "avg"));
      });
    });
  });
});

group("layout (per column, not per row)", () => {
  barplot(() => {
    summary(() => {
      bench("buildColumnLayout", () => {
        do_not_optimize(buildColumnLayout(layoutInput, frozen).length);
      }).baseline(true);

      bench("buildCellSpecs", () => {
        do_not_optimize(
          buildCellSpecs(layout, {
            wrapCells: false,
            metaOf: (c: (typeof columns)[number]) => c,
          }).length,
        );
      });

      bench("groupSortDirection", () => {
        do_not_optimize(groupSortDirection(threeColumns, FIELD.enum));
      });
    });
  });
});

await run();
