import { describe, expect, mock, test } from "bun:test";
import * as ExcelJS from "exceljs";
import { ColumnTypes } from "../examples/column-types";
import type { ExportCellContext } from "../src";
import { col, DAYS_DEFAULT_THRESHOLDS } from "../src";

mock.module("server-only", () => ({}));

const { buildXlsxStream } = await import("../src/server");

type Row = {
  make: string | null;
  priceWithVat: number | null;
  daysOnDisplayCalc: number | null;
  firstOccurence: string | null;
};

const columns = [
  {
    ...col<Row>({ id: "make", label: "Make", type: ColumnTypes.TEXT }),
    label: "Make",
  },
  {
    ...col<Row>({
      id: "priceWithVat",
      label: "Price",
      type: ColumnTypes.CURRENCY,
    }),
    label: "Price",
  },
  {
    ...col<Row>({
      id: "daysOnDisplayCalc",
      label: "Days",
      type: ColumnTypes.DAYS,
    }),
    label: "Days",
  },
  {
    ...col<Row>({
      id: "firstOccurence",
      label: "First seen",
      type: ColumnTypes.DATE,
    }),
    label: "First seen",
  },
];

const rows: Row[] = [
  {
    make: "Škoda",
    priceWithVat: 24900,
    daysOnDisplayCalc: 12,
    firstOccurence: "2026-05-12T00:00:00.000Z",
  },
  {
    make: "BMW",
    priceWithVat: 31200,
    daysOnDisplayCalc: 149,
    firstOccurence: null,
  },
];

const ctx: ExportCellContext = {
  colorsFor: (id) =>
    id === "daysOnDisplayCalc"
      ? { thresholds: DAYS_DEFAULT_THRESHOLDS }
      : undefined,
  enumLabel: () => null,
  currencySymbol: "€",
};

async function readBack(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.concat(chunks);
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("workbook has no worksheet");
  return sheet;
}

describe("buildXlsxStream", () => {
  test("writes a readable workbook with the header and every row", async () => {
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    expect(sheet.rowCount).toBe(rows.length + 1);
    expect(sheet.getRow(1).getCell(1).value).toBe("Make");
    expect(sheet.getRow(2).getCell(1).value).toBe("Škoda");
  });

  test("numbers and dates land as typed cells, not strings", async () => {
    // A stringified number cannot be summed or filtered numerically, which is
    // the whole reason to offer xlsx next to CSV.
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    expect(sheet.getRow(2).getCell(2).value).toBe(24900);
    expect(sheet.getRow(2).getCell(4).value).toBeInstanceOf(Date);
  });

  test("number formats survive the round trip", async () => {
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    expect(sheet.getRow(2).getCell(2).numFmt).toBe('#,##0" €"');
    expect(sheet.getRow(2).getCell(3).numFmt).toBe('#,##0" d"');
  });

  test("a resolved threshold paints the cell and its font", async () => {
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    // 12 days is the green bucket, 149 the red catch-all.
    const green = sheet.getRow(2).getCell(3);
    const red = sheet.getRow(3).getCell(3);
    expect(green.fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF009C5E" },
    });
    expect(red.fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFBF1F2C" },
    });
    expect(green.font?.color?.argb).toBe("FFFFFFFF");
  });

  test("a column with no resolved colour stays unfilled", async () => {
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    expect(sheet.getRow(2).getCell(2).fill).toEqual({
      type: "pattern",
      pattern: "none",
    });
  });

  test("the header row is frozen and filterable", async () => {
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:D3");
  });

  test("a null cell is empty rather than the string 'null'", async () => {
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Vehicles"),
    );
    expect(sheet.getRow(3).getCell(4).value).toBeNull();
  });

  test("sheet names are sanitised to what Excel accepts", async () => {
    // Excel rejects []:*?/\ and anything past 31 characters; a branch name
    // reaches this unfiltered.
    const sheet = await readBack(
      buildXlsxStream(rows, columns, ctx, "Emil Frey [AG]: Zürich/Nord*"),
    );
    expect(sheet.name).toBe("Emil Frey  AG   Zürich Nord");
    expect(sheet.name.length).toBeLessThanOrEqual(31);
  });
});
