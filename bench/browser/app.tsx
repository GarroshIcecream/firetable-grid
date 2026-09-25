import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ColumnTypes } from "../../examples/column-types";
import { col, type SchemaColumn } from "../../src/column-schema";
import type { AggregationType } from "../../src/column-vocabulary";
import type { FooterAggregateValues } from "../../src/footer-aggregate-value";
import {
  type ColumnLayoutState,
  emptyGridView,
  type GridView,
} from "../../src/grid-view";
import { DataGrid } from "../../src/react/DataGrid";

type Row = { id: string; [key: string]: string | number };
let renders = 0;
let aggregateReads = 0;
let updateRows: (fn: (rows: Row[]) => Row[]) => void;
let updateLabel: (label: string) => void;
let updateView: Dispatch<SetStateAction<GridView>>;
let updateAggregations: Dispatch<
  SetStateAction<Record<string, AggregationType> | undefined>
>;
let updateFooterValues: Dispatch<
  SetStateAction<FooterAggregateValues | undefined>
>;
type MountOptions = {
  dataMode?: "client" | "server";
  virtualizeColumns?: boolean;
  pinned?: string[];
  footer?: boolean;
  trackAggregateReads?: boolean;
  rowVirtual?: boolean;
};
const numberFormatter = { number: (value: number) => String(value) };
const footerAggregations = { c0: "sum" as const };
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element");
let root = createRoot(rootElement);
const getRowId = (row: Row) => row.id;
function App({
  rows: initialRows,
  columns,
  options,
}: {
  rows: Row[];
  columns: SchemaColumn<Row>[];
  options: MountOptions;
}) {
  const [rows, setRows] = useState(initialRows);
  const [label, setLabel] = useState("");
  const [aggregations, setAggregations] = useState<
    Record<string, AggregationType> | undefined
  >(options.footer ? footerAggregations : undefined);
  const [footerValues, setFooterValues] = useState<FooterAggregateValues>();
  updateAggregations = setAggregations;
  updateFooterValues = setFooterValues;
  const [view, setView] = useState<GridView>(() => ({
    ...emptyGridView(),
    columns: { pinned: options.pinned },
  }));
  updateRows = setRows;
  updateLabel = setLabel;
  updateView = setView;
  const renderCell = useCallback(
    (column: SchemaColumn<Row>, row: Row) => {
      renders++;
      return column.id === "c1" ? (
        <input aria-label={`Edit ${row.id}`} defaultValue={`${row.id}`} />
      ) : (
        <span data-row={row.id}>
          {label}
          {row[column.id]}
        </span>
      );
    },
    [label],
  );
  return (
    <DataGrid
      dataMode={options.dataMode}
      rows={rows}
      columns={columns}
      renderCell={renderCell}
      getRowId={getRowId}
      view={view}
      onViewChange={setView}
      enableSelection
      virtualize={
        options.rowVirtual === false
          ? undefined
          : { rowHeight: 32, overscan: 4 }
      }
      virtualizeColumns={
        options.virtualizeColumns ? { overscan: 2 } : undefined
      }
      footerAggregations={aggregations}
      footerValues={footerValues}
      numberFormatter={numberFormatter}
      reorderable
    />
  );
}
const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const frame = () => {
  const node = document.querySelector<HTMLDivElement>(".ftg-frame");
  if (!node) throw new Error("Grid not mounted");
  return node;
};
const api = {
  async mount(
    rowCount: number,
    columnCount: number,
    options: MountOptions = {},
  ) {
    flushSync(() => root.unmount());
    root = createRoot(rootElement);
    const columns = Array.from({ length: columnCount }, (_, c) =>
      col<Row>({
        id: `c${c}`,
        label: `Column ${c}`,
        type: c === 0 ? ColumnTypes.NUMBER : ColumnTypes.TEXT,
        width: 110,
        getFilterValue:
          options.trackAggregateReads && c === 0
            ? (row) => {
                aggregateReads++;
                return row.c0;
              }
            : undefined,
      }),
    );
    const rows = Array.from(
      { length: rowCount },
      (_, r) =>
        Object.fromEntries([
          ["id", `r${r}`],
          ...columns.map((c, i) => [
            c.id,
            i === 0 ? rowCount - r : `${r}:${i}`,
          ]),
        ]) as Row,
    );
    renders = 0;
    aggregateReads = 0;
    const start = performance.now();
    flushSync(() =>
      root.render(<App rows={rows} columns={columns} options={options} />),
    );
    const syncMs = performance.now() - start;
    await settle();
    return { syncMs, elapsedMs: performance.now() - start, ...api.state() };
  },
  state() {
    return {
      renders,
      aggregateReads,
      domRows: document.querySelectorAll(".ftg-row").length,
      domCells: document.querySelectorAll(".ftg-row td").length,
      dataCells: document.querySelectorAll(".ftg-row [data-column-id]").length,
    };
  },
  async scroll(top: number, left?: number) {
    const before = renders;
    const start = performance.now();
    const el = frame();
    el.scrollTop = top;
    if (left !== undefined) el.scrollLeft = left;
    flushSync(() => el.dispatchEvent(new Event("scroll")));
    // Include style/layout flush, but not paint or a vsync wait, in workMs.
    void el.offsetHeight;
    const workMs = performance.now() - start;
    await settle();
    return { workMs, renderedCells: renders - before, ...api.state() };
  },
  async layout(patch: Partial<ColumnLayoutState>) {
    flushSync(() =>
      updateView((view) => ({
        ...view,
        columns: { ...view.columns, ...patch },
      })),
    );
    await settle();
  },
  async group(field: string) {
    flushSync(() => updateView((view) => ({ ...view, group: { field } })));
    await settle();
  },
  async aggregation(value: AggregationType) {
    flushSync(() => updateAggregations({ c0: value }));
    await settle();
  },
  async footerValue(
    aggregation: AggregationType,
    value: number | null | undefined,
  ) {
    flushSync(() =>
      updateFooterValues(
        value === undefined ? undefined : { c0: { [aggregation]: value } },
      ),
    );
    await settle();
  },
  async filterMinimum(value: number) {
    flushSync(() =>
      updateView((view) => ({
        ...view,
        filter: { kind: "where", field: "c0", op: ">", value: String(value) },
      })),
    );
    await settle();
  },
  async editFirst() {
    flushSync(() =>
      updateRows((rows) =>
        rows.map((r, i) => (i === 0 ? { ...r, c0: 777 } : r)),
      ),
    );
    await settle();
  },
  async reverseFirst() {
    flushSync(() =>
      updateRows((rows) => [...rows.slice(0, 10).reverse(), ...rows.slice(10)]),
    );
    await settle();
  },
  async label(value: string) {
    flushSync(() => updateLabel(value));
    await settle();
  },
  async sort() {
    flushSync(() =>
      updateView({ ...emptyGridView(), sort: [{ field: "c0", dir: "asc" }] }),
    );
    await settle();
  },
};
Object.assign(window, { gridBench: api });
export type BrowserBench = typeof api;
