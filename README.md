# firetable-grid

A schema-driven filter, sort, group and export engine for [TanStack Table](https://tanstack.com/table), generic over your row type.

It is **headless and rendering-agnostic**: it owns the *state and logic* behind a data grid — a serializable filter AST, multi-column sorting, date grouping, threshold and enum colouring, column layout, and CSV/XLSX export — and leaves the cells and chrome to you. You describe your columns once; the engine works off that description.

Extracted from FireTable, where it backs every table in the product.

```bash
bun add firetable-grid
```

Peer dependencies: `@tanstack/react-table` (>=9). `exceljs` only if you export XLSX, `server-only` only if you use the server entry point, `zod` only if you validate stored threshold config.

## The idea

A **column type** is how your data describes itself — is it a number, a date, an enum; can it be sorted, grouped, aggregated; how should it be filtered and formatted. You declare the catalogue your tables need, and every other feature reads from it.

The engine ships **no catalogue of its own**. `examples/column-types.ts` is a worked starting point covering the common cases (text, currency, dates, progress bars, trends, enum badges) — copy it and change it.

```ts
import { col, toColumnDefs, type ColumnType } from "firetable-grid";
import { ColumnTypes } from "./column-types";

const columns = [
  col<Row>({ id: "name",  label: "Name",  type: ColumnTypes.TEXT }),
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  col<Row>({ id: "added", label: "Added", type: ColumnTypes.DATE }),
];

// hand these straight to TanStack Table
const columnDefs = toColumnDefs(columns);
```

`col()` fills in the defaults implied by the type — filter operators, sortability, width, alignment — so a column declaration stays one line until it needs to say more.

## Filtering

Filter state is a flat, serializable AST, which is what makes a saved view a piece of JSON:

```ts
import { applyAST, EMPTY_FILTER_AST, type FilterAST } from "firetable-grid";

const ast: FilterAST = {
  ...EMPTY_FILTER_AST,
  search: "estate",
  and: [{ field: "price", op: "≤", val: "25000" }],
  orGroups: [[
    { field: "fuel", op: "is", val: "diesel" },
    { field: "fuel", op: "is", val: "hybrid" },
  ]],
};

const visible = applyAST(rows, ast, columns);
```

`and` conditions must all match; each group in `orGroups` must have at least one match. `search` matches columns flagged `searchable`. Values are stored as strings and multi-select enums serialize comma-joined, so an AST survives a round trip through a database column unchanged.

Use `projectFilterAST(ast, keep)` to narrow an AST — it preserves the per-boundary boolean operators that a naive rebuild silently drops.

## Export

CSV and XLSX both resolve cells through the same `ExportCellContext`, so an export matches what the grid shows — including threshold colours.

```ts
import { buildCsvString, buildExportFilename, exportRowsToFile } from "firetable-grid";

const csv = buildCsvString(rows, columns);
const name = buildExportFilename({ prefix: "report", scope: "emea", ext: "csv" });
// -> report_emea_2026-09-20.csv
```

`exportRowsToFile()` is the one-call browser path for both formats. XLSX has two entry points, and the split is deliberate:

- `firetable-grid` → `buildXlsxBlob()`, for the browser. `exceljs` (~900 KB) is imported on the click that needs it, never in your page bundle.
- `firetable-grid/server` → `buildXlsxStream()`, for a route handler. Guarded by `server-only` and streams through `node:stream`, so it can never reach a client bundle.

## Colour and theming

Thresholds and enum colours are expressed as `{ hue, level }` rather than raw CSS, so the same declaration drives a Tailwind class on screen and an ARGB fill in a spreadsheet.

Import the stylesheet once to get the shipped ramp — 14 hues × 11 stops, each derived from one base colour:

```ts
import "firetable-grid/styles/palette.css";
```

To rebrand, override the theme at start-up. Omitted keys keep their defaults:

```ts
import { configureGridTheme, DEFAULT_PALETTE, gridTheme } from "firetable-grid";

configureGridTheme({
  // change what renders on screen
  palette: { ...DEFAULT_PALETTE, red: { ...DEFAULT_PALETTE.red, dark: { ...DEFAULT_PALETTE.red.dark, bg: "bg-brand-danger" } } },
  // change what the XLSX export writes
  baseHex: { ...gridTheme().baseHex, green: "#00a86b" },
});
```

The class names and the export hexes are two halves of one contract: `styles/palette.css` drives the screen, `baseHex` drives the spreadsheet, and nothing links them but that contract. `tests/palette-hex.test.ts` is the guard — it replays the CSS `color-mix()` weights in TypeScript and fails if the two drift. If you change one, change the other.

Call `configureGridTheme()` before anything renders: helpers read the active theme at call time, so a later change will not repaint what is already on screen.

## What else is in the box

| | |
|---|---|
| `sorting-state` | multi-column sort state, capped and normalized |
| `date-grouping` | group dates by day/week/month/quarter/year, with injectable relative labels |
| `threshold` / `threshold-schema` | value→colour bands, plus zod schemas for validating stored config |
| `stagedDayThresholdListSchema(n)` | N ordered whole-day bounds plus a catch-all, for staged status indicators |
| `enum-color` | per-value colours for enum columns |
| `column-category-layout` | grouping columns into reorderable category blocks |
| `derived-options` | filter options computed from the data when the set is not fixed |
| `footer-aggregate-query` / `format-footer-aggregate` | footer aggregates; formatting takes any `{ number() }` formatter, so your i18n library drops straight in |

Both snippets above live in `examples/` as compiling code — `bun run typecheck` covers them, so a change that breaks the documented API breaks the build.

## Development

```bash
bun install
bun test          # 207 tests
bun run typecheck
bun run lint
```

## License

MIT
