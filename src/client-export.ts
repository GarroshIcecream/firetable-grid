"use client";

// Builds an export from rows already in memory, for the tables that hold their
// whole row set client-side. The server-paged tables go through their own
// endpoint instead — there the file has to cover rows no page has loaded.
//
// Both formats come out of the same column projection as the server routes, so
// a CSV and a workbook of the same view agree cell for cell.

import type { RowData } from "@tanstack/react-table";

import type { SchemaColumn } from "./column-schema";
import {
  buildCsvString,
  downloadBlob,
  downloadCsv,
  selectExportColumns,
  type TableExportFormat,
} from "./csv-export";
import { type ExportCellContext, PLAIN_EXPORT_CONTEXT } from "./export-cell";

export async function exportRowsToFile<TData extends RowData>({
  rows,
  schemaColumns,
  columnOrder,
  columnVisibility,
  columnIds,
  format,
  filename,
  sheetName,
  cellContext = PLAIN_EXPORT_CONTEXT,
}: {
  rows: readonly TData[];
  schemaColumns: SchemaColumn<TData>[];
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  /** Ids the user left checked in the export dialog. */
  columnIds: string[];
  format: TableExportFormat;
  filename: string;
  sheetName: string;
  cellContext?: ExportCellContext<TData>;
}): Promise<void> {
  const chosen = new Set(columnIds);
  const columns = selectExportColumns(
    schemaColumns,
    columnOrder,
    columnVisibility,
    rows,
  ).filter((column) => chosen.has(column.id));
  if (columns.length === 0) return;

  if (format === "csv") {
    downloadCsv(filename, buildCsvString(rows, columns, cellContext));
    return;
  }

  // exceljs is ~900 KB and only this branch needs it, so it loads on the click
  // rather than with the page.
  const { buildXlsxBlob } = await import("./xlsx-client");
  downloadBlob(
    filename,
    await buildXlsxBlob(rows, columns, sheetName, cellContext),
  );
}
