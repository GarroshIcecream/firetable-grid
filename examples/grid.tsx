// The README's <DataGrid> example, kept compiling. `bun run typecheck` covers
// this file, so an API change that breaks the documented component breaks the
// build.

import { useState } from "react";
import {
  buildVisibility,
  col,
  type FilterAST,
  isColumnVisible,
  type SchemaColumn,
  selectExportColumns,
} from "../src";
import { DataGrid, type SortEntry } from "../src/react";
import { ColumnTypes } from "./column-types";

interface Row {
  id: string;
  name: string;
  category: string;
  price: number;
  added: string;
}

const columns = [
  col<Row>({ id: "name", label: "Name", type: ColumnTypes.TEXT }),
  col<Row>({
    id: "category",
    label: "Category",
    type: ColumnTypes.BADGE,
    filterOptions: [
      { value: "frames", label: "Frames" },
      { value: "wheels", label: "Wheels" },
    ],
  }),
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  col<Row>({ id: "added", label: "Added", type: ColumnTypes.DATE }),
];

// One category per column confines a reorder drag to its own bucket; omit
// `categoryOf` entirely and every column shares one, i.e. free reordering.
const CATEGORY: Record<string, string> = {
  name: "identity",
  category: "identity",
  price: "metrics",
  added: "metrics",
};

function Cell({ column, row }: { column: SchemaColumn<Row>; row: Row }) {
  const raw = (row as unknown as Record<string, unknown>)[column.id];
  return <span>{raw == null ? "" : String(raw)}</span>;
}

/** The minimal call: resizing works with no wiring at all. */
export function MinimalGrid({ rows }: { rows: readonly Row[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      renderCell={(column, row) => <Cell column={column} row={row} />}
    />
  );
}

/** Everything controlled, which is what you want once a view is persisted. */
export function ControlledGrid({
  rows,
  filter,
}: {
  rows: readonly Row[];
  filter: FilterAST;
}) {
  const [sorting, setSorting] = useState<SortEntry[]>([]);
  const [order, setOrder] = useState<string[]>(() => columns.map((c) => c.id));
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Read-only as far as the grid is concerned: your column manager owns it.
  const [visibility, setVisibility] = useState(() => buildVisibility(columns));

  const hide = (id: string) =>
    setVisibility((v) => ({ ...v, [id]: !isColumnVisible(id, v) }));

  // The same record the grid reads, so the file is what is on screen.
  const exportColumns = selectExportColumns(columns, order, visibility, rows);

  return (
    <>
      <button type="button" onClick={() => hide("price")}>
        Toggle Price ({exportColumns.length} columns export)
      </button>
      <DataGrid
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        renderCell={(column, row) => <Cell column={column} row={row} />}
        filter={filter}
        sorting={sorting}
        onSortingChange={setSorting}
        groupBy="category"
        collapsedGroups={collapsed}
        onCollapsedGroupsChange={setCollapsed}
        columnOrder={order}
        onColumnOrderChange={setOrder}
        columnSizes={sizes}
        onColumnSizesChange={setSizes}
        columnVisibility={visibility}
        reorderable
        categoryOf={(id) => CATEGORY[id]}
      />
    </>
  );
}
