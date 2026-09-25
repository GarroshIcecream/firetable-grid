import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { chromium } from "@playwright/test";
import type { BrowserBench } from "./app";
import { benchmarkColumns } from "./column-benchmark";
import { checkColumnWindow } from "./columns";
import { checkFooterAggregation } from "./footer";
import { benchmarkFrames } from "./frame-benchmark";

declare global {
  interface Window {
    gridBench: BrowserBench;
  }
}
const args = process.argv.slice(2);
const framesOnly = args.includes("--frames");
const checkOnly = args.includes("--check-only");
const columnsOnly = args.includes("--columns");
const baselinePath = args.find((a) => a.startsWith("--baseline="))?.slice(11);
const output = args.find((a) => a.startsWith("--output="))?.slice(9);
const capture = args.find((a) => a.startsWith("--capture="))?.slice(10);
const bundle = await Bun.build({
  entrypoints: [`${import.meta.dir}/app.tsx`],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
assert(bundle.success, bundle.logs.join("\n"));
const js = await bundle.outputs[0].text();
if (capture) await Bun.write(capture, js);
const css = await Bun.file(`${import.meta.dir}/../../styles/grid.css`).text();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/app.js")
      return new Response(js, {
        headers: { "content-type": "text/javascript" },
      });
    if (path === "/baseline.js" && baselinePath)
      return new Response(await Bun.file(baselinePath).text(), {
        headers: { "content-type": "text/javascript" },
      });
    return new Response(
      `<!doctype html><meta charset="utf-8"><style>${css}
    *{box-sizing:border-box} body{margin:0;font:12px sans-serif}.ftg-frame{height:512px;width:1200px}.ftg-grid{table-layout:fixed}.ftg-row,.ftg-th{height:32px}.ftg-row td{height:32px;max-height:32px;white-space:nowrap;overflow:hidden;padding:0 8px} input{width:90px;height:22px}input[type=checkbox]{width:14px}td,th{border-bottom:1px solid #ddd}.sticky{position:sticky;background:white}
    </style><div id="root"></div><script type="module" src="${path === "/baseline" ? "/baseline.js" : "/app.js"}"></script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(10_000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const report: unknown[] = [];
try {
  for (const variant of checkOnly || columnsOnly || framesOnly
    ? []
    : baselinePath
      ? ["baseline", "current", "current", "baseline"]
      : ["current"]) {
    await page.goto(`${server.url}${variant === "baseline" ? "baseline" : ""}`);
    await page.waitForFunction(() => !!window.gridBench);
    for (const rows of [10_000, 100_000]) {
      const mount = await page.evaluate(
        (rows) => window.gridBench.mount(rows, 50),
        rows,
      );
      assert(mount.domRows < 35, "virtualization must bound DOM rows");
      for (let warmup = 0; warmup < 5; warmup++) {
        await page.evaluate(
          (top) => window.gridBench.scroll(top),
          320 + warmup * 32,
        );
      }
      const samples = [];
      for (let i = 0; i < 30; i++)
        samples.push(
          await page.evaluate(
            (top) => window.gridBench.scroll(top),
            480 + i * 32,
          ),
        );
      const sorted = samples.map((s) => s.workMs).sort((a, b) => a - b);
      const item = {
        variant,
        rows,
        columns: 50,
        mount,
        scroll: {
          medianWorkMs: (sorted[14] + sorted[15]) / 2,
          p95WorkMs: sorted[28],
          medianCellRenders: [...samples.map((s) => s.renderedCells)].sort(
            (a, b) => a - b,
          )[15],
          samples,
        },
      };
      report.push(item);
      console.log(
        JSON.stringify({
          variant,
          rows,
          mountMs: mount.elapsedMs,
          medianWorkMs: item.scroll.medianWorkMs,
          p95WorkMs: item.scroll.p95WorkMs,
          cellRenders: item.scroll.medianCellRenders,
        }),
      );
    }
  }
  // Deterministic behavior gates accompany the timing samples.
  await page.goto(server.url.href);
  await page.waitForFunction(() => !!window.gridBench);
  await page.evaluate(() => window.gridBench.mount(1000, 20));
  await page.evaluate(() => window.gridBench.scroll(320));
  const oneRow = await page.evaluate(() => window.gridBench.scroll(352));
  assert(
    oneRow.renderedCells <= 40,
    `one-row scroll rendered ${oneRow.renderedCells} cells; expected only entering rows`,
  );
  await page.evaluate(() => window.gridBench.scroll(0));
  await page.getByLabel("Edit r0", { exact: true }).fill("local cell state");
  await page.evaluate(() => window.gridBench.reverseFirst());
  assert.equal(
    await page.getByLabel("Edit r0", { exact: true }).inputValue(),
    "local cell state",
    "stable row IDs must preserve input state across reordering",
  );
  await page.evaluate(() => window.gridBench.editFirst());
  assert.equal(
    await page.locator('[data-column-id="c0"] [data-row="r9"]').textContent(),
    "777",
  );
  await page.evaluate(() => window.gridBench.label("Updated "));
  assert.equal(
    await page.locator('[data-column-id="c0"] [data-row="r9"]').textContent(),
    "Updated 777",
    "new render callback must invalidate cell memo",
  );
  await page.getByLabel("Select row 1", { exact: true }).check();
  assert.equal(await page.locator('.ftg-row[aria-selected="true"]').count(), 1);
  await page.evaluate(() => window.gridBench.sort());
  assert.equal(
    await page
      .locator('.ftg-row [data-column-id="c0"] span')
      .first()
      .textContent(),
    "Updated 1",
  );
  const widthBefore = await page
    .locator('.ftg-row [data-column-id="c0"]')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  await page
    .getByRole("separator", { name: "Resize Column 0", exact: true })
    .press("ArrowRight");
  await page.waitForFunction(
    (before) => {
      const cell = document.querySelector('.ftg-row [data-column-id="c0"]');
      return !!cell && cell.getBoundingClientRect().width > before;
    },
    widthBefore,
    { timeout: 2000 },
  );
  const widthAfter = await page
    .locator('.ftg-row [data-column-id="c0"]')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  assert(
    widthAfter > widthBefore,
    `column resizing must update memoized cells: ${widthBefore} -> ${widthAfter}; aria=${await page.getByRole("separator", { name: "Resize Column 0", exact: true }).getAttribute("aria-valuenow")}`,
  );
  await checkColumnWindow(page);
  await checkFooterAggregation(page);
  if (columnsOnly && !checkOnly) report.push(...(await benchmarkColumns(page)));
  if (framesOnly && !checkOnly) report.push(...(await benchmarkFrames(page)));
  if (output)
    await Bun.write(
      output,
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          browser: browser.version(),
          cpu: cpus()[0]?.model,
          commit: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: Boolean(
            execFileSync("git", ["status", "--porcelain"], {
              encoding: "utf8",
            }).trim(),
          ),
          bundleSha256: createHash("sha256").update(js).digest("hex"),
          method: framesOnly
            ? "Production React; minified build; native scroll events; 60 measured RAF intervals per run, three repetitions. Mount excludes fixture construction, sync excludes frame settling. Scrolling includes browser script/layout/style but no CPU profiler or tracing. Fixed 1200x512 scroller, 32px rows, row overscan 4, column overscan 2. Plain text cells and one input column. Cold load and network excluded."
            : "Legacy synchronous scroll probes plus behavior gates.",
          results: report,
        },
        null,
        2,
      )}\n`,
    );
  assert.deepEqual(errors, []);
  console.log("Browser behavior gates passed");
} finally {
  await browser.close();
  server.stop(true);
}
