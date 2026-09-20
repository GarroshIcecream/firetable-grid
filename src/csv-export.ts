// CSV export for table views.
//
// Exports the rows the user is currently looking at (post-filter, post-sort)
// using only the columns currently visible in the table, in the column
// manager's current order. Output is UTF-8 with a BOM so Excel opens accents
// cleanly.
//
// Generic over `TData` so any table can reuse the same primitive
// later. Pure functions so the bulk of the logic is unit-testable; the
// download trigger is a thin helper around URL.createObjectURL / <a download>.

import type { ColumnVisibilityState, RowData } from "@tanstack/react-table";

import type { SchemaColumn } from "./column-schema";
import {
  type ExportCellContext,
  exportCellText,
  PLAIN_EXPORT_CONTEXT,
  resolveExportCell,
} from "./export-cell";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Selects the visible columns in the order TanStack would render them, then
 * filters out columns that have no plain data on the rows.
 *
 * Resolution rules:
 *   - the visual order is `columnOrder`; any schema columns missing from
 *     that list fall to the end in schema order (TanStack's own behaviour
 *     for a stale order, e.g. a saved view created before a schema column
 *     was added - we mirror it so the CSV matches what's on screen)
 *   - a column is visible unless `columnVisibility[id] === false`
 *   - non-manageable columns (`rowIndex`, `thumbnail`) are skipped - they
 *     are decorative and have no meaningful CSV representation
 *   - columns declared `exportable: false` are skipped - they trigger an
 *     action (the AI chat) rather than carry a value
 *   - computed columns (e.g. "Delta", "% Delta") are skipped - `col()`
 *     defaults `accessorKey` to the column id, so we can't rely on a
 *     missing accessor as a marker; instead we probe `rows` and drop any
 *     column where every row has `undefined` for the accessor (a real
 *     data column would have at least `null` for missing values)
 */
export function selectExportColumns<TData extends RowData>(
  schemaColumns: readonly SchemaColumn<TData>[],
  columnOrder: readonly string[],
  columnVisibility: ColumnVisibilityState,
  rows: readonly TData[] = [],
): SchemaColumn<TData>[] {
  const byId = new Map(schemaColumns.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const ordered: SchemaColumn<TData>[] = [];
  for (const id of columnOrder) {
    const col = byId.get(id);
    if (!col) continue;
    seen.add(id);
    if (!isExportable(col, columnVisibility, rows)) continue;
    ordered.push(col);
  }
  for (const col of schemaColumns) {
    if (seen.has(col.id)) continue;
    if (!isExportable(col, columnVisibility, rows)) continue;
    ordered.push(col);
  }
  return ordered;
}

function isExportable<TData extends RowData>(
  col: SchemaColumn<TData>,
  columnVisibility: ColumnVisibilityState,
  rows: readonly TData[],
): boolean {
  if (columnVisibility[col.id] === false) return false;
  if (!col.manageable) return false;
  if (!col.exportable) return false;
  if (!col.accessorKey) return false;
  if (rows.length === 0) return true;
  const key = col.accessorKey;
  // Real data columns always carry the property (even if its value is
  // null). Computed columns omit the property entirely, so their access
  // returns undefined on every row - that's the signal we use to drop
  // them from the export.
  for (const row of rows) {
    const v = (row as Record<string, unknown>)[key];
    if (v !== undefined) return true;
  }
  return false;
}

/**
 * Resolves the CSV-bound value for a single column on a single row via the
 * shared `resolveExportCell` projection, so a cell reads the same here as in
 * the xlsx workbook: dates flatten to ISO `YYYY-MM-DD`, numbers stay
 * unformatted, and enums become translated labels when `ctx` can resolve them.
 */
export function resolveCellValue<TData extends RowData>(
  row: TData,
  col: SchemaColumn<TData>,
  ctx: ExportCellContext<TData> = PLAIN_EXPORT_CONTEXT,
): string {
  return exportCellText(resolveExportCell(row, col, ctx));
}

/**
 * Escapes a value for inclusion in a CSV cell per RFC 4180. Wraps in double
 * quotes when the value contains a comma, double-quote, CR, or LF; embedded
 * double-quotes are doubled. Values without those characters are emitted
 * raw.
 */
export function escapeCsvCell(value: string): string {
  if (value === "") return "";
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Builds the CSV body string (no BOM). The BOM is added by `downloadCsv`
 * at the byte level so this function stays pure and easy to test.
 */
export function buildCsvString<TData extends RowData>(
  rows: readonly TData[],
  columns: readonly SchemaColumn<TData>[],
  ctx: ExportCellContext<TData> = PLAIN_EXPORT_CONTEXT,
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvCell(c.label)).join(","));
  for (const row of rows) {
    const cells = columns.map((c) =>
      escapeCsvCell(resolveCellValue(row, c, ctx)),
    );
    lines.push(cells.join(","));
  }
  // CRLF per RFC 4180. Excel handles either, but CRLF avoids occasional
  // mis-parses from older spreadsheet importers.
  return lines.join("\r\n");
}

/**
 * Builds a stable filename: `<prefix>_<scope>_<date>.csv`, or
 * `<prefix>_<date>.csv` when no scope is given.
 */
export function buildExportFilename(opts: {
  prefix: string;
  /** Optional middle segment, e.g. the filter or tenant the rows came from. */
  scope?: string | null;
  date?: Date;
  ext?: "csv" | "xlsx";
}): string {
  const date = opts.date ?? new Date();
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const ext = opts.ext ?? "csv";
  const slug = (opts.scope ?? "").trim();
  if (slug) return `${opts.prefix}_${slug}_${dateStr}.${ext}`;
  return `${opts.prefix}_${dateStr}.${ext}`;
}

// ---------------------------------------------------------------------------
// Browser-only download trigger
// ---------------------------------------------------------------------------

/**
 * Triggers a browser download for the given CSV string. Encodes the body
 * as UTF-8 with a BOM so Excel auto-detects the encoding and renders
 * non-ASCII characters (German umlauts, French accents, etc.) correctly.
 * No-op outside the browser so the helper is safe to import from server
 * code.
 */
export function downloadCsv(filename: string, csv: string): void {
  const BOM = "\uFEFF";
  downloadBlob(
    filename,
    new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" }),
  );
}

/**
 * Triggers a browser download for an already-built Blob — the xlsx path, where
 * the body is binary and must not be routed through a string. No-op outside the
 * browser so the helper is safe to import from server code.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Browsers keep object URLs alive until the document is unloaded; revoke
  // explicitly so we don't pin the (potentially large) blob in memory.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Formats every table export offers. Shared by the export dialog, the API
 *  routes and the client fetchers. */
export type TableExportFormat = "csv" | "xlsx";
