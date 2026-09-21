// The README quickstart, kept compiling. `bun run typecheck` covers this file,
// so an API change that breaks the documented example breaks the build.

import {
  all,
  any,
  applyView,
  buildCsvString,
  buildExportFilename,
  col,
  emptyGridView,
  type GridView,
  toColumnDefs,
  where,
} from "../src";
import { ColumnTypes } from "./column-types";

interface Row {
  name: string;
  price: number;
  added: string;
  fuel: string;
}

const columns = [
  col<Row>({ id: "name", label: "Name", type: ColumnTypes.TEXT }),
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  col<Row>({ id: "added", label: "Added", type: ColumnTypes.DATE }),
];

export const columnDefs = toColumnDefs(columns);

// "estate" typed in the search box, under £25,000, diesel or hybrid, cheapest
// first, sectioned by fuel — the whole state of a grid in one object.
const view: GridView = {
  search: "estate",
  filter: all(
    where("price", "≤", "25000"),
    any(where("fuel", "is", "diesel"), where("fuel", "is", "hybrid")),
  ),
  sort: [{ field: "price", dir: "asc" }],
  group: { field: "fuel" },
};

// Nothing set yet, for comparison: a fresh view every call, safe to build up.
export const defaultView = emptyGridView();

export function report(rows: readonly Row[]) {
  const visible = applyView(rows, view, columns);
  return {
    csv: buildCsvString(visible, columns),
    filename: buildExportFilename({
      prefix: "report",
      scope: "emea",
      ext: "csv",
    }),
  };
}
