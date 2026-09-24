# SQL data sources: plug a Postgres driver or ORM into the grid

Status: design, awaiting review. Date: 2026-09-24.

## Goal

"firetable-grid works with your ORM or Postgres driver, or with no database."
A developer keeps the query they already write — joins, CTEs, aggregates,
tenant scoping — and hands it to the grid. The grid's `GridView` (search,
filter, sort, grouping) is compiled to parameterized Postgres SQL around that
query, and the result comes back in the shape `<DataGrid>` already takes.
Without a database nothing changes: the in-memory engine stays the default and
gains the same request/response interface.

Success means:

- `pg` and Drizzle each plug in with about five lines, shown in the README.
- One parity suite proves every source (memory, pg, Drizzle) returns the same
  rows, in the same order, for the same view.
- Column types and enum values are inferred from the source where the source
  knows them, and the developer states only what it cannot know.

## Scope

In v1:

- `runGrid`: filters, search, sort, total count, one page (limit/offset).
- Column inference: `describe()` on each source, `defineColumns` to merge it
  with a developer spec.
- Sources: `memorySource`, `pgSource` (node-postgres and anything with its
  `query(text, values)` shape, e.g. Neon's `Pool`), `drizzleSource`.
- Request validation (`parseGridRequest`) and a paging helper for the client
  (`nextGridPage`).

Deliberately later, on the same source interface:

- Group headers with counts, footer aggregates over the filtered set.
- Streaming CSV/XLSX from a cursor.
- Kysely, Prisma and postgres.js adapters (a postgres.js recipe ships in the
  README; its `sql.unsafe(text, values)` fits `pgSource`'s queryable shape).
- An "inject into your WHERE" mode for queries the wrap mode below is too slow
  for.
- Keyset pagination; a codegen CLI for column specs.
- AI-driven filtering (it will emit a `GridView`, so it lands on this compiler
  unchanged).

Not planned: any other SQL dialect in v1; the package fetching over the network
from the browser.

## Architecture

### Wrap mode

The developer's query becomes a subquery. The grid never edits it:

```sql
SELECT * FROM ( <developer query> ) AS grid
WHERE  <search> AND <filter>
ORDER BY <group field>, <sort rules>, grid.<rowKey>
LIMIT $n OFFSET $m
```

and, when a count is requested, `SELECT count(*) FROM ( <developer query> ) AS
grid WHERE <search> AND <filter>` with the same parameters.

Consequences, all documented:

- Grid columns refer to `grid."<column id>"`. If the developer's `SELECT` names
  its outputs after the column ids, no mapping is needed. Computed and joined
  columns are ordinary columns to the grid.
- **One row of the developer's query is one grid row.** A one-to-many join must
  be collapsed (`GROUP BY` + aggregates, `array_agg`) in the query. Duplicate
  rows are the developer's bug, and the README says so with an example.
- Only columns the query selects can be filtered or sorted.
- Postgres pulls simple subqueries up, so predicates reach base-table indexes.
  It cannot push a predicate past `GROUP BY`, `DISTINCT` or window functions: a
  filter on an aggregated column runs after aggregation. The README names this
  and the later inject mode is the escape hatch.
- `contains` and search compile to `ILIKE '%…%'`; the README recommends a
  `pg_trgm` index for large tables.

### Modules and entry points

| Entry point | Contents | Runtime deps |
|---|---|---|
| `firetable-grid/sql` | `runGrid`, `compileGridQuery`, `defineColumns`, `columnSpec`, `parseGridRequest`, `nextGridPage`, `memorySource`, the `sql` fragment tag, types | none (zod stays in `/schema`; see validation) |
| `firetable-grid/pg` | `pgSource`, re-export of `sql` | none; `pg` is structural, never imported |
| `firetable-grid/drizzle` | `drizzleSource`, `describeDrizzle` | `drizzle-orm` (optional peer) |

`tests/entry-points.test.ts` is extended: the package root and `/sql` must not
reach `drizzle-orm`, and `/pg` must not import `pg` at runtime.

Units, each testable alone:

1. **Fragment** (`sql` tag). A tagged template producing `{ chunks, values }`.
   Fragments nest; rendering renumbers `$n` across the whole statement, so the
   developer's `${tenantId}` and the grid's parameters never collide. There is
   no raw-string escape hatch in v1. Identifiers are quoted by the compiler and
   are always column ids already validated against the column list.
2. **Compiler** (`compileGridQuery(view, columns, options)`). Pure: view +
   columns → `{ where, orderBy }` fragments. Owns every filter rule. No driver,
   no I/O.
3. **Runner** (`runGrid(source, request, options)`). Fills in option defaults
   and hands the request to the source, which returns a `GridResult`.
4. **Sources.** Each implements:

   ```ts
   interface GridSource<TRow> {
     query(input: GridQueryInput): Promise<GridResult<TRow>>;
     describe(): Promise<DescribedColumns> | DescribedColumns;
   }
   interface GridQueryInput {
     view: GridView; page: GridPage; columns: readonly SchemaColumn<any>[];
     count: boolean; timeZone: string;
   }
   ```

   The interface takes the view, not SQL, so `memorySource(rows)` implements
   it over `applyView` and `sortRowsForExport`, and a route written against it
   moves to Postgres by swapping the source. The SQL sources share one
   internal `createSqlSource({ base: Fragment, rowKey, execute(text, values) })`
   that compiles, renders and runs the page and count statements; `pgSource`
   and `drizzleSource` differ only in `execute` and `describe`. `runGrid` is
   the public entry point that fills in option defaults and calls
   `source.query`.
5. **Inference** (`defineColumns(described, spec, display?)`). Merges what the
   source described with the developer's spec into `SchemaColumn[]`.
6. **Request validation** (`parseGridRequest(body, columns, { maxLimit })`).

## Public API

### Types

```ts
interface GridPage { limit: number; offset: number }
interface GridRequest { view: GridView; page: GridPage }
interface GridResult<TRow> { rows: TRow[]; total?: number; page: GridPage }

interface DescribedColumn {
  id: string;
  pgType: string | null;       // "int4", "numeric", "timestamptz", "text[]", enum type name; null = unknown
  kind: "number" | "text" | "date" | "boolean" | "enum" | "array" | "json" | "unknown";
  nullable: boolean | null;    // null = the source cannot tell (pg LIMIT 0)
  enumValues?: readonly string[];  // in declaration order
  computed?: string;           // human hint for error messages, e.g. "count(photos.id)"
}
type DescribedColumns = readonly DescribedColumn[];  // plain JSON: safe to send to the browser
```

### Sources

```ts
// pg
pgSource<TRow>(pool: PgQueryable, { query: Fragment, rowKey: string }): GridSource<TRow>
type PgQueryable = {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[]; fields: { name: string; dataTypeID: number }[] }>;
};

// Drizzle: TRow inferred from the select
drizzleSource(query: PgSelect, { rowKey: string }): GridSource<InferredRow>
describeDrizzle(fields: SelectedFields): DescribedColumns   // synchronous, no database
```

`rowKey` is required. It is appended to every `ORDER BY` so rows with equal sort
values keep a stable order across pages.

### Running a request

```ts
runGrid(source, request, {
  columns,                 // SchemaColumn[] — needed for filter semantics
  count?: boolean,         // default true; false for infinite scroll without a total
  timeZone?: string,       // default "UTC"; the day a timestamptz belongs to
}): Promise<GridResult<TRow>>
```

### Column inference

```ts
const listingSpec = columnSpec({
  price:      { type: ColumnTypes.CURRENCY },
  photoCount: { type: ColumnTypes.NUMBER },
  make:       { searchable: true, category: "vehicle" },
  id:         { visible: false, manageable: false },
});

defineColumns(described, listingSpec, {
  types?: { number?, text?, date?, boolean?, enum?, array? }, // kind → ColumnType fallback
  label?: (id) => string,                 // default: the id (fine on the server)
  description?: (id) => string | undefined,
  enumLabel?: (id, value) => string,      // default: the value
})
```

Rules:

- A spec entry wins over inference for every field it sets.
- The column type comes from the spec, else from `types[kind]`. A column whose
  kind is `unknown` and has no spec type throws, naming the column and its
  `computed` hint:
  `defineColumns: can't infer a type for "photoCount" (computed: count(photos.id)). Add it to the spec: photoCount: { type: ColumnTypes.NUMBER }`.
  No silent "text" fallback: it would give the wrong operators.
- Enum values become `filterOptions` in declaration order, labelled through
  `enumLabel`. That also gives enum columns declaration-order sorting, as
  in memory.
- Array columns of text become set-valued enum columns when the spec gives them
  an enum type with `setValued`.
- Spec keys that the source did not describe throw (a typo must not silently
  produce a column that is never filled).
- Column order follows the source's select order.

`columnSpec` is an identity function that exists for type inference and
autocomplete; the spec is plain data importable on server and client.

### Client paging

The package does not fetch. `nextGridPage(last: GridResult<unknown>): GridPage
| undefined` plugs into TanStack Query's `getNextPageParam`, SWR's infinite
loader, or a hand-written loop:

- With `total`: next offset while `offset + limit < total`.
- Without it (`count: false`): a page shorter than `limit` is the last.

The README recipe uses `useInfiniteQuery` with the view in `queryKey`,
`keepPreviousData`, an `AbortSignal`, a guarded `onEndReached`, and memoized
flattened rows.

## Filter semantics in SQL

The in-memory engine (`src/filter-engine.ts`) is the specification. Every rule
below is pinned by the parity suite rather than by this table.

| View element | SQL |
|---|---|
| unset value (`""`, `NaN` numeric, no date bounds) | no condition |
| `is empty` | `x IS NULL`, or blank text (`btrim(x::text) = ''`), or numeric `'NaN'` |
| `is not empty` | the negation |
| text / enum `is`, `is not` | `lower(x::text) = lower($)` / `<>`; empty rows excluded unless the value is empty |
| `contains` | `x::text ILIKE '%' \|\| $ \|\| '%'` with `%`, `_`, `\` escaped in `$` |
| multi-select `is` / `is not` (comma value) | `lower(x::text) = ANY($::text[])`, tokens trimmed, lowercased, blanks dropped |
| set-valued enum (`text[]`) | overlap on lowercased elements; `is not` → `NOT coalesce(overlap, false)`, so a null row passes `is not` as in memory |
| set-valued enum (comma-joined `text`) | same, over `string_to_array(x, ',')` with elements trimmed |
| numeric `= ≠ > < ≥ ≤` | `x op $::numeric`; `ratioStored` divides the typed value by 100 first |
| date `on / before / after / between` | compare the day: `x::date` for `date`/`timestamp`, `(x AT TIME ZONE $tz)::date` for `timestamptz`; open-ended `between` sides drop out |
| operator a column type does not define | same fallback as memory (non-empty / parsable passes) |
| `all` / `any` | `AND` / `OR`, parenthesized; empty branches removed first |
| search | `OR` of `x::text ILIKE` over `searchable` columns, AND-ed with the filter; no searchable columns → `FALSE` |
| sort | per rule, then `rowKey`; enum columns with fixed options sort by `array_position($options, x)`, Postgres enums by their declaration order |

Where SQL and memory cannot agree, the difference is chosen and documented
rather than hidden:

- **Unknown field.** Memory skips a condition on an unknown column. The server
  rejects it in `parseGridRequest` (400), since a dropped filter on the server
  means returning rows the user asked to exclude.
- **Text ordering** follows the database collation; memory uses TanStack's
  comparators. The parity suite pins numeric, date, enum and null placement,
  and documents text order as collation-dependent.
- **Null placement** in sorts is fixed to match what the in-memory sort does
  (determined and pinned while implementing; the SQL emits explicit
  `NULLS FIRST/LAST` to match).
- **JS-only columns.** A column with `getFilterValue` or `sortingFn` cannot run
  in SQL. The compiler throws when a view filters or sorts on one, with a
  message pointing at exposing the value in the query.
- **Group.** `view.group` is prepended to `ORDER BY` so each page arrives with
  its groups contiguous; group counts come with the later groups piece.
- `view.columns` (layout) is ignored by the server.

## Validation and errors

- `parseGridRequest(body, columns, { maxLimit = 1000 })` checks the request's
  shape, that every field names a known column, that every operator is one that
  column allows, that sort and group fields are sortable/groupable, and that
  `limit` is within `1..maxLimit` and `offset ≥ 0`. It throws `GridRequestError`
  (with `issues`) for the route to map to 400. It is hand-written, so `/sql`
  stays zod-free; the existing `/schema` entry point may later expose a zod
  schema of the same shape.
- Configuration mistakes (unknown spec key, untyped computed column, JS-only
  column in SQL) throw `GridConfigError` with the column named and the fix
  stated.
- Database errors propagate unchanged.

## Inference per source

- **pg.** `describe()` runs `SELECT * FROM (<query>) grid LIMIT 0` and reads
  `fields[].dataTypeID`, then one catalog query resolves those OIDs through
  `pg_type` (base, array element, enum) and `pg_enum` (labels in
  `enumsortorder`). Nullability is unknown (`null`). The result is cached per
  queryable and query text, parameters excluded.
- **Drizzle.** `describeDrizzle(fields)` reads column objects (`dataType`,
  `columnType`, `enumValues`, `notNull`). Aliased `sql` expressions are
  `unknown` with a `computed` hint. It needs no database, so a fields object
  importable in the browser describes there directly.
- **memory.** `describe()` is not inferred from data: it returns the columns
  it was given.

## Testing

- **Parity suite.** One table of `(view, expected ids in order)` cases over one
  fixture dataset, run against `memorySource`, `pgSource` and `drizzleSource`.
  Postgres in tests is PGlite (`@electric-sql/pglite`, dev dependency) so
  `bun test` needs no Docker; Drizzle runs on its PGlite driver. The fixture
  covers nulls, blanks, `NaN`, case, set-valued arrays and comma text, ratios,
  dates near midnight in several zones, ties for paging, and a join collapsed
  by `GROUP BY`.
- **Compiler unit tests.** Fragment rendering and `$n` renumbering, escaping of
  `ILIKE` metacharacters, identifier quoting, no user text outside `values`.
- **Paging.** Walking every page of a sort with heavy ties yields each row once.
- **Inference.** OID and Drizzle column mapping, enum order, the thrown messages.
- **Validation.** Each `GridRequestError` issue.
- **Entry points.** The bundle-isolation rules above.
- **Bench.** `bun run bench` gains a compile-cost case; SQL execution time is
  the database's, not measured here.

## Risks and checks during implementation

- Drizzle internals: getting a select's fields and wrapping it as a subquery
  while keeping its column decoders. Verify on the current `drizzle-orm`
  before committing to `drizzleSource(query)` over
  `drizzleSource(db, fields, from)`.
- node-postgres returns `numeric` and `bigint` as strings. Filtering is
  unaffected (it runs in SQL), but rows arrive as strings unless the developer
  casts (`::float8`, `::int`) or sets type parsers. The README says so.
- PGlite and server Postgres agreeing on collation and `AT TIME ZONE` for the
  parity cases.
- `count(*)` over a large join is slow; `count: false` is the documented answer.
