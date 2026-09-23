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

Both **opt-in**:

```tsx
virtualize={{ rowHeight: 36, overscan: 8 }}   // built-in, no extra dependency
onEndReached={fetchNextPage} endReachedThreshold={8}
```

Opt-in on purpose. Virtualization fails *quietly* rather than loudly —
find-in-page stops finding unrendered rows, printing shows only the window, a
screen reader sees a partial table unless you set `aria-rowcount` yourself, and
a test asserting "all 40 rows render" starts failing. A fifty-row grid should
pay none of that. It is also not auto-enabled above some row count: behaviour
that changes discontinuously with data size gives you "works at 50 rows, breaks
at 500", which is the worst kind of bug report.

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
