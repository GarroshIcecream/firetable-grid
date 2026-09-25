import type { Page } from "@playwright/test";

/** Same production grid and data, changing only the column-window option. */
export async function benchmarkColumns(page: Page) {
  const report = [];
  for (const enabled of [false, true, true, false]) {
    const mount = await page.evaluate(
      (enabled) =>
        window.gridBench.mount(10_000, 100, {
          virtualizeColumns: enabled,
          pinned: ["c0"],
        }),
      enabled,
    );
    for (const direction of ["vertical", "horizontal"] as const) {
      const samples = [];
      for (let i = -5; i < 30; i++) {
        const sample = await page.evaluate(
          ({ direction, i }) =>
            window.gridBench.scroll(
              direction === "vertical" ? 640 + i * 32 : 640,
              direction === "horizontal" ? 3300 + i * 110 : 5500,
            ),
          { direction, i },
        );
        if (i >= 0) samples.push(sample);
      }
      const work = samples.map((s) => s.workMs).sort((a, b) => a - b);
      const renders = samples.map((s) => s.renderedCells).sort((a, b) => a - b);
      const item = {
        enabled,
        direction,
        rows: 10_000,
        columns: 100,
        mount,
        medianWorkMs: (work[14] + work[15]) / 2,
        p95WorkMs: work[28],
        medianCellRenders: renders[15],
        domRows: samples[15].domRows,
        dataCells: samples[15].dataCells,
        domCells: samples[15].domCells,
        samples,
      };
      report.push(item);
      console.log(
        JSON.stringify({ ...item, mount: undefined, samples: undefined }),
      );
    }
  }
  return report;
}
