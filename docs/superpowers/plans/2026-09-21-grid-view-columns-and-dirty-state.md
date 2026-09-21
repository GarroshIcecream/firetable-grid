# GridView Column Layout + Dirty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move column layout into `GridView` and add a dirty diff that compares a live view against a saved baseline.

**Architecture:** `GridView` gains an optional `columns` object (order, visibility, sizes, pinned), each field independently optional so "this view does not track that" is expressible in the type. A new `view-diff` module compares a live view against a `Partial<GridView>` baseline using `dequal`. A new `view-columns` module resolves a view's layout against a column schema as pure functions, which `DataGrid` then consumes in place of five removed props.

**Tech Stack:** TypeScript 6, React 19 (peer), bun test, biome, tsup, `dequal` (the one runtime dependency, added here).

**Spec:** `docs/superpowers/specs/2026-09-21-grid-view-columns-and-dirty-state-design.md`

## Global Constraints

- **One runtime dependency, `dequal@^2.0.3`** — MIT, itself dependency-free, added in Task 2 as the package's first and only `dependencies` entry. Do not add a second without asking. `tests/entry-points.test.ts` continues to guarantee the heavy optional peers (`zod`, `exceljs`, `server-only`) stay unreachable from the package root, and Task 2 extends it to catch undeclared imports.
- **No backward-compatibility shims.** Removed props and types are deleted outright, not deprecated. This was decided for 0.2.0 and continues here.
- **Every public export carries a doc comment explaining *why*, not what.** Match the density of the surrounding files — see `src/filter-engine.ts` and `src/grid-view.ts`.
- **Comments explain the bug a rule prevents, not the mechanism.** This codebase's comments are its main asset; a rule with no recorded reason gets "simplified" away later.
- **Verification after every task:** `bun run typecheck && bun run lint && bun test` must all pass before committing.
- **There are no DOM/render tests in this repo.** Every test is a pure-function test. `examples/grid.tsx` is the compile-time contract test for `<DataGrid>`'s props — if it stops compiling, the public API broke.
- **Version target:** 0.3.0, bumped once in Task 5.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/grid-view.ts` (modify) | The view type and its constructors. Gains `ColumnLayoutState`, `GridView.columns`, `hiddenColumnIds`, `isColumnLayoutEmpty`. Stays type-and-constructor only. |
| `src/view-diff.ts` (create) | Comparing a live view to a saved baseline. |
| `src/view-columns.ts` (create) | Resolving a view's column layout against a column schema — order, visibility filtering, pin resolution. Pure, so `DataGrid` keeps no layout logic of its own. |
| `src/react/DataGrid.tsx` (modify) | Loses five props and both pieces of own column state; consumes the two new modules. |
| `src/index.ts` (modify) | Barrel exports for the two new modules. |

---

### Task 1: `ColumnLayoutState` on the view

**Files:**
- Modify: `src/grid-view.ts`
- Test: `tests/grid-view.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `interface ColumnLayoutState { order?: string[]; visibility?: Record<string, boolean>; sizes?: Record<string, number>; pinned?: string[] }`
  - `GridView.columns?: ColumnLayoutState`
  - `hiddenColumnIds(visibility: Readonly<Record<string, boolean>> | undefined): Set<string>`
  - `isColumnLayoutEmpty(columns: ColumnLayoutState | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `tests/grid-view.test.ts`. Add `hiddenColumnIds` and `isColumnLayoutEmpty` to the existing import from `../src`.

```ts
describe("hiddenColumnIds", () => {
  test("collects only the ids explicitly mapped to false", () => {
    // The visibility record is sparse: absent means visible, and a `true`
    // entry is a column manager writing the default back. Both must read as
    // "not hidden", or a view that has been through a column manager looks
    // different from one that has not.
    expect([...hiddenColumnIds({ a: false, b: true, c: false })]).toEqual([
      "a",
      "c",
    ]);
    expect(hiddenColumnIds({ a: true }).size).toBe(0);
    expect(hiddenColumnIds({}).size).toBe(0);
    expect(hiddenColumnIds(undefined).size).toBe(0);
  });
});

describe("isColumnLayoutEmpty", () => {
  test("an absent or blank layout is empty", () => {
    expect(isColumnLayoutEmpty(undefined)).toBe(true);
    expect(isColumnLayoutEmpty({})).toBe(true);
    expect(isColumnLayoutEmpty({ order: [], pinned: [], sizes: {} })).toBe(true);
  });

  test("a visibility record of nothing but `true` is still empty", () => {
    expect(isColumnLayoutEmpty({ visibility: { a: true } })).toBe(true);
  });

  test("any real layout is not empty", () => {
    expect(isColumnLayoutEmpty({ order: ["a"] })).toBe(false);
    expect(isColumnLayoutEmpty({ visibility: { a: false } })).toBe(false);
    expect(isColumnLayoutEmpty({ sizes: { a: 120 } })).toBe(false);
    expect(isColumnLayoutEmpty({ pinned: ["a"] })).toBe(false);
  });
});

describe("a view carrying a column layout", () => {
  test("isGridViewEmpty accounts for the layout", () => {
    expect(
      isGridViewEmpty({ ...emptyGridView(), columns: { visibility: { a: true } } }),
    ).toBe(true);
    expect(
      isGridViewEmpty({ ...emptyGridView(), columns: { order: ["a"] } }),
    ).toBe(false);
  });

  test("emptyGridView carries no layout at all", () => {
    // Absent, not `{}`: a default view tracks no columns, and the diff reads
    // an absent key as "not tracked".
    expect("columns" in emptyGridView()).toBe(false);
  });

  test("a layout survives the JSON round trip", () => {
    const view: GridView = {
      ...emptyGridView(),
      columns: {
        order: ["b", "a"],
        visibility: { c: false },
        sizes: { a: 120 },
        pinned: ["b"],
      },
    };
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/grid-view.test.ts`
Expected: FAIL — `hiddenColumnIds` and `isColumnLayoutEmpty` are not exported.

- [ ] **Step 3: Implement in `src/grid-view.ts`**

Add above `GridView`:

```ts
/**
 * A view's column layout. Every field is optional, and so is `columns` itself,
 * because "this view does not track that" is a real state and not the same as
 * "this view tracks it and it is empty".
 *
 * A preset or system view stores no layout at all: loading it must leave the
 * current columns alone, and diffing it must not compare them. Encoding that as
 * an absent key rather than an empty object is what lets `diffView` express the
 * rule once instead of at every call site.
 */
export interface ColumnLayoutState {
  /** Column ids in display order. Ids not listed are appended in schema order. */
  order?: string[];
  /** Sparse: absent means visible, `false` means hidden. Matches
   *  `isColumnVisible`, which three other call sites already read. */
  visibility?: Record<string, boolean>;
  /** Pixel widths by column id, overriding each column's own `width`. */
  sizes?: Record<string, number>;
  /** USER pins, merged with the columns' own schema `frozen` flag. */
  pinned?: string[];
}
```

Add `columns?: ColumnLayoutState;` as the last field of `GridView`, with this doc comment:

```ts
  /** Order, visibility, widths and pins. Absent means this view does not carry
   *  a column layout — see `ColumnLayoutState`. */
  columns?: ColumnLayoutState;
```

Add below `emptyGridView`:

```ts
/**
 * The ids a visibility record actually hides.
 *
 * `{}`, `{ a: true }` and a record a column manager rebuilt from scratch all
 * describe the same visible set, so comparing records directly reports
 * differences that no user can see. Every comparison goes through this instead.
 */
export function hiddenColumnIds(
  visibility: Readonly<Record<string, boolean>> | undefined,
): Set<string> {
  const hidden = new Set<string>();
  if (!visibility) return hidden;
  for (const [id, visible] of Object.entries(visibility)) {
    if (visible === false) hidden.add(id);
  }
  return hidden;
}

/** True when a layout describes nothing: no order, no pins, no widths, and
 *  nothing hidden. */
export function isColumnLayoutEmpty(
  columns: ColumnLayoutState | undefined,
): boolean {
  if (!columns) return true;
  return (
    (columns.order?.length ?? 0) === 0 &&
    (columns.pinned?.length ?? 0) === 0 &&
    Object.keys(columns.sizes ?? {}).length === 0 &&
    hiddenColumnIds(columns.visibility).size === 0
  );
}
```

Extend `isGridViewEmpty`'s return expression with a final clause:

```ts
    view.group === null &&
    isColumnLayoutEmpty(view.columns)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/grid-view.test.ts && bun run typecheck && bun run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grid-view.ts tests/grid-view.test.ts
git commit -m "feat(view): carry column layout on GridView

Order, visibility, widths and pins join the view. Every field is optional,
and so is \`columns\` itself, because a preset view legitimately stores no
layout - and diffing one against a layout it never had is what flags every
preset dirty the moment it loads.

\`hiddenColumnIds\` gives \"which columns are hidden\" one definition, so a
visibility record rebuilt by a column manager compares equal to the sparse
one it replaced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The dirty diff

**Files:**
- Create: `src/view-diff.ts`
- Modify: `src/index.ts`
- Modify: `package.json` (add `dependencies`)
- Modify: `tests/entry-points.test.ts` (undeclared-import guard)
- Test: `tests/view-diff.test.ts`

**Interfaces:**
- Consumes: `GridView`, `ColumnLayoutState`, `hiddenColumnIds` from Task 1; `dequal` from npm.
- Produces:
  - `type ViewField = "search" | "filter" | "sort" | "group" | "columns"`
  - `interface ViewDiff { dirty: boolean; changed: ViewField[] }`
  - `diffView(current: GridView, baseline: Partial<GridView>): ViewDiff`
  - `isViewDirty(current: GridView, baseline: Partial<GridView>): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/view-diff.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  all,
  any,
  diffView,
  emptyGridView,
  type GridView,
  isViewDirty,
  where,
} from "../src";

// Every rule below is carried over from FireTable's `computeIsDirty`, and each
// one exists because of a bug that reached users. The describe names say which
// bug, because the mechanism alone reads as a pointless indirection and gets
// "simplified" away.

const view = (over: Partial<GridView> = {}): GridView => ({
  ...emptyGridView(),
  ...over,
});

describe("a view does not diverge from itself", () => {
  test("a fully populated view is clean against its own copy", () => {
    const v = view({
      search: "estate",
      filter: all(where("price", "≤", "25000"), any(where("fuel", "is", "d"))),
      sort: [{ field: "price", dir: "desc" }],
      group: { field: "make" },
      columns: {
        order: ["a", "b"],
        visibility: { c: false },
        sizes: { a: 120 },
        pinned: ["a"],
      },
    });
    expect(diffView(v, v)).toEqual({ dirty: false, changed: [] });
  });
});

describe("a field the baseline does not track is not compared", () => {
  // A preset view stores no column layout. Comparing against one it never had
  // flags every preset dirty the moment it loads.
  test("an empty baseline tracks nothing and is never dirty", () => {
    expect(isViewDirty(view({ search: "x", sort: [] }), {})).toBe(false);
  });

  test("a baseline without `columns` ignores the whole layout", () => {
    const current = view({ columns: { order: ["a"], sizes: { a: 9 } } });
    expect(isViewDirty(current, { search: "" })).toBe(false);
  });

  test("a baseline tracking only `order` ignores a resize", () => {
    // A view that stores order but not sizes must not flag dirty when someone
    // drags a column edge.
    const current = view({ columns: { order: ["a"], sizes: { a: 300 } } });
    expect(isViewDirty(current, { columns: { order: ["a"] } })).toBe(false);
    expect(isViewDirty(current, { columns: { order: ["b"] } })).toBe(true);
  });
});

describe("an explicit null is tracked, an absent key is not", () => {
  // `filter: null` means "explicitly unfiltered" and has to stay
  // distinguishable from "untracked" - which is why presence is tested with
  // `in` rather than against undefined.
  test("a baseline with filter null flags an added filter", () => {
    const current = view({ filter: where("price", "≤", "1") });
    expect(isViewDirty(current, { filter: null })).toBe(true);
  });

  test("a baseline with no filter key ignores the same change", () => {
    const current = view({ filter: where("price", "≤", "1") });
    expect(isViewDirty(current, {})).toBe(false);
  });

  test("the same holds for group", () => {
    const current = view({ group: { field: "make" } });
    expect(isViewDirty(current, { group: null })).toBe(true);
    expect(isViewDirty(current, {})).toBe(false);
  });
});

describe("key order does not make a view dirty", () => {
  // Postgres `jsonb` does not preserve object key order, so a view round-
  // tripped through the database comes back rearranged. A JSON.stringify
  // comparison reports a spurious diff after every single save.
  test("two filters built with different key order are equal", () => {
    const a: GridView = view({
      filter: { kind: "where", field: "price", op: "≤", value: "1" },
    });
    const b: GridView = view({
      filter: { value: "1", op: "≤", field: "price", kind: "where" } as never,
    });
    expect(isViewDirty(a, b)).toBe(false);
  });

  test("sizes records with different insertion order are equal", () => {
    const a = view({ columns: { sizes: { a: 1, b: 2 } } });
    const b = view({ columns: { sizes: { b: 2, a: 1 } } });
    expect(isViewDirty(a, b)).toBe(false);
  });
});

describe("pins compare as a set", () => {
  // Pin order is not meaningful; comparing arrays flags a reordered but
  // identical pin list dirty.
  test("reordered pins are clean", () => {
    expect(
      isViewDirty(view({ columns: { pinned: ["a", "b"] } }), {
        columns: { pinned: ["b", "a"] },
      }),
    ).toBe(false);
  });

  test("a genuinely different pin set is dirty", () => {
    expect(
      isViewDirty(view({ columns: { pinned: ["a"] } }), {
        columns: { pinned: ["a", "b"] },
      }),
    ).toBe(true);
  });
});

describe("visibility compares hidden ids", () => {
  test("absent and `true` agree", () => {
    expect(
      isViewDirty(view({ columns: { visibility: { a: true } } }), {
        columns: { visibility: {} },
      }),
    ).toBe(false);
  });

  test("hiding a column is dirty", () => {
    expect(
      isViewDirty(view({ columns: { visibility: { a: false } } }), {
        columns: { visibility: {} },
      }),
    ).toBe(true);
  });
});

describe("undefined and empty agree", () => {
  test("a view that has never been resized matches a baseline of {}", () => {
    // The stored view has no `sizes`; the live grid holds `{}`.
    expect(
      isViewDirty(view({ columns: { order: ["a"] } }), {
        columns: { order: ["a"], sizes: {} },
      }),
    ).toBe(false);
  });
});

describe("changed names the fields that moved", () => {
  test("it lists every diverging field in declaration order", () => {
    const current = view({
      search: "x",
      sort: [{ field: "a", dir: "asc" }],
      columns: { order: ["b"] },
    });
    const baseline: Partial<GridView> = {
      search: "",
      filter: null,
      sort: [],
      group: null,
      columns: { order: ["a"] },
    };
    expect(diffView(current, baseline).changed).toEqual([
      "search",
      "sort",
      "columns",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/view-diff.test.ts`
Expected: FAIL — `diffView` / `isViewDirty` are not exported from `../src`.

- [ ] **Step 3: Create `src/view-diff.ts`**

```ts
// Comparing a live view against the baseline it was loaded from - "does this
// view have unsaved changes?".
//
// Every rule here exists because of a bug that reached users, and each is
// commented with the bug rather than the mechanism. Without that, a rule like
// "compare structurally, never by JSON.stringify" reads as a pointless
// indirection and gets simplified away by the next reader.
//
// `dequal` is this package's only runtime dependency - MIT, dependency-free,
// and the same comparison FireTable's saved views already use.

import { dequal } from "dequal";

import {
  type ColumnLayoutState,
  type GridView,
  hiddenColumnIds,
} from "./grid-view";

export type ViewField = "search" | "filter" | "sort" | "group" | "columns";

export interface ViewDiff {
  dirty: boolean;
  /** Which top-level fields diverge, in `GridView` declaration order. A UI can
   *  say "sort and columns changed" instead of only lighting up a dot. */
  changed: ViewField[];
}

/** Order-insensitive comparison of two id collections. */
function sameIds(a: Iterable<string>, b: Iterable<string>): boolean {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size !== y.size) return false;
  for (const id of x) {
    if (!y.has(id)) return false;
  }
  return true;
}

function columnsDiffer(
  current: ColumnLayoutState | undefined,
  baseline: ColumnLayoutState | undefined,
): boolean {
  // Each field inside the layout is tracked independently, by its presence in
  // the BASELINE - the same rule as the top level. A view that stores `order`
  // but not `sizes` must not flag dirty when someone resizes a column.
  const base = baseline ?? {};
  const live = current ?? {};

  if ("order" in base && !dequal(live.order ?? [], base.order ?? [])) {
    return true;
  }
  if (
    "visibility" in base &&
    !sameIds(
      hiddenColumnIds(live.visibility),
      hiddenColumnIds(base.visibility),
    )
  ) {
    return true;
  }
  // A view that has never been resized stores nothing; the live grid holds {}.
  if ("sizes" in base && !dequal(live.sizes ?? {}, base.sizes ?? {})) {
    return true;
  }
  // Pin order is not meaningful, so a reordered but identical list is clean.
  if ("pinned" in base && !sameIds(live.pinned ?? [], base.pinned ?? [])) {
    return true;
  }
  return false;
}

/**
 * Which parts of `current` diverge from `baseline`.
 *
 * `baseline` is a `Partial<GridView>`: a key it does not carry is NOT COMPARED.
 * That is the whole reason for the partial. A preset view stores no column
 * layout, and comparing it against one it never had flags every preset dirty
 * the moment it loads. Presence is tested with `in` rather than against
 * `undefined`, because `filter: null` means "explicitly unfiltered" and has to
 * stay distinguishable from "not tracked".
 *
 * A baseline of `{}` therefore tracks nothing and is never dirty, which is
 * correct: a view that stores no state cannot diverge from one.
 */
export function diffView(
  current: GridView,
  baseline: Partial<GridView>,
): ViewDiff {
  const changed: ViewField[] = [];

  if ("search" in baseline && current.search !== baseline.search) {
    changed.push("search");
  }
  if ("filter" in baseline && !dequal(current.filter, baseline.filter)) {
    changed.push("filter");
  }
  if ("sort" in baseline && !dequal(current.sort, baseline.sort)) {
    changed.push("sort");
  }
  if ("group" in baseline && !dequal(current.group, baseline.group)) {
    changed.push("group");
  }
  if ("columns" in baseline && columnsDiffer(current.columns, baseline.columns)) {
    changed.push("columns");
  }

  return { dirty: changed.length > 0, changed };
}

/** Whether a view has unsaved changes against the baseline it was loaded from. */
export function isViewDirty(
  current: GridView,
  baseline: Partial<GridView>,
): boolean {
  return diffView(current, baseline).dirty;
}
```

- [ ] **Step 4: Declare and install the dependency**

Add to `package.json`, directly above `"peerDependencies"` — this is the
package's first `dependencies` entry:

```json
  "dependencies": {
    "dequal": "^2.0.3"
  },
```

Run: `bun install`
Expected: `dequal` installed; `bun.lock` updated. Both files are committed.

- [ ] **Step 5: Guard against undeclared imports**

Adding a dependency creates a failure mode this repo has no test for: a bare
specifier that resolves locally through bun's hoisting but is declared nowhere,
so a consumer's install has no such package. That is the bug that made
`@tanstack/table-core` a peer. Append to `tests/entry-points.test.ts`:

```ts
describe("every package a source file imports is declared", () => {
  test("no entry point reaches an undeclared bare specifier", () => {
    // A specifier that resolves here through bun's hoisting but appears in
    // neither `dependencies` nor `peerDependencies` installs fine in this repo
    // and is missing in a consumer's - which is how `@tanstack/table-core`
    // shipped broken before it was made a peer.
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"),
    );
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    const entries = [
      "index.ts",
      "schema.ts",
      "server.ts",
      "layout/index.ts",
      "react/index.ts",
    ];

    const undeclared = new Set<string>();
    for (const entry of entries) {
      for (const [specifier, culprit] of reachableBarePackages(
        join(SRC, entry),
      )) {
        if (specifier.startsWith("node:")) continue;
        // "@scope/name/sub" -> "@scope/name";  "name/sub" -> "name"
        const name = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : (specifier.split("/")[0] as string);
        if (!declared.has(name)) undeclared.add(`${name} (src/${culprit})`);
      }
    }
    expect([...undeclared]).toEqual([]);
  });
});
```

- [ ] **Step 6: Export it from the barrel**

In `src/index.ts`, add after the `export * from "./threshold";` line, keeping the list alphabetical:

```ts
export * from "./view-diff";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/view-diff.test.ts && bun run typecheck && bun run lint`
Expected: all PASS.

- [ ] **Step 8: Confirm the dependency surface is still what we think**

Run: `bun test tests/entry-points.test.ts`
Expected: PASS — `dequal` is declared, and the three heavy optional peers are
still unreachable from the package root.

- [ ] **Step 9: Commit**

```bash
git add src/view-diff.ts src/index.ts tests/view-diff.test.ts tests/entry-points.test.ts package.json bun.lock
git commit -m "feat(view): diff a live view against its saved baseline

\`diffView\` answers \"does this view have unsaved changes?\", and names which
fields moved so a UI can say more than yes.

The baseline is a Partial on purpose: a key it does not carry is not
compared. A preset view stores no column layout, and comparing it against one
it never had flags every preset dirty the moment it loads. Presence is tested
with \`in\`, not against undefined, because \`filter: null\` means explicitly
unfiltered and must stay distinguishable from untracked.

Equality is structural, never JSON.stringify: Postgres jsonb does not preserve
key order, so a view round-tripped through the database comes back rearranged
and a stringify comparison reports a spurious diff after every save. Pins and
visibility compare as sets, since neither has meaningful order.

Comparison goes through \`dequal\` - MIT, dependency-free, and the same library
FireTable already compares saved views with. It is this package's first
runtime dependency, so entry-points gains a test that every bare specifier a
source file imports is actually declared: one that resolves here through bun's
hoisting but is declared nowhere installs fine in this repo and is missing in
a consumer's, which is how \`@tanstack/table-core\` shipped broken before it was
made a peer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Resolving a layout against a schema

**Files:**
- Create: `src/view-columns.ts`
- Modify: `src/index.ts`
- Test: `tests/view-columns.test.ts`

**Interfaces:**
- Consumes: `ColumnLayoutState` from Task 1; `SchemaColumn`, `isColumnVisible`, `buildVisibility` from `./column-schema`; `resolvePinnedColumns` from `./layout/model`.
- Produces:
  - `resolveColumnOrder<TData>(columns: readonly SchemaColumn<TData>[], layout: ColumnLayoutState | undefined): SchemaColumn<TData>[]`
  - `resolveColumnPins<TData>(columns: readonly SchemaColumn<TData>[], layout: ColumnLayoutState | undefined): { pinned: string[]; locked: string[] }`

This task extracts logic that currently lives inline in `DataGrid`'s `ordered` and `layout` memos, so it becomes testable without a DOM. Task 4 then deletes the inline copies.

- [ ] **Step 1: Write the failing tests**

Create `tests/view-columns.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { col, resolveColumnOrder, resolveColumnPins } from "../src";

type Row = { a: string; b: string; c: string; d: string };

const columns = [
  col<Row>({ id: "a", label: "A", type: ColumnTypes.TEXT, frozen: true }),
  col<Row>({ id: "b", label: "B", type: ColumnTypes.TEXT }),
  col<Row>({ id: "c", label: "C", type: ColumnTypes.TEXT }),
  // Hidden by the schema itself rather than by the user.
  col<Row>({ id: "d", label: "D", type: ColumnTypes.TEXT, visible: false }),
];

const ids = (out: { id: string }[]) => out.map((c) => c.id);

describe("resolveColumnOrder", () => {
  test("with no layout it falls back to schema order and schema visibility", () => {
    // `d` is `visible: false` in the schema, so it must not appear just
    // because the view carries no visibility record of its own.
    expect(ids(resolveColumnOrder(columns, undefined))).toEqual(["a", "b", "c"]);
  });

  test("the layout's order wins", () => {
    expect(ids(resolveColumnOrder(columns, { order: ["c", "a", "b"] }))).toEqual(
      ["c", "a", "b"],
    );
  });

  test("a column the order does not mention is appended", () => {
    // Adding a column to the schema must never make it silently invisible.
    expect(ids(resolveColumnOrder(columns, { order: ["c"] }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("unknown and duplicate ids in the order are ignored", () => {
    expect(
      ids(resolveColumnOrder(columns, { order: ["b", "nosuch", "b", "a"] })),
    ).toEqual(["b", "a", "c"]);
  });

  test("the layout's visibility replaces the schema's, both ways", () => {
    // Showing a schema-hidden column and hiding a schema-visible one.
    expect(
      ids(resolveColumnOrder(columns, { visibility: { d: true, b: false } })),
    ).toEqual(["a", "c", "d"]);
  });
});

describe("resolveColumnPins", () => {
  test("with no layout, the schema's frozen columns are the pins", () => {
    expect(resolveColumnPins(columns, undefined).pinned).toEqual(["a"]);
  });

  test("user pins join the schema's frozen columns", () => {
    expect(resolveColumnPins(columns, { pinned: ["c"] }).pinned).toEqual([
      "a",
      "c",
    ]);
  });

  test("a user pin that repeats a frozen column does not duplicate it", () => {
    expect(resolveColumnPins(columns, { pinned: ["a"] }).pinned).toEqual(["a"]);
  });

  test("locked matches pinned while there is no compact breakpoint", () => {
    // They only diverge under `compact: true`, which this library does not
    // expose yet. Pinned drives stickiness, locked drives the reorder
    // exclusion; wiring the right one now makes compact a config change later.
    const { pinned, locked } = resolveColumnPins(columns, { pinned: ["c"] });
    expect(locked).toEqual(pinned);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/view-columns.test.ts`
Expected: FAIL — `resolveColumnOrder` / `resolveColumnPins` are not exported.

- [ ] **Step 3: Create `src/view-columns.ts`**

```ts
// Resolving a view's column layout against a column schema.
//
// Pure, so the rules are testable without rendering anything - `<DataGrid>`
// held these inline and they could only be exercised through a DOM this
// package has no test harness for.

import type { RowData } from "@tanstack/react-table";
import {
  buildVisibility,
  isColumnVisible,
  type SchemaColumn,
} from "./column-schema";
import type { ColumnLayoutState } from "./grid-view";
import { resolvePinnedColumns } from "./layout/model";

/**
 * The columns to render, in order, with hidden ones dropped.
 *
 * A column the order does not mention is appended rather than dropped, so
 * adding one to the schema never makes it silently invisible. When the layout
 * carries no visibility record the schema's own `visible` flags apply - not
 * "everything is visible", which would show columns the schema hides.
 */
export function resolveColumnOrder<TData extends RowData>(
  columns: readonly SchemaColumn<TData>[],
  layout: ColumnLayoutState | undefined,
): SchemaColumn<TData>[] {
  const visibility = layout?.visibility ?? buildVisibility([...columns]);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: SchemaColumn<TData>[] = [];

  for (const id of layout?.order ?? []) {
    const column = byId.get(id);
    if (column && !seen.has(id)) {
      seen.add(id);
      out.push(column);
    }
  }
  for (const column of columns) {
    if (!seen.has(column.id)) out.push(column);
  }
  return out.filter((c) => isColumnVisible(c.id, visibility));
}

/**
 * Which columns are sticky (`pinned`) and which cannot be dragged (`locked`).
 *
 * The schema's `frozen` flag and the view's user pins are one list here. The
 * two results have identical contents today; they diverge only under the
 * `compact` mode `resolvePinnedColumns` supports and this library does not yet
 * expose, where a column stays locked while no longer being sticky.
 */
export function resolveColumnPins<TData extends RowData>(
  columns: readonly SchemaColumn<TData>[],
  layout: ColumnLayoutState | undefined,
): { pinned: string[]; locked: string[] } {
  return resolvePinnedColumns({
    compact: false,
    frozenColumns: columns.filter((c) => c.frozen).map((c) => c.id),
    userPinnedColumns: layout?.pinned,
  });
}
```

- [ ] **Step 4: Export it from the barrel**

In `src/index.ts`, add alongside the other `view-*` export, keeping alphabetical order:

```ts
export * from "./view-columns";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/view-columns.test.ts && bun run typecheck && bun run lint && bun test tests/entry-points.test.ts`
Expected: all PASS. The entry-points run matters: `view-columns` reaches into `./layout/model`, and that must not drag a package into the root bundle.

- [ ] **Step 6: Commit**

```bash
git add src/view-columns.ts src/index.ts tests/view-columns.test.ts
git commit -m "feat(view): resolve a column layout against a schema, testably

\`resolveColumnOrder\` and \`resolveColumnPins\` lift the rules out of
<DataGrid>'s memos, where they could only be exercised through a DOM this
package has no harness for. Both are pure and now have tests - including the
one that matters most: a layout with no visibility record falls back to the
SCHEMA's visible flags, not to \"everything is visible\".

\`resolveColumnPins\` finally calls the \`resolvePinnedColumns\` the package has
shipped and never used, so a user pin can join the schema's frozen columns.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `DataGrid` drops five props

**Files:**
- Modify: `src/react/DataGrid.tsx`
- Modify: `examples/grid.tsx`
- Modify: `demo/main.tsx`

**Interfaces:**
- Consumes: `resolveColumnOrder`, `resolveColumnPins` (Task 3); `ColumnLayoutState`, `GridView` (Task 1).
- Produces: `<DataGrid>` with no `columnOrder`, `onColumnOrderChange`, `columnSizes`, `onColumnSizesChange` or `columnVisibility` props.

There is no render test for this component. Its contract test is `examples/grid.tsx`, which `bun run typecheck` compiles.

- [ ] **Step 1: Remove the five props from the interface**

In `src/react/DataGrid.tsx`, delete these blocks from `DataGridProps`:

```ts
  /** Column order by id. Uncontrolled when omitted. */
  columnOrder?: readonly string[];
  onColumnOrderChange?: (order: string[]) => void;

  /** Column widths by id, overriding each column's own `width`. */
  columnSizes?: Readonly<Record<string, number>>;
  onColumnSizesChange?: (sizes: Record<string, number>) => void;
```

and the whole `columnVisibility?: Readonly<Record<string, boolean>>;` block including its long doc comment.

Extend the `view` prop's doc comment to name what it now carries:

```ts
  /**
   * Search, filter, sort, grouping and column layout in one object. Leave it
   * off and the grid keeps its own, so the minimal call still sorts and
   * resizes; pass it and the grid is fully controlled.
   *
   * Column order, widths, visibility and pins live in `view.columns`. They were
   * five separate props until 0.3.0; keeping both would have meant two sources
   * of truth for one piece of state.
   */
  view?: GridView;
```

- [ ] **Step 2: Replace the state and resolution**

Delete `ownOrder` and `ownSizes` entirely — the view is already the state container:

```ts
  const [ownSizes, setOwnSizes] = useState<Record<string, number>>({});
  const [ownOrder, setOwnOrder] = useState<string[]>(() =>
    columns.map((c) => c.id),
  );
```

Replace the resolution block (`const order = …` through `const visibility = …`) with:

```ts
  const activeView = view ?? ownView;
  const groupField = activeView.group?.field ?? "";
  const collapsed = collapsedGroups ?? ownCollapsed;
  const layoutState = activeView.columns;
  const sizes = layoutState?.sizes ?? EMPTY_SIZES;
```

Add this module-level constant near `cx`, so an unsized grid does not hand a
fresh object to `useMemo` on every render:

```ts
const EMPTY_SIZES: Readonly<Record<string, number>> = {};
```

Replace `setOrder` and `commitSizes` with a single patch helper plus the two callers:

```ts
  /** Patch only the column layout, leaving the rest of the view untouched.
   *  When the view carries no layout yet, the first drag creates one holding
   *  just the field that changed - so a grid that has only been resized
   *  reports exactly that, and the diff treats order as untracked. */
  const patchColumns = useCallback(
    (patch: Partial<ColumnLayoutState>) => {
      setView({ ...activeView, columns: { ...activeView.columns, ...patch } });
    },
    [activeView, setView],
  );

  const setOrder = useCallback(
    (next: string[]) => patchColumns({ order: next }),
    [patchColumns],
  );

  const commitSizes = useCallback(
    (patch: Record<string, number>) =>
      patchColumns({ sizes: { ...sizes, ...patch } }),
    [patchColumns, sizes],
  );
```

- [ ] **Step 3: Use the Task 3 resolvers**

Replace the whole `ordered` memo with:

```ts
  const ordered = useMemo(
    () => resolveColumnOrder(columns, layoutState),
    [columns, layoutState],
  );
```

Delete the now-unused `schemaVisibility` memo.

Replace the `layout` memo and the `participating` memo with:

```ts
  const pins = useMemo(
    () => resolveColumnPins(ordered, layoutState),
    [ordered, layoutState],
  );

  const layout = useMemo(
    () =>
      buildColumnLayout(
        ordered.map((c) => ({
          id: c.id,
          item: c,
          minWidth: c.minWidth,
          size: sizes[c.id] ?? c.width,
        })),
        pins.pinned,
      ),
    [ordered, sizes, pins],
  );
```

and, at the `participating` memo (keeping its existing comment):

```ts
  const lockedIds = useMemo(() => new Set(pins.locked), [pins]);
  const participating = useMemo(
    () => new Set(layout.filter((e) => !lockedIds.has(e.id)).map((e) => e.id)),
    [layout, lockedIds],
  );
```

- [ ] **Step 4: Fix the imports**

In `src/react/DataGrid.tsx`:
- Remove `buildVisibility` and `isColumnVisible` from the `../column-schema` import, leaving `type SchemaColumn`.
- Change the grid-view import to `import { type ColumnLayoutState, emptyGridView, type GridView } from "../grid-view";`
- Add `import { resolveColumnOrder, resolveColumnPins } from "../view-columns";`

- [ ] **Step 5: Update `examples/grid.tsx`**

Replace the `ControlledGrid` body's state and props. The three `useState`s for order, sizes and visibility collapse into the view:

```tsx
export function ControlledGrid({
  rows,
  initialView = { ...emptyGridView(), group: { field: "category" } },
}: {
  rows: readonly Row[];
  initialView?: GridView;
}) {
  const [view, setView] = useState<GridView>(initialView);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const hide = (id: string) =>
    setView((v) => ({
      ...v,
      columns: {
        ...v.columns,
        visibility: {
          ...v.columns?.visibility,
          [id]: !isColumnVisible(id, v.columns?.visibility),
        },
      },
    }));

  // The same record the grid reads, so the file is what is on screen.
  const exportColumns = selectExportColumns(
    columns,
    view.columns?.order ?? columns.map((c) => c.id),
    view.columns?.visibility ?? buildVisibility(columns),
    rows,
  );

  return (
    <>
      <button type="button" onClick={() => hide("price")}>
        Toggle Price ({exportColumns.length} columns export)
      </button>
      <DataGrid
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        renderCell={(column, row) => <Cell column={column} row={row} />}
        view={view}
        onViewChange={setView}
        collapsedGroups={collapsed}
        onCollapsedGroupsChange={setCollapsed}
        reorderable
        categoryOf={(id) => CATEGORY[id]}
      />
    </>
  );
}
```

- [ ] **Step 6: Update `demo/main.tsx`**

Delete the `order`, `sizes` and `visibility` `useState`s. Derive them from the view instead, immediately after the existing `conditions` line:

```tsx
  const order = view.columns?.order ?? columns.map((c) => c.id);
  const sizes = view.columns?.sizes ?? {};
  const visibility = view.columns?.visibility ?? buildVisibility(columns);
  const patchColumns = (patch: Record<string, unknown>) =>
    setView((v) => ({ ...v, columns: { ...v.columns, ...patch } }));
```

Change the visibility checkbox handler to:

```tsx
onChange={() =>
  patchColumns({
    visibility: {
      ...visibility,
      [c.id]: !isColumnVisible(c.id, visibility),
    },
  })
}
```

Remove `columnVisibility`, `columnOrder`, `onColumnOrderChange`, `columnSizes` and `onColumnSizesChange` from the `<DataGrid>` call — `view` and `onViewChange` already carry them. `reset` already calls `setView(emptyGridView())`, which now clears the layout too; delete the `setOrder`/`setSizes`/`setVisibility` lines from it.

- [ ] **Step 7: Verify the whole suite**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all PASS, 400+ tests. `tests/react-column-ops.test.ts` and `tests/column-visibility.test.ts` must pass **unchanged** — they test pure functions, so their passing proves the contract underneath did not move.

- [ ] **Step 8: Rebuild the demo page**

Run: `bun run demo`
Expected: `demo/index.html  ~544 KB`. This file is committed, so it must be rebuilt in the same commit as the source it renders.

- [ ] **Step 9: Commit**

```bash
git add src/react/DataGrid.tsx examples/grid.tsx demo/main.tsx demo/index.html
git commit -m "feat(react)!: DataGrid takes its column layout from the view

columnOrder, onColumnOrderChange, columnSizes, onColumnSizesChange and
columnVisibility are gone; all five live in \`view.columns\` and travel through
onViewChange. Keeping both would have meant two sources of truth for one piece
of state, and \"save this view\" has to be one object or it is not worth having.

The component loses its own order and sizes state with them - the view was
already the state container.

Order and pin resolution now go through the pure resolvers rather than inline
memos, so the rules are covered by tests instead of by a DOM harness that does
not exist here. The reorder exclusion reads \`locked\` where it read \`isPinned\`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Documentation and release

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: no code.

- [ ] **Step 1: Update the README's view section**

In the `## The view` section, replace the `GridView` snippet's type with one carrying a layout, and add this after the `isGridViewEmpty` paragraph:

````markdown
Column order, widths, visibility and pins live in `view.columns`, and every
field of it is optional — including `columns` itself. Absent means *this view
does not track that*, which is a real state: a preset view stores no layout, and
loading it leaves the current columns alone.

```ts
const view: GridView = {
  ...emptyGridView(),
  columns: { order: ["name", "price"], pinned: ["name"], sizes: { price: 160 } },
};
```

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
````

- [ ] **Step 2: Update the `<DataGrid>` prop example**

In the controlled `<DataGrid>` snippet, delete the `columnOrder`, `columnSizes`
and `columnVisibility` lines and update the `view` comment:

```tsx
  view={view} onViewChange={setView}             // search, filter, sort, group, columns
```

Then update the paragraph below it, which currently says "order, sizes, sorting
and collapsed groups are uncontrolled until you pass them", to read "the view
and collapsed groups are uncontrolled until you pass them, so sorting and
resizing work with no wiring".

- [ ] **Step 3: Add the new modules to the "What else is in the box" table**

```markdown
| `view-diff` | `diffView` / `isViewDirty` — does this view have unsaved changes, and which fields moved |
| `view-columns` | resolving a view's column layout against a schema: order, visibility, pins |
```

- [ ] **Step 4: Bump the version**

In `package.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 5: Full verification**

Run: `bun run typecheck && bun run lint && bun test && bun run build && bun run demo`
Expected: all PASS; the build emits `dist/`; the demo rebuilds to ~544 KB.

- [ ] **Step 6: Confirm the new surface reaches the built package**

Run: `grep -l "diffView\|resolveColumnPins\|ColumnLayoutState" dist/*.d.ts`
Expected: at least one match — the new exports are in the published types.

- [ ] **Step 7: Commit**

```bash
git add README.md package.json demo/index.html
git commit -m "docs: document the view's column layout and dirty diff, 0.3.0

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: `ColumnLayoutState` and the
constructors → Task 1; the seven dirty rules → Task 2 (one test `describe` each);
the `DataGrid` resolution table and `resolvePinnedColumns` wiring → Tasks 3 and 4;
the files-touched table → Tasks 1-5; the testing section → the tests in Tasks 1-3
plus the typecheck gate in Task 4. The spec's "out of scope" list (selection,
footer aggregates, compact breakpoint, URL encoding, FireTable adoption) has no
tasks, correctly.

**Deviation from the spec, recorded here.** The spec has `DataGrid` resolving
order and pins inline. Task 3 extracts them into `src/view-columns.ts` first.
The reason: this repo has no DOM test harness, so logic left inside the
component is reachable only through `typecheck`. Extracting makes the fallback
rule that matters most — a layout with no visibility record falls back to the
*schema's* `visible` flags, not to "everything visible" — an actual test. This
adds one file to the spec's list.

**Second deviation, recorded here.** Decision 4 of the spec originally had the
structural equal hand-written. It now uses `dequal`, and the spec records why
the original reasoning did not survive checking: `entry-points.test.ts` guards
three named heavy optional peers and `node:` builtins, not the dependency
surface in general. Task 2 gains the install step and a new test closing the
one gap a dependency actually opens — an imported package that nothing
declares.

**Placeholder scan.** No "TBD", "TODO", "handle edge cases", or "similar to Task
N". Every code step carries the real code.

**Type consistency.** `ColumnLayoutState` is defined in Task 1 and consumed by
the same name in Tasks 2, 3 and 4. `hiddenColumnIds` is defined in Task 1 and
used in Task 2's `columnsDiffer`. `resolveColumnOrder` / `resolveColumnPins` are
defined in Task 3 with the signatures Task 4 calls. `pins.pinned` / `pins.locked`
match `resolvePinnedColumns`'s existing `{ locked, pinned }` return. `EMPTY_SIZES`
is introduced and used in Task 4 only.
