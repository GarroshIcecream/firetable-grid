// `description` is a display string like `label`: the schema carries it through
// untouched, and <DataGrid> shows it as the header tooltip unless
// `renderHeader` takes the header over.

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnTypes } from "../examples/column-types";
import { col, toColumnDefs } from "../src";
import { DataGrid } from "../src/react";

interface Row {
  id: string;
  price: number;
}

const price = col<Row>({
  id: "price",
  label: "Price",
  description: "Asking price incl. VAT",
  type: ColumnTypes.CURRENCY,
});

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(DataGrid<Row>, {
      rows: [{ id: "a", price: 1 }],
      renderCell: () => null,
      ...props,
    } as never),
  );

describe("column description", () => {
  test("col() leaves it undefined when omitted", () => {
    expect(
      col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY })
        .description,
    ).toBeUndefined();
  });

  test("col() and toColumnDefs() carry it through", () => {
    expect(price.description).toBe("Asking price incl. VAT");
    const meta = toColumnDefs([price])[0]?.meta as
      | Record<string, unknown>
      | undefined;
    expect(meta?.description).toBe("Asking price incl. VAT");
  });

  test("the grid shows it as the header's title", () => {
    const html = render({ columns: [price] });
    expect(html).toContain('title="Asking price incl. VAT"');
    expect(html).toContain(">Price<");
  });

  test("no description, no title attribute", () => {
    const html = render({
      columns: [{ ...price, description: undefined }],
    });
    expect(html).not.toContain("title=");
  });

  test("renderHeader replaces the label", () => {
    const html = render({
      columns: [price],
      renderHeader: (c: { label: string; description?: string }) =>
        `${c.label} (${c.description})`,
    });
    expect(html).toContain("Price (Asking price incl. VAT)");
    expect(html).not.toContain("title=");
  });

  test("columns rebuilt in another locale render their own strings", () => {
    const de = col<Row>({
      id: "price",
      label: "Preis",
      description: "Angebotspreis inkl. MwSt.",
      type: ColumnTypes.CURRENCY,
    });
    const html = render({ columns: [de] });
    expect(html).toContain(">Preis<");
    expect(html).toContain('title="Angebotspreis inkl. MwSt."');
  });
});
