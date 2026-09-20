// Sheet shaping shared by the two xlsx writers: the server's streaming one
// (`xlsx-export.ts`) and the browser's buffered one (`xlsx-client.ts`).
//
// Deliberately free of `server-only` and `node:stream` so both can import it —
// which is the point: a second copy of the header styling and number formats
// would drift, and the two formats are supposed to agree cell for cell.

import type { RowData } from "@tanstack/react-table";
import type * as ExcelJS from "exceljs";
import type { SchemaColumn } from "./column-schema";
import { type ExportCellContext, resolveExportCell } from "./export-cell";
import { paletteFillArgb, paletteShadeHex, paletteTextArgb } from "./palette";

const HEADER_FILL_ARGB = `FF${paletteShadeHex("gray", 10).slice(1).toUpperCase()}`;
const HEADER_TEXT_ARGB = `FF${paletteShadeHex("gray", 100).slice(1).toUpperCase()}`;

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 60;
const PX_PER_CHARACTER = 7;
const SHEET_NAME_MAX = 31;

export function sheetName(raw: string): string {
  const cleaned = raw.replace(/[[\]:*?/\\]/g, " ").trim();
  return cleaned.slice(0, SHEET_NAME_MAX) || "Export";
}

function columnWidth(px: number): number {
  const characters = Math.round(px / PX_PER_CHARACTER);
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, characters));
}

export interface XlsxExportColumn<TData extends RowData>
  extends SchemaColumn<TData> {
  readonly label: string;
}

/**
 * Writes the header and every row into an already-created worksheet.
 *
 * Row commits flush streaming rows and are no-ops on a plain Workbook.
 * Worksheet finalization belongs to the streaming writer.
 */
export function writeSheet<TData extends RowData>(
  sheet: ExcelJS.Worksheet,
  rows: readonly TData[],
  columns: readonly XlsxExportColumn<TData>[],
  ctx: ExportCellContext<TData>,
): void {
  sheet.columns = columns.map((column) => ({
    width: columnWidth(column.width),
  }));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: rows.length + 1, column: columns.length },
  };

  const header = sheet.addRow(columns.map((column) => column.label));
  header.font = { bold: true, color: { argb: HEADER_TEXT_ARGB } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL_ARGB },
  };
  header.alignment = { vertical: "middle" };
  header.commit();

  for (const row of rows) {
    const cells = columns.map((column) => resolveExportCell(row, column, ctx));
    const sheetRow = sheet.addRow(cells.map((cell) => cell.value));
    cells.forEach((cell, index) => {
      if (cell.numFmt === undefined && cell.color === undefined) return;
      const target = sheetRow.getCell(index + 1);
      if (cell.numFmt !== undefined) target.numFmt = cell.numFmt;
      if (cell.color !== undefined) {
        target.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: paletteFillArgb(cell.color) },
        };
        target.font = { color: { argb: paletteTextArgb(cell.color) } };
      }
    });
    sheetRow.commit();
  }
}
