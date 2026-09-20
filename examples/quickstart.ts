// The README quickstart, kept compiling. `bun run typecheck` covers this file,
// so an API change that breaks the documented example breaks the build.

import {
  applyAST,
  buildCsvString,
  buildExportFilename,
  col,
  EMPTY_FILTER_AST,
  type FilterAST,
  toColumnDefs,
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

const ast: FilterAST = {
  ...EMPTY_FILTER_AST,
  search: "estate",
  and: [{ field: "price", op: "≤", val: "25000" }],
  orGroups: [
    [
      { field: "fuel", op: "is", val: "diesel" },
      { field: "fuel", op: "is", val: "hybrid" },
    ],
  ],
};

export function report(rows: readonly Row[]) {
  const visible = applyAST(rows, ast, columns);
  return {
    csv: buildCsvString(visible, columns),
    filename: buildExportFilename({
      prefix: "report",
      scope: "emea",
      ext: "csv",
    }),
  };
}
