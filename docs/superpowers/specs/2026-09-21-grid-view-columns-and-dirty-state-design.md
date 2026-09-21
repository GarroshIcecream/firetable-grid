# GridView column layout + dirty-state diffing

Date: 2026-09-21
Status: approved for implementation
Version target: 0.3.0 (breaking — `DataGrid` props removed)

## Why

`GridView` collapsed search, filter, sort and grouping into one serializable
object (0.2.0). Column layout stayed outside it, as five separate `DataGrid`
props. That leaves the thesis half-finished:

- "Save this view" cannot be one object, because half the view is props.
- "Is this view dirty?" cannot be answered at all, because there is nothing to
  diff column layout against.

FireTable — the product this engine was extracted from — persists
`columnVisibility`, `columnOrder`, `columnSizing` and `pinnedColumns` together
with filter/sort/group in one `SavedViewState`, and diffs all of them in
`computeIsDirty`. That function is pure, already load-bearing in production, and
carries five rules that each took a real bug to learn. This spec brings both the
state shape and the diff into the library.

## Scope

This spec covers **A (column layout in the view)** and **B (dirty diffing)**
only. Two further features were discussed and are explicitly **out of scope
here**, each getting its own spec:

- Row selection with a shift-click range anchor.
- Footer aggregates rendered by `DataGrid`.

A and B ship together because B cannot be built or tested without A.

## Decisions taken before design

1. **Group direction stays derived from the sort.** No `groupDir` field, and no
   `GroupRule.dir` override. Group headers follow the grouped column's sort
   direction via the existing `groupSortDirection`; sorting any other column
   only reorders rows within each group. FireTable stores a separate
   `groupDir`, which can contradict the sort — the derived model cannot.
2. **`columns` is optional, and so is every field inside it.** Two levels of
   "this view does not track that", because both occur in practice.
3. **Visibility stays `Record<string, boolean>`**, not `hidden: string[]`.
   `buildVisibility` already emits a sparse record, and `isColumnVisible`,
   `selectExportColumns` and `buildFooterAggregateQuery` all read that shape.
   Changing it is a second migration for no behavioural gain; the
   `undefined`/`false` ambiguity is handled in the diff instead.
4. **Deep-equal is vendored, not depended on.** The package has zero runtime
   dependencies and `entry-points.test.ts` polices that. FireTable uses
   `dequal`; we write ~25 lines internally rather than add a dependency for one
   function.
5. **Selection is not part of `GridView`** (relevant to the later spec):
   ephemeral, like `collapsedGroups`.
6. **Render-prop escape hatches** for any new UI (later specs). The package
   ships no UI kit.

## A. Column layout in the view

```ts
export interface ColumnLayoutState {
  /** Column ids in display order. Ids not listed are appended. */
  order?: string[];
  /** Sparse: absent means visible, `false` means hidden. */
  visibility?: Record<string, boolean>;
  /** Pixel widths by column id, overriding each column's own `width`. */
  sizes?: Record<string, number>;
  /** USER pins, merged with the columns' own schema `frozen` flag. */
  pinned?: string[];
}

export interface GridView {
  search: string;
  filter: FilterNode | null;
  sort: SortRule[];
  group: GroupRule | null;
  columns?: ColumnLayoutState;
}
```

`columns` being absent means "this view does not carry a column layout" — the
shape a preset or system view takes. Loading such a view must leave the current
columns alone, and diffing it must not compare them. Encoding that as an absent
key rather than an empty object is what makes the rule expressible in the type
instead of in branches at every call site.

### Constructors

- `emptyGridView()` returns `{ search: "", filter: null, sort: [], group: null }`
  with **no `columns` key**. A default view tracks no layout.
- `isGridViewEmpty(view)` additionally requires `columns` to be absent or
  carry nothing: no `order`, no `pinned`, no `sizes` entries, and no `false`
  entry in `visibility`.
- `hiddenColumnIds(visibility)` — new, exported. Returns the set of ids mapped
  to `false`. Used by both `isGridViewEmpty` and the diff, so "which columns are
  hidden" has one definition.

## DataGrid changes

**Removed props:** `columnOrder`, `onColumnOrderChange`, `columnSizes`,
`onColumnSizesChange`, `columnVisibility`. All five move into `view.columns`,
read through `view` and written through `onViewChange`. Keeping them alongside
`view.columns` would create two sources of truth for the same state.

This deletes the `ownOrder` and `ownSizes` internal state entirely: the view is
already the state container, controlled or not.

Resolution inside the component:

| Value | Source |
|---|---|
| order | `activeView.columns?.order ?? columns.map(c => c.id)` |
| visibility | `activeView.columns?.visibility ?? buildVisibility(columns)` |
| sizes | `activeView.columns?.sizes ?? {}` |
| pinned | `resolvePinnedColumns({ compact: false, frozenColumns: <schema frozen ids>, userPinnedColumns: activeView.columns?.pinned })` |

A reorder or resize emits `onViewChange` with `columns` patched, leaving the
rest of the view untouched. When the view carries no `columns` yet, the first
such interaction creates it with only the field that changed — so a grid that
has only ever been resized produces `columns: { sizes: {...} }`, and the diff
correctly reports that nothing else about the layout is being tracked.

Visibility keeps its existing contract: nothing inside the grid writes it. The
difference is only where it is read from. A consumer's column manager now
writes `view.columns.visibility` through `onViewChange` instead of owning a
separate `useState`, which is what lets a hidden column be saved and diffed
with the rest of the view.

### `resolvePinnedColumns` finally gets used

It ships today and `DataGrid` has never called it — the component does
`ordered.filter(c => c.frozen)` instead, which cannot express a user pin. It
returns `{ locked, pinned }`, and both halves are needed:

- `pinned` drives stickiness (what `buildColumnLayout` receives).
- `locked` drives the reorder exclusion (`participating`), which currently uses
  `isPinned`.

Correction to an earlier claim: with `compact: false` these two lists have
identical contents, so wiring both changes no behaviour today. They only
diverge under `compact: true`, where `pinned` narrows to `compactFrozenColumns`
while `locked` stays complete — a column that cannot be dragged but is no longer
sticky. Using the semantically correct list at each call site is still worth
doing now, so the compact breakpoint is a later config change rather than a
hunt through the component.

Its `compact` parameter is passed `false`; a mobile breakpoint that freezes
fewer columns is out of scope.

## B. Dirty diffing

New module `src/view-diff.ts`, with the vendored structural equal kept private
to it.

```ts
export type ViewField = "search" | "filter" | "sort" | "group" | "columns";

export interface ViewDiff {
  dirty: boolean;
  /** Which top-level fields diverge, in declaration order. */
  changed: ViewField[];
}

export function diffView(current: GridView, baseline: Partial<GridView>): ViewDiff;
export function isViewDirty(current: GridView, baseline: Partial<GridView>): boolean;
```

`changed` exists so a UI can say "sort and columns changed" rather than only
lighting up a dot; `isViewDirty` is the boolean shorthand over it.

### The rules, and the bug each one prevents

| Rule | Bug it prevents |
|---|---|
| A key **absent from `baseline`** is not compared. Presence is tested with `in`, not `!== undefined`. | A preset view stores no column layout; comparing against one flags every preset dirty the moment it loads. Likewise a view saved before a field existed. |
| `filter: null` and `group: null` **present** in the baseline **are** compared. | `null` means "explicitly unfiltered" and must be distinguishable from "untracked" — which is exactly why presence is `in` and not a value check. |
| Structural deep-equal, never `JSON.stringify`. | Postgres `jsonb` does not preserve object key order. A view round-tripped through the database comes back reordered, and a stringify comparison reports a spurious diff after every save. |
| `columns.pinned` compares as a **set**. | Pin order is not meaningful; comparing arrays flags a reordered-but-identical pin list dirty. |
| `columns.visibility` compares **hidden id sets**, so absent and `true` agree. | `{}`, `{a: true}` and a record rebuilt by a column manager all describe the same visible set; comparing records directly flags them different. |
| `columns.sizes` treats `undefined` and `{}` as equal. | A view that has never been resized stores `undefined`; the live grid holds `{}`. |
| Each field **inside** `columns` is independently tracked by its presence in `baseline.columns`. | A view that stores `order` but not `sizes` must not flag dirty when someone resizes a column. |

A `baseline` of `{}` tracks nothing and is therefore never dirty. That is
correct: a view that stores no state cannot diverge from one.

## Files touched

| File | Change |
|---|---|
| `src/grid-view.ts` | `ColumnLayoutState`, `GridView.columns`, `hiddenColumnIds`, updated `isGridViewEmpty` |
| `src/view-diff.ts` | new — `diffView`, `isViewDirty`, private `deepEqual` |
| `src/index.ts` | export `./view-diff` |
| `src/react/DataGrid.tsx` | drop five props, read/write `view.columns`, wire `resolvePinnedColumns` for both `pinned` and `locked` |
| `examples/grid.tsx` | controlled example uses one view |
| `demo/main.tsx` | order/sizes/visibility move into the view state |
| `README.md` | view section, `<DataGrid>` prop table, module table |
| `tests/view-diff.test.ts` | new |
| `tests/grid-view.test.ts` | `columns` in the JSON round trip and emptiness checks |

`tests/react-column-ops.test.ts` and `tests/column-visibility.test.ts` test pure
functions rather than props and are expected to pass unchanged — a useful
signal that the contract underneath did not move.

## Testing

`tests/view-diff.test.ts` gets one `describe` per rule above, each named after
the bug it prevents rather than the mechanism, so a future reader learns why the
rule exists from the failure message. Specifically:

- Identity: `diffView(v, v)` is not dirty for a fully populated view.
- Key-order independence: two objects built with different insertion order,
  asserted equal. This is the jsonb rule and is the one most likely to be
  "simplified" away later.
- `filter: null` in the baseline compared; `filter` absent not compared.
- Pins reordered → clean. Pins changed → dirty.
- `{}` vs `{a: true}` visibility → clean. `{a: false}` → dirty.
- `undefined` vs `{}` sizes → clean.
- `baseline.columns` present without `sizes` → a resize is clean.
- `changed` lists exactly the diverging fields.

`tests/grid-view.test.ts` extends the existing JSON round-trip to a view
carrying `columns`, and asserts `isGridViewEmpty` stays true for a view whose
`visibility` record contains only `true` entries.

## Out of scope

- Row selection (its own spec).
- Footer aggregates in `DataGrid` (its own spec).
- A mobile `compact` breakpoint for pinned columns.
- URL encoding of a view.
- Making FireTable consume the package.
