# Current library baseline — 2026-09-25

The first optimization is now implemented: [batched aggregate results](batched-aggregates.md).
The measurements below preserve the original pre-optimization baseline.

Measured the SQL/Drizzle and column-virtualization worktree at commit `8103b31`
with its uncommitted changes. No library implementation was optimized during this
measurement. The aggregate alternative below exists only in the benchmark.

Environment: Apple M2, 8 logical CPUs, macOS arm64, Chromium 153.0.8010.12.
[Core baseline](core-baseline.json) and [independent repeat](core-repeat.json)
contain the same compiled core bundle hash and fixture outputs. Each core case
has 21 samples after warmup. [Browser baseline](browser-baseline.json) contains
three runs per scenario/direction. See [methodology and commands](../README.md).

## Priorities supported by measurements

| Candidate | Workload | Current median, two runs | Probe / evidence | Priority |
| --- | --- | ---: | --- | --- |
| Combine footer aggregates into one traversal | 100k rows × 20 columns, ten averages | 49.7 / 49.2 ms | Same fixture averages: 7.43 / 7.33 ms, about 85% less time | First client-core optimization |
| Same aggregate change on wide rows | 50k × 200, ten averages | 52.2 / 51.9 ms | Single traversal: 29.2 / 28.2 ms, about 44–46% less time | Confirms gain across row shapes |
| Avoid repeating a full broad-search scan while typing | 50k × 200, all searchable text fields | 66.1 / 65.8 ms | Separate profile dominated by regex matching and per-cell access | Investigate indexing/caching with invalidation and memory costs |
| Reduce general table machinery in the sorting path | 10k numeric rows, 20-column fixture | 13.2 / 13.13 ms | Stable numeric reference: 2.97 / 3.01 ms; profile includes TanStack comparison/value-cache work | Prototype a compatible fast path, not a wholesale comparator replacement |
| Reduce horizontal cell creation / layout work | 10k × 100, column window enabled | 339.8 ms main-thread work per ~1s sweep | 7,125 cell render calls; script 122.4 ms, layout 67.2 ms per sweep | Highest browser-rendering target for ORM-paged grids |

The aggregate probe checks every output against the existing function. Its gain
combines improved row locality with doing only the requested average work; it does
not prove how much each individual change contributes. A production implementation
must preserve accessor, null, NaN, count, min/max and empty-input semantics and
connect a batched result to the footer render path.

The raw sort is only a lower-bound reference for this finite numeric fixture.
It does not cover custom comparators, undefined values, dates, multi-sort or
schema accessors. The profile identifies comparison/value lookup overhead, but
does not isolate table construction as the dominant cost. Sorting the 10k slice
inside the 50k × 200 workload varied from 13.8 to 18.9 ms between full runs;
therefore small sorting changes need more repeats before claiming a win.

Search only includes columns marked searchable (text in this fixture); it does
not search all 200 columns. Its cost grows with both the number of searchable
fields and wider row storage. No indexed-search speedup is claimed: an index
needs an explicit update policy, matching semantics and memory measurements.

## Browser behavior and tradeoffs

These are medians across three ~one-second scroll sequences, using native
scroll events, with a 1200 × 512 viewport and 32-pixel rows:

| Mode / loaded data | Sync mount median | Vertical task time | Horizontal task time |
| --- | ---: | ---: | ---: |
| Server, 200 × 20 | 4.2 ms | 189.9 ms | 228.9 ms |
| Server, 200 × 200 | 5.1 ms | 181.5 ms | 418.6 ms |
| Client, 10k × 100 | 7.6 ms | 181.9 ms | 339.8 ms |
| Client, 100k × 20 | 28.0 ms | 188.4 ms | 220.3 ms |
| Client, 10k × 100, column window disabled | 15.6 ms | 375.1 ms | 190.2 ms |

Both row and column virtualization are enabled unless stated otherwise. All
30 scroll sequences had a median interval near 16.7 ms and zero intervals over
25 ms on this machine. This does not mean a 189 ms frame: task time is the sum
across the entire sequence. It also excludes a GPU/paint attribution claim.

At the matched 10k × 100 size, column virtualization reduces mounted data/selection
cells from 2,525 to 350 (375 total body cells including spacers), reduces vertical
cell render calls from 5,900 to 767, and cuts vertical task time by about 51%.
Horizontal sweeps show the expected tradeoff: the unwindowed grid can scroll
existing DOM without rendering new cells, while the windowed grid replaces cells
and updates layout. Preserve the vertical/DOM gain while investigating that cost.
The wide-schema sweeps cover more distance per frame, so the 20- and 200-column
horizontal figures are not an equal-distance comparison.

For ORM-backed server mode, client sorting/filtering/aggregate scans are bypassed.
The useful next optimization there is horizontal rendering or keeping loaded
pages bounded, not speeding up an unused client aggregate scan. The mount results
are unsorted and unfiltered; they do not measure a 100k-row sort interaction.

## Lower priorities

At 50k × 200, column layout takes roughly 5–6 microseconds and the column-window
calculation roughly 2–3 microseconds. This is far below the measured horizontal
render/layout work. Replacing its linear scans with a more elaborate index is not
the first optimization supported by this baseline.

Grouping 50k wide rows costs about 2.3–2.6 ms and its display-position map costs
1.6 ms. At 100k narrow rows, those costs rise to roughly 4–5 ms and 3.7–4.5 ms.
An ungrouped arithmetic display-position path could avoid maps and intermediate
objects, but the measured aggregate/search opportunities are larger.

## Reproducibility and limits

The two core runs contain 2,352 timed samples in total. Timing noise remains:
individual cases moved with GC, cache state and JIT behavior. The large aggregate
and wide-search costs repeated; tiny percentage differences are not actionable.
The fresh contexts isolate row-size heaps, but cases within each context share the
fixture and execute in a fixed order. Future optimization comparisons should use
repeat runs and, where relevant, alternate implementations in both orders.

The baseline covers deterministic synthetic data and Chromium only. It does not
measure SQL compilation/execution, network fetching, exports, grouped-grid browser
interactions, slow devices or every custom cell renderer. Keep the existing Mitata
and behavior suites alongside this baseline. Do not treat the benchmark-only
aggregate probe or numeric reference comparator as production-ready code.
