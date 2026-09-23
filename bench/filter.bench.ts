// Filtering: the engine's hottest path.
//
// Every case is measured against a RAW-LOOP BASELINE doing the same property
// reads by hand. That comparison is the whole point of this file: an absolute
// millisecond number tells you nothing on its own, because the floor moves
// enormously with column count - one property read per row over 300k rows costs
// ~0.8 ms at 20 columns and ~36 ms at 200, purely from cache locality. Against
// the baseline you can see whether the ENGINE got slower, which is the only
// thing a regression run can act on.

import { barplot, bench, do_not_optimize, run, summary } from "mitata";
import {
  all,
  any,
  applyView,
  compileView,
  emptyGridView,
  FILTER_OP,
  type GridView,
  where,
} from "../src";
import {
  datasetFromEnv,
  describeSize,
  FIELD,
  PASS_FEW,
  PASS_HALF,
  RARE_TOKEN,
} from "./dataset";

const { gt, is, after } = FILTER_OP;

const { rows, columns, rowCount, columnCount } = datasetFromEnv();

const view = (over: Partial<GridView>): GridView => ({
  ...emptyGridView(),
  ...over,
});

const halfPass = view({ filter: where(FIELD.number, gt, PASS_HALF) });
const fewPass = view({ filter: where(FIELD.number, gt, PASS_FEW) });
const threeAnded = view({
  filter: all(
    where(FIELD.number, gt, PASS_HALF),
    where(FIELD.enum, is, "Wheels"),
    where(FIELD.date, after, "2026-06-01"),
  ),
});
const nested = view({
  filter: all(
    where(FIELD.number, gt, PASS_HALF),
    any(
      where(FIELD.enum, is, "Wheels"),
      where(FIELD.enum, is, "Frames"),
      where(FIELD.text, is, "Acme"),
    ),
  ),
});
const searching = view({ search: RARE_TOKEN });

// Compiled once, as `applyView` does internally - isolates predicate cost from
// the output array so a regression can be attributed to one or the other.
const matchesHalf = compileView(halfPass, columns);

const threshold = Number(PASS_HALF);
const numberField = FIELD.number;

console.log(`\nfilter — ${describeSize(rowCount, columnCount)}`);
console.log(
  `  ${applyView(rows, halfPass, columns).length} of ${rowCount} pass the ~50% filter, ` +
    `${applyView(rows, fewPass, columns).length} pass the ~0.5% one, ` +
    `${applyView(rows, searching, columns).length} match the search\n`,
);

barplot(() => {
  summary(() => {
    bench("baseline: raw loop, same reads", () => {
      const out: unknown[] = [];
      for (const row of rows) {
        if ((row[numberField] as number) > threshold) out.push(row);
      }
      do_not_optimize(out.length);
    }).baseline(true);

    bench("predicate only (no output array)", () => {
      let n = 0;
      for (const row of rows) if (matchesHalf(row)) n++;
      do_not_optimize(n);
    });

    bench("numeric, ~50% pass", () => {
      do_not_optimize(applyView(rows, halfPass, columns).length);
    });

    bench("numeric, ~0.5% pass", () => {
      do_not_optimize(applyView(rows, fewPass, columns).length);
    });

    bench("three conditions, all()", () => {
      do_not_optimize(applyView(rows, threeAnded, columns).length);
    });

    bench("nested all(any(...))", () => {
      do_not_optimize(applyView(rows, nested, columns).length);
    });

    bench("free-text search, rare token", () => {
      do_not_optimize(applyView(rows, searching, columns).length);
    });
  });
});

await run();
