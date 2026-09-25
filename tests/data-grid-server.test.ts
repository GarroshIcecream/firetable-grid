import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnTypes } from "../examples/column-types";
import { col, emptyGridView, where } from "../src";
import { DataGrid, type DataGridProps } from "../src/react";

type Row = { id: string; price: number };
const columns = [
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.NUMBER }),
];
const rows = [
  { id: "z", price: 20 },
  { id: "a", price: 10 },
];
const base = {
  rows,
  columns,
  renderCell: (_c: unknown, row: Row) => `row-${row.id}`,
  getRowId: (row: Row) => row.id,
};
const render = (props: Partial<DataGridProps<Row>> = {}) =>
  renderToStaticMarkup(createElement(DataGrid<Row>, { ...base, ...props }));

test("server mode preserves returned rows despite active search/filter/sort", () => {
  const html = render({
    dataMode: "server",
    view: {
      ...emptyGridView(),
      search: "not in the rows",
      filter: where("price", ">", "999"),
      sort: [{ field: "price", dir: "asc" }],
    },
    onViewChange: () => {},
  });
  expect(html).toContain("row-z");
  expect(html).toContain("row-a");
  expect(html.indexOf("row-z")).toBeLessThan(html.indexOf("row-a"));
  expect(html).toContain('aria-sort="ascending"');
});

test("client mode continues to filter and sort", () => {
  const html = render({
    view: { ...emptyGridView(), sort: [{ field: "price", dir: "asc" }] },
  });
  expect(html.indexOf("row-a")).toBeLessThan(html.indexOf("row-z"));
  expect(
    render({
      view: { ...emptyGridView(), filter: where("price", ">", "999") },
    }),
  ).not.toContain("row-z");
});

test("server mode requires controlled state and rejects grouping", () => {
  expect(() => render({ dataMode: "server" })).toThrow("view");
  expect(() => render({ dataMode: "server", view: emptyGridView() })).toThrow(
    "onViewChange",
  );
  expect(() =>
    render({
      dataMode: "server",
      view: { ...emptyGridView(), group: { field: "price" } },
      onViewChange: () => {},
    }),
  ).toThrow("group");
});

test("server mode never presents a loaded page sum as the full result", () => {
  const props: Partial<DataGridProps<Row>> = {
    dataMode: "server",
    view: emptyGridView(),
    onViewChange: () => {},
    footerAggregations: { price: "sum" },
    numberFormatter: { number: (value) => `aggregate-${value}` },
  };
  expect(render(props)).not.toContain("aggregate-30");
  expect(render({ ...props, footerValues: { price: { sum: 500 } } })).toContain(
    "aggregate-500",
  );
  expect(
    render({ ...props, footerValues: { price: { sum: null } } }),
  ).not.toContain("aggregate-30");
});
