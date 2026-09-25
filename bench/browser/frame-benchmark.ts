import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { summarize } from "../core/stats";

/** Native scroll events and real animation frames; no flushSync scroll probe. */
export async function benchmarkFrames(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const scenarios = [
    {
      rows: 200,
      columns: 20,
      dataMode: "server" as const,
      virtualizeColumns: true,
    },
    {
      rows: 200,
      columns: 200,
      dataMode: "server" as const,
      virtualizeColumns: true,
    },
    {
      rows: 10_000,
      columns: 100,
      dataMode: "client" as const,
      virtualizeColumns: true,
    },
    {
      rows: 100_000,
      columns: 20,
      dataMode: "client" as const,
      virtualizeColumns: true,
    },
    {
      rows: 10_000,
      columns: 100,
      dataMode: "client" as const,
      virtualizeColumns: false,
    },
    {
      rows: 100_000,
      columns: 20,
      dataMode: "client" as const,
      virtualizeColumns: true,
      footer: true,
      trackAggregateReads: true,
    },
  ];
  const report = [];
  for (const scenario of scenarios) {
    const mounts = [];
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await page.waitForFunction(() => Boolean(window.gridBench));
      await cdp.send("HeapProfiler.collectGarbage");
      const mount = await page.evaluate(
        (s) =>
          window.gridBench.mount(s.rows, s.columns, { ...s, pinned: ["c0"] }),
        scenario,
      );
      assert(
        mount.domRows > 10 && mount.domRows < 35,
        "Expected bounded, nonempty viewport",
      );
      if (scenario.footer)
        assert.equal(
          mount.aggregateReads,
          scenario.rows,
          "mount must aggregate once",
        );
      mounts.push(mount);
    }
    const runs = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      for (const direction of ["vertical", "horizontal"] as const) {
        await page.locator(".ftg-frame").evaluate(async (el) => {
          el.scrollTop = 640;
          el.scrollLeft = 0;
          for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        });
        await cdp.send("HeapProfiler.collectGarbage");
        const before = await cdp.send("Performance.getMetrics");
        const result = await page
          .locator(".ftg-frame")
          .evaluate(async (el, direction) => {
            const intervals: number[] = [];
            const beforeRenders = window.gridBench.state().renders;
            const beforeAggregateReads =
              window.gridBench.state().aggregateReads;
            let previous: number | undefined;
            for (let i = 0; i <= 60; i++) {
              const now = await new Promise<number>(requestAnimationFrame);
              if (previous !== undefined) intervals.push(now - previous);
              previous = now;
              if (direction === "vertical") el.scrollTop = 640 + i * 32;
              else
                el.scrollLeft =
                  ((i % 20) / 19) * (el.scrollWidth - el.clientWidth);
            }
            await new Promise(requestAnimationFrame);
            return {
              intervals,
              cellRenders: window.gridBench.state().renders - beforeRenders,
              aggregateReadsDuringScroll:
                window.gridBench.state().aggregateReads - beforeAggregateReads,
              ...window.gridBench.state(),
              scrollLeft: el.scrollLeft,
              scrollTop: el.scrollTop,
            };
          }, direction);
        assert.equal(
          result.aggregateReadsDuringScroll,
          0,
          "scrolling must not read aggregate values",
        );
        const after = await cdp.send("Performance.getMetrics");
        const get = (metrics: typeof after, name: string) =>
          metrics.metrics.find((m) => m.name === name)?.value ?? 0;
        const delta = (name: string) =>
          (get(after, name) - get(before, name)) * 1000;
        const run = {
          repetition,
          direction,
          frame: summarize(result.intervals),
          framesOver25ms: result.intervals.filter((ms) => ms > 25).length,
          taskMs: delta("TaskDuration"),
          scriptMs: delta("ScriptDuration"),
          layoutMs: delta("LayoutDuration"),
          styleMs: delta("RecalcStyleDuration"),
          cellRenders: result.cellRenders,
          aggregateReadsDuringScroll: result.aggregateReadsDuringScroll,
          domRows: result.domRows,
          dataCells: result.dataCells,
          domCells: result.domCells,
        };
        runs.push(run);
        console.log(
          JSON.stringify({
            ...scenario,
            ...run,
            frame: { medianMs: run.frame.medianMs, p95Ms: run.frame.p95Ms },
          }),
        );
      }
    }
    report.push({
      ...scenario,
      mounts,
      mountSync: summarize(mounts.map((m) => m.syncMs)),
      runs,
    });
  }
  await cdp.detach();
  return report;
}
