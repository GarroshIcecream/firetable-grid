import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { arch, cpus, platform } from "node:os";
import { chromium } from "@playwright/test";
import type { CoreBench } from "./app";
import { summarize } from "./stats";

declare global {
  interface Window {
    coreBench: CoreBench;
  }
}
const output =
  process.argv.find((a) => a.startsWith("--output="))?.slice(9) ??
  "bench/results/core.json";
const quick = process.argv.includes("--quick");
const profile = process.argv.includes("--profile");
const bundle = await Bun.build({
  entrypoints: [`${import.meta.dir}/app.ts`],
  target: "browser",
  minify: { syntax: true, whitespace: false, identifiers: false },
  define: { "process.env.NODE_ENV": '"production"' },
});
assert(bundle.success, bundle.logs.join("\n"));
const js = await bundle.outputs[0].text();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    return new URL(req.url).pathname === "/app.js"
      ? new Response(js, { headers: { "content-type": "text/javascript" } })
      : new Response(
          '<!doctype html><script type="module" src="/app.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
  },
});
const browser = await chromium.launch({ headless: true });
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const report = {
  createdAt: new Date().toISOString(),
  runtime: browser.version(),
  bun: Bun.version,
  machine: {
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    platform: platform(),
    arch: arch(),
  },
  commit: git("rev-parse", "HEAD"),
  dirty: Boolean(git("status", "--porcelain")),
  bundleSha256: createHash("sha256").update(js).digest("hex"),
  lockSha256: createHash("sha256")
    .update(new Uint8Array(await Bun.file("bun.lock").arrayBuffer()))
    .digest("hex"),
  method:
    "Chromium V8; production environment; identifiers retained for profiles. Fresh context per size. Setup excluded. Five warmup batches, 21 samples, calibrated batches target 30ms. Profiling is separate from timing. Sort capped at 10k rows. Raw sort supports only this numeric fixture, not full schema semantics.",
  workloads: [] as unknown[],
};
try {
  for (const [rows, columns] of quick
    ? [[10_000, 20]]
    : [
        [10_000, 20],
        [50_000, 20],
        [50_000, 200],
        [100_000, 20],
      ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url.href);
    await page.waitForFunction(() => Boolean(window.coreBench));
    const metadata = await page.evaluate(
      ([r, c]) => window.coreBench.setup(r, c),
      [rows, columns],
    );
    const cdp = await context.newCDPSession(page);
    const results = [];
    for (const name of metadata.cases) {
      await cdp.send("HeapProfiler.collectGarbage");
      const probe = await page.evaluate(
        (name) => window.coreBench.batch(name, 1),
        name,
      );
      const iterations = Math.max(
        1,
        Math.min(5000, Math.ceil(30 / Math.max(probe.elapsedMs, 0.01))),
      );
      for (let i = 0; i < 5; i++)
        await page.evaluate(
          ({ name, iterations }) => window.coreBench.batch(name, iterations),
          { name, iterations },
        );
      const samples = [];
      for (let i = 0; i < 21; i++) {
        const sample = await page.evaluate(
          ({ name, iterations }) => window.coreBench.batch(name, iterations),
          { name, iterations },
        );
        assert.equal(sample.result, probe.result, `${name} result changed`);
        samples.push(sample.elapsedMs / iterations);
      }
      const result = {
        name,
        iterations,
        checksum: probe.result,
        ...summarize(samples),
      };
      results.push(result);
      console.log(
        `${rows}x${columns} ${name}: ${result.medianMs.toFixed(3)} ms (p95 ${result.p95Ms.toFixed(3)})`,
      );
    }
    const profiles = [];
    if (profile && (quick || (rows === 50_000 && columns === 200))) {
      for (const name of [
        "search/all-searchable",
        "sort/export-numeric-10k",
        "group/positions",
      ]) {
        await cdp.send("HeapProfiler.collectGarbage");
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
        await cdp.send("Profiler.start");
        await page.evaluate((name) => {
          const until = performance.now() + 1500;
          while (performance.now() < until) window.coreBench.batch(name, 1);
        }, name);
        const { profile: data } = await cdp.send("Profiler.stop");
        const file = `${output}.profiles/${name.replaceAll("/", "-")}.cpuprofile`;
        await Bun.write(file, JSON.stringify(data));
        const totals = new Map<number, number>();
        data.samples?.forEach((id, i) => {
          totals.set(id, (totals.get(id) ?? 0) + (data.timeDeltas?.[i] ?? 0));
        });
        const top = data.nodes
          .map((n) => ({
            function: n.callFrame.functionName || "(anonymous)",
            line: n.callFrame.lineNumber + 1,
            selfMs: (totals.get(n.id) ?? 0) / 1000,
          }))
          .sort((a, b) => b.selfMs - a.selfMs)
          .slice(0, 12);
        profiles.push({ name, file, top });
      }
      await Bun.write(`${output}.profiles/app.js`, js);
    }
    assert.deepEqual(errors, []);
    report.workloads.push({ ...metadata, results, profiles });
    await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
    await context.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
console.log(`Saved ${output}`);
