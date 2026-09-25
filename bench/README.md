# Library performance baselines

Run these from the library worktree containing the changes you want to measure.
No database, credentials, Firetable application or network service is required.
The harness builds the current source, including uncommitted changes.

```sh
bun install
bunx playwright install chromium # once
bun run bench:core --profile --output=bench/results/core-baseline.json
bun run bench:core --output=bench/results/core-repeat.json
bun bench/core/compare.ts bench/results/core-baseline.json bench/results/core-repeat.json
bun run bench:frames --output=bench/results/browser-baseline.json
```

Use new output names when evaluating an optimization so the original baseline
remains available. `--quick` limits the core runner to 10,000 × 20. Existing
`bun run bench` Mitata suites remain available for Bun/JavaScriptCore; do not
compare their absolute times to the Chromium/V8 results.

## What is measured

The core runner covers numeric filtering, compiled predicates, global text
search, sorting, grouping, display-position maps, footer aggregates and column
layout/window calculation. The deterministic fixture uses seed 42 and shared
text pools. Four isolated browser contexts cover 10k × 20, 50k × 20, 50k × 200
and 100k × 20. Sorting is explicitly capped at 10k rows in every case.

Each case has five warmup batches and 21 timed samples; a preliminary measurement
calibrates batches toward 30 ms, capped at 5,000 calls. Each sample reports time
per call. Setup and fixture generation are outside timing. GC runs before each
case, but naturally occurring GC during samples remains included. Raw samples,
median, nearest-rank p95, browser/CPU details, commit, dirty flag, bundle hash
and lockfile hash are saved. Profiles run separately after timings; import the
`.cpuprofile` files into Chrome DevTools. Profile directories are ignored by git,
while timing results and profile summaries can be versioned.

Correctness checks compare numeric filtering and sorting with independent
references, check grouping row counts, verify the aggregate probe against each
existing average, and check stable results during sampling. These fixtures do
not replace the library's broader semantic tests.

The browser runner mounts the real DataGrid with production React and a minified
bundle. It first runs behavior gates for row identity, edits, selection, resizing,
column virtualization, pinning, focus and geometry. Timing scenarios cover:

- Server mode: 200 loaded rows with 20 or 200 columns.
- Client mode: 10,000 × 100 and 100,000 × 20, both virtualized.
- A matched 10,000 × 100 control with column virtualization disabled.

Each scenario has three fresh-page mounts and three scroll runs per direction.
Mount sync time excludes fixture generation, frame waiting and subsequent effects;
settled elapsed time includes two animation frames. Scroll tests use native scroll
events and 60 RAF intervals per run, without the legacy forced synchronous scroll
probe. They report main-thread task, script, style and layout time, mounted cells,
cell-render counts and frame intervals. Timed scroll runs have no CPU profiler or
trace enabled. The fixture uses plain cells and one input column, not Firetable's
rich vehicle cards. Paint/GPU time and isolated component heap are not claimed.

Horizontal scrolling sweeps the entire scrollable width, so wider schemas move
more columns per frame. Compare the same column count when evaluating a change.
These tests exclude database latency, cold network loading, editing workloads,
grouped browser rendering, non-Chromium engines and low-end devices. They are a
baseline, not proof of universal 60 fps or full feature parity.

## Interpreting changes

`core/compare.ts` verifies that the browser, machine, workload names and output
checksums match before showing median deltas. Positive deltas mean slower.
It deliberately does not fail CI on arbitrary timing thresholds. Check repeat
runs and absolute costs; a 50% change in a two-microsecond function is usually
less useful than eliminating a 30-millisecond scan.

`aggregate/batched-ten-averages` measures the production batch API against the
existing single-column calls in `aggregate/ten-averages`.

`probe/fused-ten-averages` is a benchmark-only experiment that computes the same
fixture averages in one traversal. It does not change the shipped aggregate API.
The raw numeric sort is a lower-bound comparison for finite numeric rows, not a
replacement for the library's custom sorting, null and mixed-type semantics.

See [the measured findings](results/analysis.md) for the current priorities.

The browser runner also includes a 100k-row client grid with a footer accessor
counter. It asserts one initial scan and zero aggregate reads during scrolling.
See [the aggregate optimization results](results/batched-aggregates.md).
