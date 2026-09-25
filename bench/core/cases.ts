import { applyView, compileView, where } from "../../src/filter-engine";
import { emptyGridView } from "../../src/grid-view";
import { computeRowsAggregates } from "../../src/layout/aggregates";
import { buildColumnWindow } from "../../src/layout/column-window";
import {
  buildColumnLayout,
  buildFlatItems,
  computeRowsAgg,
} from "../../src/layout/model";
import { buildRowPositionsByIndex } from "../../src/layout/row-position";
import { sortRowsForExport } from "../../src/sort-rows";
import {
  buildBenchColumns,
  buildBenchRows,
  FIELD,
  RARE_TOKEN,
} from "../dataset";

export function createCases(rowCount: number, columnCount: number) {
  const rows = buildBenchRows(rowCount, columnCount);
  const columns = buildBenchColumns(columnCount);
  const numeric = {
    ...emptyGridView(),
    filter: where(FIELD.number, ">", "500"),
  };
  const search = { ...emptyGridView(), search: RARE_TOKEN };
  const predicate = compileView(numeric, columns);
  const wrapped = rows.map((original) => ({ original }));
  const grouped = buildFlatItems(wrapped, FIELD.enum, "asc");
  const layoutInput = columns.map((c) => ({ id: c.id, item: c, size: 120 }));
  const layout = buildColumnLayout(layoutInput, [FIELD.number]);
  const sortRows = rows.slice(0, Math.min(10_000, rows.length));
  const rawSort = () =>
    sortRows
      .slice()
      .sort((a, b) => Number(b[FIELD.number]) - Number(a[FIELD.number]));
  const librarySort = () =>
    sortRowsForExport(
      sortRows,
      [{ field: FIELD.number, dir: "desc" }],
      columns,
    );
  const expectedSort = rawSort();
  const actualSort = librarySort();
  if (actualSort.some((row, i) => row !== expectedSort[i]))
    throw new Error("Sort reference parity failed");
  const expectedFilter = rows.filter((row) => Number(row[FIELD.number]) > 500);
  const actualFilter = applyView(rows, numeric, columns);
  if (
    actualFilter.length !== expectedFilter.length ||
    actualFilter.some((r, i) => r !== expectedFilter[i])
  )
    throw new Error("Filter reference parity failed");
  if (grouped.filter((item) => item.type === "row").length !== rowCount)
    throw new Error("Grouping lost rows");
  const numericFields = columns
    .filter((c) => c.type.filterType === "numeric")
    .slice(0, 10)
    .map((c) => c.id);
  const aggregateRequests = numericFields.map((key) => ({
    key,
    aggregation: "avg" as const,
  }));
  // Benchmark-only probe: same averages, traversing the rows once for all fields.
  const fusedAverages = () => {
    const sums = new Float64Array(numericFields.length);
    const counts = new Uint32Array(numericFields.length);
    for (const { original } of wrapped) {
      for (let i = 0; i < numericFields.length; i++) {
        const value = original[numericFields[i]];
        if (typeof value !== "number") continue;
        sums[i] += value;
        counts[i]++;
      }
    }
    return Array.from(sums, (sum, i) => (counts[i] ? sum / counts[i] : 0));
  };
  const expectedAverages = numericFields.map(
    (field) => computeRowsAgg(wrapped, field, "avg") ?? 0,
  );
  if (fusedAverages().some((value, i) => value !== expectedAverages[i]))
    throw new Error("Fused aggregate reference parity failed");
  const cases: Record<string, () => number> = {
    "filter/raw-numeric": () => {
      const out = [];
      for (const row of rows)
        if (Number(row[FIELD.number]) > 500) out.push(row);
      return out.length;
    },
    "filter/compiled-predicate": () => {
      let count = 0;
      for (const row of rows) if (predicate(row)) count++;
      return count;
    },
    "filter/apply-numeric": () => applyView(rows, numeric, columns).length,
    "search/all-searchable": () => applyView(rows, search, columns).length,
    "sort/raw-numeric-10k": () => Number(rawSort()[0][FIELD.number]),
    "sort/export-numeric-10k": () => Number(librarySort()[0][FIELD.number]),
    "group/flat-ungrouped": () => buildFlatItems(wrapped, "", "asc").length,
    "group/enum": () => buildFlatItems(wrapped, FIELD.enum, "asc").length,
    "group/positions": () => buildRowPositionsByIndex(grouped).size,
    "aggregate/one-average": () =>
      computeRowsAgg(wrapped, FIELD.number, "avg") ?? 0,
    "aggregate/ten-averages": () =>
      numericFields.reduce(
        (sum, field) => sum + (computeRowsAgg(wrapped, field, "avg") ?? 0),
        0,
      ),
    "aggregate/batched-ten-averages": () =>
      computeRowsAggregates(rows, aggregateRequests).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
    "probe/fused-ten-averages": () =>
      fusedAverages().reduce((sum, value) => sum + value, 0),
    "layout/columns": () =>
      buildColumnLayout(layoutInput, [FIELD.number]).length,
    "layout/column-window": () =>
      buildColumnWindow(layout, {
        scrollLeft: 900,
        viewportWidth: 1200,
        overscan: 2,
      }).slots.length,
  };
  return {
    cases,
    metadata: {
      rowCount,
      columnCount,
      sortRows: sortRows.length,
      aggregateColumns: numericFields.length,
      filterMatches: actualFilter.length,
      searchMatches: cases["search/all-searchable"](),
    },
  };
}
