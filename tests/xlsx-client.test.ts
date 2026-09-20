import { describe, expect, test } from "bun:test";
import * as ExcelJS from "exceljs";
import { ColumnTypes } from "../examples/column-types";
import { buildXlsxBlob, col, PLAIN_EXPORT_CONTEXT } from "../src";

type Row = { title: string; price: number; symbol?: string };

describe("client Excel exports", () => {
  const columns = [
    col<Row>({
      id: "title",
      label: "Title",
      type: ColumnTypes.TEXT,
    }),
    col<Row>({
      id: "price",
      label: "Price",
      type: ColumnTypes.CURRENCY,
    }),
  ];

  test("downloads a readable workbook with data, a frozen header and filters", async () => {
    const blob = await buildXlsxBlob(
      [{ title: "Škoda", price: 25000 }],
      columns,
      "Issues",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.worksheets[0];

    expect(sheet.name).toBe("Issues");
    expect(sheet.getRow(1).values).toEqual([undefined, "Title", "Price"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "Škoda", 25000]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:B2");
  });

  test("keeps each market's currency without converting the prices", async () => {
    const rows = [
      { title: "CZ", price: 500000, symbol: "Kč" },
      { title: "PL", price: 85000, symbol: "zł" },
      { title: "DE", price: 20000, symbol: "€" },
    ];
    const blob = await buildXlsxBlob(rows, columns, "Hitlist", {
      ...PLAIN_EXPORT_CONTEXT,
      currencySymbol: (row) => row.symbol ?? "€",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.worksheets[0];

    for (const [index, row] of rows.entries()) {
      const cell = sheet.getRow(index + 2).getCell(2);
      expect(cell.value).toBe(row.price);
      expect(cell.numFmt).toBe(`#,##0" ${row.symbol}"`);
    }
  });
});
