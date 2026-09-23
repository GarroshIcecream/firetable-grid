import type { RowData } from "@tanstack/react-table";
import type { FilterOption, SchemaColumn } from "./column-schema";
import { toLocalYmd, toYmd, ymdToLocalDate } from "./date-grouping";
import { type EnumColorMap, resolveEnumColor } from "./enum-color";
import type { PaletteColor } from "./palette";
import { ratioToFlooredPercent } from "./ratio";
import { resolveThresholdColor, type ThresholdList } from "./threshold";

export interface ExportCell {
  readonly value: string | number | Date | null;
  readonly numFmt?: string;
  readonly color?: PaletteColor;
  // Plain-text rendering, when it cannot be derived from `value` alone. A
  // spreadsheet applies `numFmt` to reach what the grid shows; CSV has no
  // format layer, so a scaled column has to carry its displayed text here.
  readonly text?: string;
}

interface ExportColumnColors {
  readonly thresholds?: ThresholdList;
  readonly enumColors?: EnumColorMap;
}

export interface ExportCellContext<TData = unknown> {
  colorsFor: (columnId: string) => ExportColumnColors | undefined;
  enumLabel: (columnId: string, value: string) => string | null;
  /**
   * Symbol for the currency the exported rows are priced in. Feed prices are
   * Values are never converted, so a CZK sheet must not say "€".
   * Use a row callback when an export can span more than one currency.
   */
  currencySymbol: string | ((row: TData) => string);
}

// Surfaces with no Column Registry and no translator — the client-built
// exports. Labels still resolve from the column's own `filterOptions`, which
// those tables already carry in the user's locale.
export const PLAIN_EXPORT_CONTEXT: ExportCellContext = {
  colorsFor: () => undefined,
  enumLabel: () => null,
  currencySymbol: "€",
};

const CURRENCY_FORMAT = '#,##0" {cur}"';

/** The currency template carries `{cur}` where the symbol goes, so a
 *  multi-currency export substitutes once per row. */
function withCurrency(numFmt: string, symbol: string): string {
  return numFmt.replace("{cur}", symbol);
}

/** The mantissa an Excel number format needs for `count` decimal places:
 *  `0`, `0.0`, `0.00` … */
function mantissa(count: number): string {
  return count > 0 ? `0.${"0".repeat(count)}` : "0";
}

function quoteLiteral(text: string): string {
  return `"${text.replace(/"/g, "")}"`;
}

// ── Per-column work, hoisted out of the per-cell loop ──────────────────────
//
// A number format and an enum's label lookup are fixed for a whole column, but
// both used to be rebuilt for every cell: a 20,000-row export re-derived the
// same format string 20,000 times per numeric column, and resolved each enum
// label by scanning `filterOptions` from the top. Both cache on the object
// they describe - columns come out of `col()` once and are treated as
// immutable - so a `WeakMap` keeps the entry alive exactly as long as the
// caller keeps the column.

const numericFormatCache = new WeakMap<object, Map<string, string>>();

function numericFormatFor<TData extends RowData>(
  col: SchemaColumn<TData>,
  currencySymbol: string,
): string {
  let bySymbol = numericFormatCache.get(col);
  if (!bySymbol) {
    bySymbol = new Map();
    numericFormatCache.set(col, bySymbol);
  }
  // Keyed by symbol as well as column: a multi-currency export resolves a
  // different symbol per row, and they must not share one cached format.
  const hit = bySymbol.get(currencySymbol);
  if (hit !== undefined) return hit;
  const computed = numericFormat(col, currencySymbol);
  bySymbol.set(currencySymbol, computed);
  return computed;
}

const optionLabelCache = new WeakMap<object, Map<string, string>>();

/** `value` → `label` for a column's `filterOptions`. First entry wins, which
 *  is what the `Array.prototype.find` this replaced did. */
function optionLabels(options: readonly FilterOption[]): Map<string, string> {
  let byValue = optionLabelCache.get(options);
  if (!byValue) {
    byValue = new Map();
    for (const option of options) {
      if (!byValue.has(option.value)) byValue.set(option.value, option.label);
    }
    optionLabelCache.set(options, byValue);
  }
  return byValue;
}

function numericFormat<TData extends RowData>(
  col: SchemaColumn<TData>,
  currencySymbol: string,
): string {
  if (col.type.ratioStored) return "0%";
  const prefix = col.type.formatPrefix;
  // A euro prefix and `numberFormat: "currency"` describe the same cell — the
  // grid renders both through Intl `style: "currency"` — so they must not
  // diverge into a symbol-before and a symbol-after format here.
  if (col.numberFormat === "currency" || prefix?.includes("€")) {
    return withCurrency(CURRENCY_FORMAT, currencySymbol);
  }
  // `decimals` is the column's own precision; each format carries the place
  // count it reads as by default. A conversion rate below 1% is the case that
  // forces this to be expressible: `#,##0"%"` prints every one of them as 0%.
  const decimals = col.decimals;
  if (col.numberFormat === "percent") return `${mantissa(decimals ?? 1)}"%"`;
  if (col.numberFormat === "decimal") return mantissa(decimals ?? 1);
  if (col.numberFormat === "integer") return "0";
  const grouped =
    decimals && decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
  const suffix = col.type.formatSuffix;
  if (prefix) return `${quoteLiteral(prefix)}${grouped}`;
  if (suffix) return `${grouped}${quoteLiteral(suffix)}`;
  return grouped;
}

// A date cell carries a calendar day, not an instant, so it resolves through
// the same rule as filtering and grouping (see `./date-grouping`): a string
// contributes its literal YYYY-MM-DD prefix, read as LOCAL midnight. Handing
// the string to `new Date()` instead would parse it as UTC midnight, which
// ExcelJS then writes at its local wall clock - the 19th, for a date-only
// string, anywhere west of Greenwich.
function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string") return null;
  const local = ymdToLocalDate(toYmd(raw));
  if (local) return local;
  // No YYYY-MM-DD prefix: fall back to the platform parser so a locale format
  // ("Sep 20, 2026") still exports rather than dropping to blank.
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function colorFor<TData extends RowData>(
  col: SchemaColumn<TData>,
  value: string | number,
  ctx: ExportCellContext<TData>,
): PaletteColor | undefined {
  const colors = ctx.colorsFor(col.id);
  if (!colors) return undefined;
  if (typeof value === "number") {
    return colors.thresholds
      ? resolveThresholdColor(value, colors.thresholds)
      : undefined;
  }
  return colors.enumColors
    ? resolveEnumColor(value, colors.enumColors)
    : undefined;
}

// The grid never shows a stored code — it shows a translated label, and for a
// set-valued column a list of them. Resolution order per token: the surface's
// translator, then the column's own `filterOptions` (already localized on the
// client tables, which have no translator here), then the raw token.
function displayLabel<TData extends RowData>(
  col: SchemaColumn<TData>,
  text: string,
  ctx: ExportCellContext<TData>,
): string {
  // Scalar column: one token, so resolve it directly rather than routing a
  // single value through split/map/filter/map/join.
  if (!col.type.setValued) {
    const token = text.trim();
    return token === "" ? "" : labelForToken(col, token, ctx);
  }
  const labels: string[] = [];
  for (const raw of text.split(",")) {
    const token = raw.trim();
    if (token === "") continue;
    labels.push(labelForToken(col, token, ctx));
  }
  return labels.join(", ");
}

function labelForToken<TData extends RowData>(
  col: SchemaColumn<TData>,
  token: string,
  ctx: ExportCellContext<TData>,
): string {
  const translated = ctx.enumLabel(col.id, token);
  if (translated) return translated;
  const options = col.filterOptions;
  if (!options) return token;
  return optionLabels(options).get(token) ?? token;
}

export function resolveExportCell<TData extends RowData>(
  row: TData,
  col: SchemaColumn<TData>,
  ctx: ExportCellContext<TData>,
): ExportCell {
  const raw = (row as Record<string, unknown>)[col.accessorKey ?? col.id];
  if (raw === null || raw === undefined) return { value: null };

  // A catalogue-backed column stores an opaque token (`MAKE_AUDI`,
  // `MAKE_AUDI-MODELFAMILY_Q2`) and carries the label the grid shows on a
  // sibling field the server resolved. Without this the file reads the raw
  // accessor and the user gets the token instead of "Audi".
  if (col.labelKey) {
    const label = (row as Record<string, unknown>)[col.labelKey];
    if (typeof label === "string" && label !== "") return { value: label };
    if (
      Array.isArray(label) &&
      label.every((item) => typeof item === "string")
    ) {
      return { value: label.length > 0 ? label.join("; ") : null };
    }
  }

  if (col.type.dataType === "date") {
    return { value: toDate(raw), numFmt: "dd mmm yyyy" };
  }

  // Enum first, and on the declared type rather than the runtime one: the row
  // value for `carRating` is a number while its labels and enum colours are
  // keyed on the strings "1".."5", so a typeof check would export a bare digit.
  if (col.type.dataType === "enum") {
    const text = String(raw);
    if (text === "") return { value: null };
    return {
      value: displayLabel(col, text, ctx),
      color: colorFor(col, text, ctx),
    };
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { value: null };
    // A floored ratio cannot be expressed as a spreadsheet format - Excel's
    // `0%` rounds - so both formats carry the points the grid prints. Colour
    // still resolves from the stored ratio, which is where thresholds live.
    if (col.type.ratioFloor) {
      return {
        value: ratioToFlooredPercent(raw),
        numFmt: '0"%"',
        color: colorFor(col, raw, ctx),
      };
    }
    return {
      value: raw,
      numFmt: numericFormatFor(
        col,
        typeof ctx.currencySymbol === "function"
          ? ctx.currencySymbol(row)
          : ctx.currencySymbol,
      ),
      color: colorFor(col, raw, ctx),
      // A ratio column stores 0..1 and the grid prints `round(v * 100)%`. The
      // workbook reaches that through `0%`; the CSV has to carry the scaled
      // number itself or it reads as a hundredth of what the table shows.
      ...(col.type.ratioStored
        ? { text: String(Math.round(raw * 100)) }
        : undefined),
    };
  }

  if (typeof raw === "boolean") return { value: raw ? "true" : "false" };

  const text = String(raw);
  if (text === "") return { value: null };
  return {
    value: displayLabel(col, text, ctx),
    color: colorFor(col, text, ctx),
  };
}

export function exportCellText(cell: ExportCell): string {
  if (cell.text !== undefined) return cell.text;
  const { value } = cell;
  if (value === null) return "";
  // Local day, matching what ExcelJS writes for the same Date and what
  // `toYmd` reports to the filter and grouping paths.
  if (value instanceof Date) return toLocalYmd(value);
  if (typeof value === "number") return String(value);
  return value;
}
