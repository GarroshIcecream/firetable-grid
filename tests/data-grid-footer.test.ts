import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnTypes } from "../examples/column-types";
import { col, emptyGridView, where } from "../src";
import { DataGrid, type DataGridProps } from "../src/react";

type Row = { id: string; price: number; cost: number | null };
const rows: Row[] = [
  { id: "a", price: 10, cost: 2 },
  { id: "b", price: 20, cost: null },
  { id: "c", price: 30, cost: 8 },
];
const columns = [
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.NUMBER }),
  col<Row>({
    id: "costAlias",
    accessorKey: "cost",
    label: "Cost",
    type: ColumnTypes.NUMBER,
  }),
  col<Row>({
    id: "derived",
    label: "Derived",
    type: ColumnTypes.NUMBER,
    getFilterValue: (row) => row.price * 2,
  }),
];
const render = (props: Partial<DataGridProps<Row>> = {}) =>
  renderToStaticMarkup(
    createElement(DataGrid<Row>, {
      rows,
      columns,
      getRowId: (row) => row.id,
      renderCell: () => "cell",
      footerAggregations: { price: "sum", costAlias: "avg", derived: "max" },
      numberFormatter: { number: (value) => String(value) },
      renderFooterCell: (column, value) => `${column.id}=${String(value)}`,
      ...props,
    }),
  );

test("footer batches combine key, accessorKey and custom accessors over filtered rows", () => {
  const html = render({
    view: { ...emptyGridView(), filter: where("price", ">", "10") },
  });
  expect(html).toContain("price=50");
  expect(html).toContain("costAlias=8");
  expect(html).toContain("derived=60");
});

test("server answers including explicit null skip local accessors in a mixed batch", () => {
  const guarded = columns.map((column) =>
    column.id === "derived"
      ? {
          ...column,
          getFilterValue: () => {
            throw new Error("Unnecessary server override scan");
          },
        }
      : column,
  );
  const html = render({
    columns: guarded,
    footerValues: { price: { sum: 1234 }, derived: { max: null } },
  });
  expect(html).toContain("price=1234");
  expect(html).toContain("costAlias=5");
  expect(html).toContain("derived=null");
});

test("server mode never computes missing totals from the loaded page", () => {
  const html = render({
    dataMode: "server",
    view: emptyGridView(),
    onViewChange: () => {},
    footerValues: { price: { sum: 900 } },
  });
  expect(html).toContain("price=900");
  expect(html).toContain("costAlias=null");
  expect(html).toContain("derived=null");
});

test("hidden columns and disabled footer output never evaluate aggregate accessors", () => {
  const guarded = columns.map((column) => ({
    ...column,
    getFilterValue: () => {
      throw new Error("Unnecessary footer scan");
    },
  }));
  expect(() =>
    render({ columns: guarded, numberFormatter: undefined }),
  ).not.toThrow();
  const html = render({
    columns: guarded,
    view: {
      ...emptyGridView(),
      columns: {
        visibility: { price: false, costAlias: false, derived: false },
      },
    },
  });
  expect(html).not.toContain("derived=");
});
