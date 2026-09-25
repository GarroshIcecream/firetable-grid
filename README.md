# firetable-grid

[![npm](https://img.shields.io/npm/v/firetable-grid)](https://www.npmjs.com/package/firetable-grid) [![Publish](https://github.com/GarroshIcecream/firetable-grid/actions/workflows/publish.yml/badge.svg)](https://github.com/GarroshIcecream/firetable-grid/actions/workflows/publish.yml)

A schema-driven filter, sort, group and export engine for [TanStack Table](https://tanstack.com/table), generic over your row type.

It is **headless and rendering-agnostic**: it owns the *state and logic* behind a data grid — one serializable view object holding search, filter, sort and grouping, date grouping, threshold and enum colouring, column layout, and CSV/XLSX export — and leaves the cells and chrome to you. You describe your columns once; the engine works off that description.

Extracted from FireTable, where it backs every table in the product.

```bash
bun add firetable-grid
```

Peer dependencies: `@tanstack/react-table` (>=9). Everything else is optional: `exceljs` only if you export XLSX, `server-only` only if you use the server entry point, `zod` only if you import `firetable-grid/schema` to validate stored config.

The package root is free of all three — it bundles to a few KB — because each lives behind its own entry point or a dynamic import. `tests/entry-points.test.ts` walks the import graph and fails if one leaks back into the root.

## The idea

A **column type** is how your data describes itself — is it a number, a date, an enum; can it be sorted, grouped, aggregated; how should it be filtered and formatted. You declare the catalogue your tables need, and every other feature reads from it.

The engine ships **no catalogue of its own**. `examples/column-types.ts` is a worked starting point covering the common cases (text, currency, dates, progress bars, trends, enum badges) — copy it and change it.

```ts
import { col, toColumnDefs, type ColumnType } from "firetable-grid";
import { ColumnTypes } from "./column-types";

// Fixed strings for brevity. In an app that switches locale, build these
// inside a component from your translator; see "Translating columns (i18n)".
const columns = [
  col<Row>({ id: "name",  label: "Name",  type: ColumnTypes.TEXT }),
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  col<Row>({ id: "added", label: "Added", type: ColumnTypes.DATE }),
];

// hand these straight to TanStack Table
const columnDefs = toColumnDefs(columns);
```

`col()` fills in the defaults implied by the type — filter operators, sortability, width, alignment — so a column declaration stays one line until it needs to say more.

**How a number reads is metadata, never a lookup on the renderer's name.** A
type declares `numberFormat` (`currency` / `percent` / `decimal` / `integer`),
`decimals`, `formatPrefix` / `formatSuffix` and `ratioStored`; a single column
overrides `numberFormat` and `decimals` the way it overrides `unit`. The CSV,
the XLSX number format and the footer aggregate all derive from those, so a
rate that reads `0.25 %` on screen exports as `0.25 %` and not as `0 %`:

```ts
LISTING_RATE: {
  dataType: "number", cellRenderer: "listingConversion", filterType: "numeric",
  sortable: true, groupable: false, aggregatable: false,
  formatSuffix: "%", numberFormat: "percent", decimals: 2,
}
```

`decimals` defaults to one place for `percent` and `decimal`, none elsewhere.

## The view

Everything a user can do to a table — search, filter, sort, group, and the
column layout — is one serializable object, one field each. That is what makes a
saved view a piece of JSON rather than five things you have to reassemble:

```ts
import {
  all,
  any,
  applyView,
  FILTER_OP,
  type GridView,
  where,
} from "firetable-grid";

const { is, lte } = FILTER_OP;

const view: GridView = {
  search: "estate",
  filter: all(
    where("price", lte, "25000"),
    any(where("fuel", is, "diesel"), where("fuel", is, "hybrid")),
  ),
  sort: [{ field: "price", dir: "asc" }],
  group: { field: "fuel" },
  columns: { order: ["name", "price"], pinned: ["name"], sizes: { price: 160 } },
};

const visible = applyView(rows, view, columns);   // search + filter
```

Operators are stored as the symbol itself — `"≥"`, not `"gte"` — so a saved
view still reads as what it means when a human opens the JSON. You never have to
type one: `FILTER_OP` names every operator, and the two spellings are the same
value.

```ts
import { FILTER_OP, where } from "firetable-grid";

where("price", FILTER_OP.lte, "25000");   // identical to where("price", "≤", "25000")
```

`emptyGridView()` returns a fresh default — its own object and its own arrays
every call, so building one up by mutation can never reach into another view.
`isGridViewEmpty(view)` is the "nothing set" check a reset button wants.

A view is plain JSON with no functions in it: `JSON.stringify(view)` is the
whole of persisting one.

Every field of `columns` is optional — including `columns` itself. Absent means
*this view does not track that*, which is a real state: a preset view stores no
layout, and loading it leaves the current columns alone.

### Unsaved changes

`diffView(current, baseline)` answers "does this view have unsaved changes?",
and names which fields moved so a UI can say more than yes:

```ts
const { dirty, changed } = diffView(view, savedView);  // changed: ["sort", "columns"]
```

`baseline` is a `Partial<GridView>`: **a key it does not carry is not
compared**. That is what stops a preset view — which stores no column layout —
flagging dirty the moment it loads. Presence is tested with `in`, so
`filter: null` ("explicitly unfiltered") stays distinguishable from an absent
`filter` ("not tracked"). `isViewDirty` is the boolean shorthand.

Comparison is structural rather than `JSON.stringify`, because a view stored in
Postgres `jsonb` comes back with its keys reordered; pins and visibility compare
as sets, since neither has meaningful order.

### Filtering

A filter is a tree. `where` tests one column; `all` and `any` combine — at any
depth, so `(a AND (b OR c))` is expressible and a two-level builder is simply
one that chooses not to nest. `filter: null` means unfiltered, and a branch with
no children matches everything, so a filter row the user has started but not
finished narrows nothing instead of emptying the grid mid-edit.

Condition values are strings: a date range packs as `"from|to"`, a multi-select
enum comma-joins. The wire format is stable and readable, so a stored view stays
diffable and a human can fix one by hand.

`search` matches columns flagged `searchable`, and always AND-gates the filter —
a query narrows what the filter selected, whatever boolean shape it has.

Use `projectFilter(filter, keep)` to narrow a filter to the conditions you want
— it drops branches that lose every child and unwraps one left holding a single
child. `countConditions(filter)` counts the leaves, which is what a "3 filters
active" badge wants.

`compileView(view, columns)` returns the row predicate itself if you want to
stream rows or filter on a server; `applyView` is the array convenience over it.

### Sorting

Sort rules are `{ field, dir }`, matching the `field` a condition names and
reading as itself in stored JSON. TanStack's `{ id, desc }` is confined to
`toTanstackSorting` / `fromTanstackSorting` — nothing else in the engine, or in
your code, has to know that shape exists.

### Selection

`enableSelection` prepends a checkbox column. It needs `getRowId` and is
ignored without it — a selection keyed on row position follows the wrong rows
through a sort, which is worse than no selection.

Clicking a checkbox toggles that row and leaves the rest alone; shift-click
extends a range from the last row clicked; the header checkbox is tri-state
over the visible rows, and each group header selects its own group without
disturbing the others. (`resolveSelectionClick` still offers the file-manager
reading — a bare click that replaces the selection — to a caller wiring up
clicks on the row body; `checkboxClick` is the checkbox's own modifiers.)

The range spans the rows **as rendered**, from the flat item list — so
shift-clicking across a collapsed group selects what you can see and nothing
hidden underneath. That logic is `resolveSelectionClick`, `selectionStateOf`
and `toggleIds`, all pure and usable without the component.

Selection state deliberately stays **out of `GridView`**: it is ephemeral, like
the collapsed-group set. Nobody wants a four-hundred-row selection restored
from a link three weeks later.

### Virtualization and paging

All **opt-in**:

```tsx
virtualize={{ rowHeight: 36, overscan: 8 }}   // vertical row window
virtualizeColumns={{ overscan: 2 }}         // horizontal column window
onEndReached={fetchNextPage} endReachedThreshold={8}
```

Opt-in on purpose. Virtualization fails *quietly* rather than loudly —
find-in-page stops finding unrendered rows, printing shows only the window, a
screen reader sees a partial table unless you set `aria-rowcount` yourself, and
a test asserting "all 40 rows render" starts failing. A fifty-row grid should
pay none of that. It is also not auto-enabled above some row count: behaviour
that changes discontinuously with data size gives you "works at 50 rows, breaks
at 500", which is the worst kind of bug report.

`virtualizeColumns` mounts columns intersecting the scroll frame, plus the
requested number of neighboring columns on each side (default: 2). It uses
schema widths and `view.columns.sizes`; headers, body, and footer share one
window. Pinned columns always remain mounted, as does the column containing
focus or an active resize/reorder. Full table width and original column indices
are preserved; the table exposes `aria-colcount` and cells expose `aria-colindex`.
Column virtualization works with either row virtualization path or without one.
It currently assumes left-to-right layout and declared pixel widths.

Unfocused offscreen cells unmount. Store committed edits outside the cell; local
component state resets after unmounting. Retaining a focused column does not
retain its row when that row leaves the vertical window. Find-in-page and print
only include mounted content. All pinned columns render even when they exceed
the viewport width.

`virtualize` needs **every row and every group header to be `rowHeight` tall**.
For variable heights, drive it from your own virtualizer instead — anything
whose items carry `{ index, start, end }`, which is what
`@tanstack/react-virtual`'s `getVirtualItems()` returns:

```tsx
virtualItems={rowVirtualizer.getVirtualItems()} totalSize={rowVirtualizer.getTotalSize()}
```

Nothing here imports that package at runtime, so it stays an optional peer —
the same arrangement `useColumnResizePreview` uses.

**`endReachedThreshold` must stay below your page size.** Above it, the page
that lands is itself inside the threshold, so it fires again immediately and
the fetches chain until the data runs out. The callback is re-armed by the
loaded row count, so one edge cannot fire twice.

The windowing maths is `fixedRowWindow` and `reachedEndOfRows`, both pure and
on the `layout` subpath; `buildVirtualRenderPlan` handles the bring-your-own
case. All three are usable without the component.

### Footer aggregates

Client footer totals are batched in one row traversal for the mounted columns
that need local values, then cached across scrolling and selection. Columns
that scroll out and back in reuse their totals. Replacing rows, columns, or
`footerAggregations` / `footerValues` maps invalidates that cache; keep these
inputs immutable and accessors pure. Server-provided totals (including explicit
`null`) skip local computation, and server mode never derives a total from a
loaded page.

For custom renderers, `computeRowsAggregates` from `firetable-grid/layout` accepts
raw rows and an array of `{ key, aggregation, read? }` requests, returning nullable
numbers in request order. `read` overrides the data key. The existing
`computeRowsAgg` single-column API remains available unchanged.

`footerAggregations` maps a column id to one of `avg`, `sum`, `min`, `max` or
`count`, and the grid renders a sticky `<tfoot>`. A column with no entry, or
whose type is not `aggregatable`, renders an empty cell rather than a zero.
`numberFormatter` is required — the engine holds no locale, and next-intl's
`useFormatter()` satisfies it as-is.

Aggregates run over every row the view selected, not the rendered window, so
the footer does not change as you scroll.

**With paged data, pass `footerValues`.** Server-computed aggregates win over
the loaded rows, because the loaded slice drifts from the real total as pages
arrive and a local sum would confidently understate it. An explicit `null` from
the server is an answer, not a miss — it will not fall back to a local number
computed over a different set of rows.

```ts
footerValues={{ price: { sum: 4_211_900 } }}     // beats any local computation
```

`renderCheckbox` and `renderFooterCell` replace the bare defaults; the package
ships no UI kit.

## Export

CSV and XLSX both resolve cells through the same `ExportCellContext`, so an export matches what the grid shows — including threshold colours.

**Dates.** A date-only value (`2026-05-12`) exports as local midnight of that
day. A datetime (`2026-05-12T08:30:00Z`) keeps its time in the workbook and
gets an `hh:mm` format. The CSV writes only the day, the literal `YYYY-MM-DD`
prefix that filtering and grouping use.

**Zero on a trend.** A column type with `neutralZero: true` colours exactly 0
neutral grey, whatever its thresholds say, so a `{ upTo: 0, red }` bucket does
not show "no change" as a decline. Pass the column's type to
`resolveThresholdColor(value, thresholds, column.type)` in your cell renderer
so the grid agrees with the export. `TREND` in `examples/column-types.ts` sets
it.

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

## The grid component (`firetable-grid/react`)

If you want a table rather than parts, `<DataGrid>` assembles the engine and the
layout layer for you. **Column resizing is on by default**; **drag-to-reorder is
opt-in** via `reorderable`.

```tsx
import { DataGrid } from "firetable-grid/react";
import "firetable-grid/styles/grid.css";

<DataGrid
  rows={rows}
  columns={columns}
  renderCell={(column, row) => <Cell column={column} row={row} />}
/>;
```

That is the whole minimal call — the view and collapsed groups are uncontrolled
until you pass them, so sorting and resizing work with no wiring. Pass either
with its `on…Change` partner to take control and persist it:

```tsx
<DataGrid
  rows={rows} columns={columns} renderCell={renderCell}
  getRowId={(row) => row.id}                     // stable row identity
  view={view} onViewChange={setView}             // search, filter, sort, group, columns
  enableSelection                                // adds a checkbox column
  selectedRowIds={selected} onSelectionChange={setSelected}
  footerAggregations={{ price: "avg" }}          // one aggregation per column id
  numberFormatter={formatter}                    // required for a footer
  reorderable                                    // opt in to drag-to-reorder
  categoryOf={(id) => CATEGORY[id]}              // optional: confine a drag
  denseCellRenderers={DENSE_CELL_RENDERERS}      // module consts — see below
  skeletonShapes={SKELETON_SHAPES}
/>;
```

`renderCell` keeps the cell DOM yours — the component owns layout, sticky
offsets, ordering, sizing and grouping, and tells you which renderer a column
wants via `column.type.cellRenderer`.

**The two renderer-name lists are yours.** `denseCellRenderers` names the
renderers that hold a fixed-size graphic and take the tight gutter;
`skeletonShapes` gives the loading placeholder its shape, falling back to
`"text"`. The engine ships neither — `examples/column-types.ts` exports a
worked pair next to the catalogue they describe. **Keep both as module
constants**: the per-column cell specs memoize on their identity, so a literal
in the JSX rebuilds every one of them on every render.

**Pass `getRowId`.** Without it rows key on their position, so a filter, a sort
or an arriving page makes React reuse one row's DOM for another — which bleeds
cell state (an open popover, a focused input) from one row into the next.

**Sorting is multi-column** — click a header to cycle asc → desc → off,
shift-click to add a column to the sort. It runs through `toggleSort`,
so a column that stops being sortable drops out on the next click. Pass
`multiSort={false}` for single-column only. When more than one column is
sorted each header shows its rank next to the arrow.

**`columnVisibility` is read-only.** The grid ships no column manager, so
nothing inside it writes there — yours owns the state and passes it down. A
column absent from the record is visible; seed it with `buildVisibility(columns)`
to start from the schema's own `visible` flags, which is what the grid does when
you leave the prop off. It is the same record `selectExportColumns()` and
`buildFooterAggregateQuery()` read, so hiding a column drops it from the screen,
the export and the footer query together.

**Reordering** runs on native HTML5 drag events; there is no drag-and-drop
library. The hook only produces the `(active, over)` pair and
`moveColumnWithinCategory()` decides the result, which is what stops a drag
tearing a column out of its category. Frozen columns are excluded, because a
pinned column drifting out of the frozen block would leave the sticky offsets
describing an order that no longer exists. Pass `categoryOf` to confine drags to
a bucket; omit it and every column shares one, i.e. free reordering.

**Resizing** writes straight to the CSS custom properties on the frame, so a
drag never re-renders a cell — at 150 columns by 35 visible rows, committing to
state per pointer frame would re-render thousands of memoized cells a second.
State is touched once, on pointer-up. The handle is focusable: ←/→ resize by
8px, Shift+←/→ by 32px. Pass `resizable={false}` to turn it off.

`styles/grid.css` carries only what the grid cannot work without — the handle's
hit area, drag affordances, sticky stacking. Colour, borders and fonts are
yours; the classes are all `.ftg-*`.

## Translating columns (i18n)

The engine holds no locale and no i18n library. A column's `label` and
`description` are plain display strings, so translation happens where you build
the columns. Build them inside a component from your translator, not at module
level:

```tsx
function CarsGrid({ rows }) {
  const t = useTranslations();            // next-intl; react-i18next's `t` works too

  const columns = useMemo(() => [
    col<Car>({
      id: "price",
      label: t("cars.price"),
      description: t("cars.price.description"),   // header tooltip
      type: ColumnTypes.CURRENCY,
    }),
    col<Car>({
      id: "status",
      label: t("cars.status"),
      type: ColumnTypes.BADGE,
      filterOptions: STATUSES.map((value) => ({ value, label: t(`cars.status.${value}`) })),
    }),
  ], [t]);                                // with react-i18next, depend on `i18n.language`

  return <DataGrid rows={rows} columns={columns} renderCell={renderCell} />;
}
```

**A locale switch shows up on the next render.** A new locale gives a new `t`,
the memo rebuilds the columns, and `<DataGrid>` derives everything from the
`columns` prop instead of copying it into state, so the new headers appear
immediately. **Nothing in the view resets:** order, widths, visibility, pins,
sort, filters, groups and selection are all keyed by column id and raw value,
never by a display string. An enum filter stores `"sold"`, not `"Verkauft"`, so
an active filter keeps matching, and a view saved in one locale opens in
another. The CSV and XLSX headers read the same `label`, so exports follow the
locale too.

**`description`** is shown as the header label's native `title` tooltip. To use
your own tooltip component, pass `renderHeader`, which replaces the label with
whatever you render. The sort mark and resize handle stay the grid's:

```tsx
<DataGrid
  columns={columns}
  renderHeader={(column) => (
    <Tooltip content={column.description}>{column.label}</Tooltip>
  )}
  …
/>
```

The other locale-dependent inputs are passed in the same way:
`numberFormatter` (next-intl's `useFormatter()` fits as-is), `emptyMessage`,
`renderCheckbox`, and the relative labels in `date-grouping`.

**Still English:** the grid's own accessibility labels ("Select all rows",
"Resize …"), and the `FILTER_OP` values, which are both the stored operator and
its default display text. If your filter UI shows operators, map them to
translated labels there.

`examples/i18n.tsx` is this pattern as compiling code.

## Layout (`firetable-grid/layout`)

The engine gives you rows; this is the half that renders them as a virtualized
grid with frozen columns — the part most reimplementations get wrong twice.

```ts
import {
  buildFlatItems,
  buildColumnLayout,
  buildCellSpecs,
  columnWidth,
  displayRowPosition,
} from "firetable-grid/layout";

// group headers and rows interleaved into one virtualizable list
const flatItems = buildFlatItems(rows, "make", "asc", collapsed);

// pinned columns first, each with its sticky offset resolved
const layout = buildColumnLayout(columns, pinnedIds);

// per-column cell facts, hoisted out of the per-row loop
const specs = buildCellSpecs(layout, { wrapCells, enableSelection: true });
```

Column widths and sticky offsets travel as CSS custom properties
(`--ftg-size-*`, `--ftg-left-*`), hex-encoded from the column id so any accessor
key stays a valid, collision-free CSS identifier. That is what lets
`useColumnResizePreview()` drive a drag entirely in CSS without re-rendering a
single memoized cell.

Two details worth knowing before you restyle:

- **The frozen edge is deliberately split.** A 1px border rides with the last
  pinned cell so a browser that lags sticky cells during overscroll can never
  float frozen content past it; the drop shadow is a *single overlay* above the
  scroll container, because per-cell it renders as banded seams where the blur
  fades out at each row edge.
- **`displayRowPosition()` is not `row.index + 1`.** TanStack's `row.index` is
  the position in the *unfiltered* data, so a filtered table numbers rows
  "1, 4, 7, 10". This counts the rows actually on screen.

Both lists that key on your renderer names are yours to pass, and `metaOf` says
where a column's cell metadata lives on *your* layout item:

```ts
buildCellSpecs(layout, {
  wrapCells,
  enableSelection,
  denseCellRenderers: new Set(["sparkline"]),   // tighter gutter
  skeletonShapes: { sparkline: "bar" },         // unknown names fall back to "text"
  metaOf: (column) => column,                   // for a SchemaColumn layout
});
```

`metaOf` defaults to the TanStack header shape (`item.column.columnDef.meta`).
A `SchemaColumn` already carries `type`, `breakdown` and `cellTint` at its top
level, so a schema-driven layout passes the identity — which is exactly what
`<DataGrid>` does, so the per-column hoist is not TanStack-only.

This subpath returns Tailwind class names as strings and renders no markup, so
the DOM stays yours. It needs `react` (types only, except for the resize hook)
and `@tanstack/react-virtual` for `useColumnResizePreview` — both optional peers.
It pulls in no UI kit.

## What else is in the box

| | |
|---|---|
| `grid-view` | `GridView` — search, filter, sort, grouping and column layout in one serializable object |
| `view-diff` | `diffView` / `isViewDirty` — does this view have unsaved changes, and which fields moved |
| `view-columns` | resolving a view's column layout against a schema: order, visibility, pins |
| `selection` | range/anchor selection over the rendered row order, tri-state header, per-group toggles |
| `footer-aggregate-value` | `resolveFooterValue` — server-computed aggregates beat the loaded rows |
| `layout/windowing` | `fixedRowWindow` / `reachedEndOfRows` — dependency-free row windowing and the paging trigger |
| `sorting-state` | multi-column sort state, plus the only two functions that know TanStack's sort shape |
| `date-grouping` | group dates by day/week/month/quarter/year, with injectable relative labels. A value's calendar day is always the **local** one — a string contributes its literal `YYYY-MM-DD` prefix, a `Date` its local day — so filtering, grouping and both export formats agree on which day a row falls on |
| `threshold` | value→colour bands, zod-free so cell renderers can import the resolvers |
| `firetable-grid/schema` | zod schemas for validating stored threshold and enum-colour config — a separate entry point so zod stays out of your client bundle |
| `stagedDayThresholdListSchema(n)` | N ordered whole-day bounds plus a catch-all, for staged status indicators (on `firetable-grid/schema`) |
| `enum-color` | per-value colours for enum columns |
| `column-category-layout` | grouping columns into reorderable category blocks |
| `derived-options` | filter options computed from the data when the set is not fixed |
| `footer-aggregate-query` / `format-footer-aggregate` | footer aggregates; formatting takes any `{ number() }` formatter, so your i18n library drops straight in |

Both snippets above live in `examples/` as compiling code — `bun run typecheck` covers them, so a change that breaks the documented API breaks the build.

## Benchmarks

For reproducible Chromium core and native-scroll baselines, run `bun run bench:core`
and `bun run bench:frames`. See [the benchmark guide](bench/README.md) for saved
results, profiling, before/after comparisons and measurement limits.

The browser suite mounts the real production React grid in Chromium with 10k
and 100k rows and 50 data columns. It measures mount and scroll work, and checks
that virtualization bounds the DOM, unchanged cells do not render on scroll,
row edits and new render callbacks update cells, selection works, and stable row
IDs preserve input state when rows reorder.

```bash
bunx playwright install chromium  # once, if Chromium is not installed
bun run test:browser
```

For a before/after comparison, capture the bundle before editing with
`bun bench/browser/run.ts --capture=/tmp/grid-before.js`. Run the updated code
with `--baseline=/tmp/grid-before.js --output=/tmp/grid-browser-results.json`.
The scroll timing includes React work and a synchronous layout flush; it excludes
paint. Mount timing includes two animation frames and is not a pure CPU measure.
These are browser measurements, separate from database and filter-engine tests.

For a matched column-window comparison on 10k rows × 100 data columns, run
`bun bench/browser/run.ts --columns --output=/tmp/grid-columns.json`. It alternates
column virtualization off/on/on/off, measures both scroll directions, and records
mounted cells. `--check-only` runs the behavior checks without timing samples;
these cover pinned columns, focus retention, resizing, hide/reorder, grouping,
variable widths without an app CSS reset, and header/body/footer alignment.

`DataGrid` memoizes rows and rendered cell contents. Keep `columns`, `getRowId`,
and `renderCell` stable between unrelated renders. Replace changed row objects
instead of mutating them; include locale, formatter, and other presentation
dependencies in `renderCell`'s `useCallback` dependency list. Virtualization remains
opt-in for both rows and columns.

```bash
bun run bench                 # the default ladder
bun run bench -- --full       # adds the 300,000 × 200 rung (~2.2 GB, slow)
bun run bench -- filter       # one file, every rung
```

The suite runs on [mitata](https://github.com/evanwashere/mitata) over a
generated inventory table, across a ladder of sizes — 10k to 300k rows, 20 to
200 columns. Each file × rung runs as its **own process**: a live multi-gigabyte
heap changes what every later measurement in the same process costs, and
measuring the ladder in one process reported `applyView` at 686 ms when its real
cost is 36 ms, because the first measurement after building the dataset was
paying for a full GC.

Every filter case is measured against a **raw-loop baseline** doing the same
property reads by hand, because an absolute number means nothing here — see
below.

### Width costs more than anything the engine does

Filtering 300,000 rows on one numeric column, measured on an M2:

| | 20 columns | 200 columns |
|---|---|---|
| raw `for` loop, no library | 0.78 ms | ~36 ms |
| `applyView` | 3.06 ms | ~36 ms |

At 200 columns the engine costs the same as a hand-written loop — the compiled
predicate is free relative to the data access. What dominates is **reading one
property out of a wide row**: at 200 columns each row's storage is ~1.6 KB, so
300k rows scatter ~480 MB across memory and every row costs a cache miss. That
is inherent to row-oriented objects, not something a filter engine can optimise
away.

So if you have a wide table and filtering feels slow, the engine is not where
the time goes. The practical lever is narrowing the rows you hand it, not
tuning the filter.

The engine's own overhead is about **2.3 ms per 300k rows** over a raw loop —
roughly 4 ns/row for the closure indirection and the output array — and it is
constant, not width-dependent.

## Demo

`demo/index.html` is a prebuilt, self-contained page — open it straight from a
clone, no server and no build step. It renders the package's own `<DataGrid>` — drag a
header to reorder, drag a header's right edge to resize — with the engine's own
state printed beside it: the live GridView, the resolved column layout with sticky
offsets, the flat item list, and the CSV the current view would export. Filter,
sort, group and collapse, and watch both sides change together.

```bash
bun run demo    # rebuild demo/index.html after changing the package
```

The build inlines the JS and CSS into one file, and it generates the colour CSS
by asking the package itself what each hue resolves to via `paletteShadeHex` —
so the demo cannot drift from the palette it documents. `demo/template.html`
holds the placeholders; it is not a page you can open.

## Development

```bash
bun install
bun test          # 485 tests
bun run typecheck
bun run lint
bun run bench     # performance suite (see Benchmarks above)
```

## License

MIT

## ORM integration

The browser grid consumes rows and `GridView`; it does not import an ORM or own
your network transport. Server integrations translate that same view into query
expressions while your application retains its joins, tenant scope, transaction,
and response shape.

### Drizzle with PostgreSQL

Install `drizzle-orm` in the server application and import the optional
`firetable-grid/drizzle` entry point. It returns native Drizzle expressions and
validated paging values; it does not execute or replace your query builder.

```ts
import { and, eq } from "drizzle-orm";
import { compileDrizzleQuery } from "firetable-grid/drizzle";

const grid = compileDrizzleQuery(requestBody, columns, {
  fields: { make: listings.make, price: listings.price },
  rowKey: listings.id,
});

const rows = await db
  .select({ id: listings.id, make: listings.make, price: listings.price })
  .from(listings)
  .where(and(eq(listings.tenantId, authenticatedTenantId), grid.where))
  .orderBy(...grid.orderBy)
  .limit(grid.limit)
  .offset(grid.offset);
```

`fields` maps grid column IDs to trusted PostgreSQL columns or native Drizzle
`SQL` expressions. Aliased tables and parameterized computed expressions work;
pass computed expressions before `.as(...)`, since a SELECT alias cannot be used
in the same query's WHERE clause. Only referenced fields require mappings.
Request values remain bound parameters, including expressions' own parameters.

The application supplies a unique non-null row key, joins and tenant conditions.
Use the same predicate for an optional count; use a transaction if the count and
page must share a snapshot. The adapter never overwrites an existing builder's
WHERE clause. Grouping is not supported in this initial adapter, and its paging
values describe offset pagination. A caller can use the returned expressions in
its own cursor strategy. MySQL/SQLite and other ORM adapters are not yet included.

See [the joined and computed-column example](examples/drizzle-query.ts).
Drizzle is an optional peer and stays out of the core and browser entry points.
The headless root also loads under React server conditions, so server code can
reuse `col`, `GridView` helpers, and filter definitions.

## Postgres and Snowflake data sources

Use the same `GridView` on the server with explicit columns and a scoped SELECT.
The application owns authentication, its connections, and HTTP transport. The
package compiles grid filters and sorting, fetches one page, and optionally counts
the complete filtered result. SQL support ships through separate entry points:

| Import | Exports |
| --- | --- |
| `firetable-grid/sql` | `sql`, `compileGridQuery`, `parseGridRequest`, `runGrid`, `nextGridPage`, types and errors |
| `firetable-grid/pg` | `pgSource`, `sql` |
| `firetable-grid/snowflake` | `snowflakeSource`, `sql` |

All three have no runtime package dependencies. Install the driver you use in
your application (`pg` or `snowflake-sdk`); the adapters accept it structurally.
No driver is loaded by the root or React entry point.

```ts
import { pgSource, sql } from "firetable-grid/pg";
import { runGrid } from "firetable-grid/sql";

// tenantId comes from your authenticated session, never the grid request body.
const source = pgSource<Listing>(pool, {
  query: sql`SELECT id, make, price FROM listings WHERE tenant_id = ${tenantId}`,
  rowKey: "id",
});
const result = await runGrid(source, request, { columns });
// { rows: Listing[], total: number, page: { limit, offset } }
```

Snowflake uses the same runner. Quote output aliases to preserve their exact case:
Snowflake otherwise resolves unquoted identifiers to uppercase.

```ts
import { snowflakeSource, sql } from "firetable-grid/snowflake";

const source = snowflakeSource<Listing>(connection, {
  query: sql`
    SELECT ID AS "id", MAKE AS "make", PRICE AS "price"
    FROM ANALYTICS.LISTINGS
    WHERE TENANT_ID = ${tenantId}
  `,
  rowKey: "id",
});
const result = await runGrid(source, request, {
  columns,
  count: false,
  signal: requestSignal,
});
```

`sql` binds every interpolated value and supports nested fragments. Its
`.toQuery("postgres" | "snowflake")` method returns `{ text, values }`, with
parameters numbered across the complete statement. Interpolate values or other
fragments; arbitrary objects and raw SQL strings are not SQL expressions.
The **base SELECT itself remains database-specific**. Sources wrap it as a
subquery; they do not translate its SQL or rewrite its joins.

One output row must have one unique, non-null `rowKey`. A join can legitimately
produce several rows per entity, provided each result row has its own key;
aggregate child records when the grid should show one row per parent. The key
is appended to sorting, including requests with no sort. Existing LIMIT/OFFSET
in the base SELECT constrain the dataset before grid filtering.

### Columns and SQL storage types

Use your existing `SchemaColumn[]`. SQL reads `accessorKey ?? id` from the query's
outputs, so computed values should be selected with an appropriate alias.
`SqlGridColumn<Row>` adds `sqlType` for storage details the display type cannot
express:

```ts
const columns: SqlGridColumn<Listing>[] = [
  col({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  {
    ...col({ id: "createdAt", label: "Created", type: ColumnTypes.DATE }),
    sqlType: "timestamptz",
  },
  {
    ...col({ id: "tags", label: "Tags", type: { ...ColumnTypes.BADGE, setValued: true } }),
    sqlType: "text[]",
  },
];
```

`ColumnTypes` here is the application's vocabulary, as elsewhere in this README.
Set `sqlNullable: false` only for SELECT outputs guaranteed non-null, including
after joins. This lets descending Postgres sorts use the index's default null
ordering. Other columns retain `NULLS LAST`; enum option ranking also retains it
because unknown values produce a null rank.

Numeric filters expect native numeric query outputs; cast text to numeric in
your SELECT when needed. Date filters require `sqlType: "date"`, `"timestamp"`
or `"timestamptz"`. Date/timestamp compares the stored calendar day;
timestamptz converts the instant to `runGrid`'s `timeZone` (default `"UTC"`).
For Snowflake, timestamptz means TIMESTAMP_TZ or TIMESTAMP_LTZ; timezone-less
TIMESTAMP_NTZ uses timestamp. The database's timestamp type must match the
metadata. Set-valued enums default to comma-separated text; text[] uses a native
Postgres text array or Snowflake ARRAY.

The source preserves driver-decoded row values. In particular, Postgres numeric
and bigint commonly arrive as strings. Supply matching row types, configure your
driver, or cast deliberately in the SELECT. JSON transport of bigint and dates
also belongs to the application. Snowflake Date bind values are sent as ISO
strings; use an explicit timestamp cast in your base SELECT when appropriate.

### Validation and semantics

`runGrid` validates requests automatically. A route can also call
`parseGridRequest(body, columns, { maxLimit: 1000 })` to parse untrusted JSON.
`GridRequestError.issues` provides `{ path, message }` entries to return as a 400.
Configuration errors throw `GridConfigError`; database errors propagate unchanged.
To change the page-size policy, pass the same `maxLimit` to `runGrid`.

- Filters reject unknown fields, disallowed operators, non-filterable columns,
  malformed numbers/dates, and trees over 200 nodes or 20 levels. Pages use safe
  integer offsets and limits of 1–1000 by default; sorting allows up to 32 rules.
- Empty numeric/date input is a no-op. Text `is ""` selects empty values.
  Empty `all` and `any` branches are TRUE, including when nested inside OR.
- Text equality/search is case-insensitive; contains/search treats `%`, `_`,
  backslash and `!` literally. Empty text includes whitespace. Numeric NaN is
  empty and does not pass active numeric comparisons.
- Set membership trims and lowercases each element; null sets pass `is not`.
  Fixed enum options determine sorting order; values outside the options share
  the final rank. Other sorts use explicit NULLS LAST in either direction.
- SQL collation/case handling and ordering may differ from JavaScript. The memory
  engine's local-Date/string-prefix behavior is unchanged; timezone-aware SQL
  date filtering is an explicit separate contract. Numeric filter inputs remain decimal strings, including exact ratio scaling.
  Snowflake rejects filters exceeding 38 digits or 37 decimal places; precision
  also depends on the storage type of the queried column.
- JavaScript `getFilterValue` cannot supply SQL filtering/search, and custom
  `sortingFn` cannot supply SQL sorting. Expose those values in the base query
  and pass a SQL-compatible column definition. Server grouping is rejected in
  this version. View column-layout preferences are ignored by the server.

### Render server results

Pass `dataMode="server"` so the grid preserves the server's rows and ordering:

```tsx
<DataGrid
  dataMode="server"
  rows={result.rows}
  columns={columns}
  view={view}
  onViewChange={setView}
  getRowId={(row) => row.id}
  renderCell={renderCell}
/>
```

Server mode requires a controlled `view` and `onViewChange`; header sorting still
emits the next view for the application to fetch. Selection applies to loaded
rows. Local grouping is disabled. Supply `footerValues` for full-result footers;
missing values display as unknown instead of aggregating only the loaded page.
The default `dataMode="client"` retains the original local behavior.

`nextGridPage(result)` returns the next `{ limit, offset }` or `undefined`.
With `count: false`, a short/empty page ends the sequence; a final full page
requires one more request. For infinite loading, reset pages whenever the query
changes, pass the fetch AbortSignal, flatten pages once, and guard `onEndReached`
against concurrent loads. The package does not choose a fetching library.

See [the server route example](examples/sql-sources.ts),
[the client example with cancellation and paging](examples/server-grid.tsx), and
[their shared columns](examples/sql-columns.ts). The route example takes a source
already scoped by your authenticated tenant. The client uses ordinary fetch and
needs no additional React data library.

### Execution and verification

Page and count are separate statements and may observe different snapshots.
Offset pagination has deterministic ties on unchanged data; concurrent inserts,
deletes or sort-value changes can still produce skipped/repeated rows. Use
`count: false` when totals are unnecessary. Snowflake aborts call the statement's
`cancel()` method; the minimal Postgres `query(text, values)` interface checks
abort before/after execution but does not cancel an in-flight database query.

Wrapped-query performance depends on the query, indexes and optimizer. Predicate
pushdown is conditional; moving filters before aggregates can change results.
Use EXPLAIN ANALYZE on your workload. `bun run bench:sql` runs synthetic joined
and aggregated plans in local PGlite; set `GRID_BENCH_DATABASE_URL` to opt into
SELECT-only live Postgres plans. These fixtures are not production latency claims.

`bun test` runs real Postgres SQL through PGlite plus driver lifecycle, compiler,
validation, bundle isolation and server-rendering tests. The Snowflake fixture
suite is opt-in and executes only inline SELECTs:

```sh
SNOWFLAKE_ACCOUNT=... SNOWFLAKE_USER=... SNOWFLAKE_WAREHOUSE=... \
  bun run test:snowflake
```

Provide `SNOWFLAKE_PRIVATE_KEY` (PEM, JWT authentication) or
`SNOWFLAKE_PASSWORD`, and optionally `SNOWFLAKE_ROLE`, through your environment.
The live suite uses the same expected-result cases as Postgres. Credentials are
never stored in this repository.
