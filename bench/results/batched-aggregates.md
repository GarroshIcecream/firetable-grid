# Batched footer aggregates — implementation results

The production grid now uses `computeRowsAggregates` from `firetable-grid/layout`.
It accepts raw rows and computes the requested local totals in one traversal,
without allocating `{ original }` wrappers. The existing single-column
`computeRowsAgg` API remains unchanged.

DataGrid caches completed totals by column for each immutable data/configuration
snapshot. Scrolling, selection, resizing and columns leaving/reentering the
viewport reuse those totals. Replacing rows, columns, aggregate configuration or
server values resets the cache. Newly mounted columns are computed lazily; hidden
or unmounted columns and server-answered values do not enter the local batch.
Server mode never computes a full-result total from its loaded page.

## Measured production gain

Same deterministic fixtures, Apple M2 and Chromium 153.0.8010.12 as the baseline.
Two complete runs, 21 timed samples per case after warmup. The comparison below
uses the existing repeated single-column calls and the new production batch in
each run, so both see the same process, dataset and build:

| Ten averages over | Separate scans, run 1 / 2 | Production batch, run 1 / 2 | Reduction |
| --- | ---: | ---: | ---: |
| 10k rows × 20 columns | 0.988 / 0.993 ms | 0.833 / 0.840 ms | 15–16% |
| 50k × 20 | 14.45 / 15.80 ms | 4.17 / 4.20 ms | 71–73% |
| 50k × 200 | 47.80 / 50.00 ms | 28.40 / 29.10 ms | 41–42% |
| 100k × 20 | 40.30 / 41.80 ms | 8.33 / 8.90 ms | 79% |

These are production helper timings, not the earlier average-only prototype.
The old prototype remains separately labeled in the harness. The gain is specific
to a batch of ten averages; it is not a whole-grid speedup or a database speedup.
Server-mode grids already bypass these local scans.

- [Production core run](core-batched-aggregates.json)
- [Independent repeat](core-batched-aggregates-repeat.json)
- [Browser runs, including a 100k-row footer](browser-batched-aggregates.json)

## Correctness and invalidation checks

A browser regression first reproduced 3,000 accessor reads for a 1,000-row footer
during initial layout. The first memoized implementation still read 2,000 times
with column virtualization enabled. The final cache reads those rows once and
performs zero additional reads during either scroll direction, selection or a
column leaving and returning to the viewport.

The browser gates also verify changed totals after row replacement, switching
sum to average, replacing server values with explicit null and numeric answers,
removing an override, filtering, and an empty result. Unit tests cover mixed
columns, accessorKey/custom accessors, nonnumeric values, zero, fractional values,
NaN, infinities, empty input and parity with the existing aggregation API.
A failed batch is not published to the cache.

All 36 timed browser scroll sequences had zero frame intervals over 25 ms on
this machine. The 100k-row footer scenario read each row once at mount and
recorded zero aggregate reads during both scroll directions.

The full library suite passed: 618 tests, 28 skipped live/integration cases,
zero failures. Typecheck, production build and browser behavior checks passed.
The built `firetable-grid/layout` export is also checked as a consumer import.

## Reproduce

```sh
bun run bench:core --output=bench/results/core-batched-aggregates.json
bun run bench:core --output=bench/results/core-batched-aggregates-repeat.json
bun bench/core/compare.ts bench/results/core-batched-aggregates.json bench/results/core-batched-aggregates-repeat.json
bun run bench:frames --output=bench/results/browser-batched-aggregates.json
```

The raw reports retain source hashes, runtime details and samples. Keep timing
runs separate from builds/tests. See [methodology](../README.md) for limitations.
The next browser target remains horizontal cell rendering/layout; search and
sorting remain separate measured opportunities.
