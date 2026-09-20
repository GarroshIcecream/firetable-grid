import type { RowData } from "@tanstack/react-table";
import "server-only";

import { PassThrough, Readable } from "node:stream";
import * as ExcelJS from "exceljs";

import type { ExportCellContext } from "./export-cell";
import type { XlsxExportColumn } from "./xlsx-sheet";
import { sheetName, writeSheet } from "./xlsx-sheet";

export type { XlsxExportColumn } from "./xlsx-sheet";

async function writeWorkbook<TData extends RowData>(
  stream: PassThrough,
  rows: readonly TData[],
  columns: readonly XlsxExportColumn<TData>[],
  ctx: ExportCellContext<TData>,
  title: string,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet(sheetName(title), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  writeSheet(sheet, rows, columns, ctx);
  sheet.commit();
  await workbook.commit();
}

export function buildXlsxStream<TData extends RowData>(
  rows: readonly TData[],
  columns: readonly XlsxExportColumn<TData>[],
  ctx: ExportCellContext<TData>,
  title: string,
): ReadableStream<Uint8Array> {
  const stream = new PassThrough();
  // The writer runs alongside the response: PassThrough applies backpressure,
  // so the workbook is never fully resident. Buffering it instead costs ~2.4 GB
  // at 20k rows and takes the function down with it.
  writeWorkbook(stream, rows, columns, ctx, title).catch((error: unknown) => {
    stream.destroy(error instanceof Error ? error : new Error(String(error)));
  });
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}
