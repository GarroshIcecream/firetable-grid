// Browser-side workbook writer, for the tables that hold their whole row set in
// memory. The server's streaming writer exists because a paged table's export
// can reach 20k rows; here the rows are already resident, so a buffered write is
// both simpler and bounded by what the page is already holding.

import type { RowData } from "@tanstack/react-table";

import { type ExportCellContext, PLAIN_EXPORT_CONTEXT } from "./export-cell";
import type { XlsxExportColumn } from "./xlsx-sheet";
import { sheetName, writeSheet } from "./xlsx-sheet";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function buildXlsxBlob<TData extends RowData>(
  rows: readonly TData[],
  columns: readonly XlsxExportColumn<TData>[],
  title: string,
  ctx: ExportCellContext<TData> = PLAIN_EXPORT_CONTEXT,
): Promise<Blob> {
  // exceljs is ~900 KB; importing it here keeps it out of the page bundle and
  // on the click that actually needs it.
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName(title), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // No Column Registry colours on this path, and no translator: labels come
  // from each column's own `filterOptions`, which the client tables already
  // hold in the user's locale.
  writeSheet(sheet, rows, columns, ctx);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}
