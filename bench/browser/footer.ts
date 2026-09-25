import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

export async function checkFooterAggregation(page: Page) {
  const mount = await page.evaluate(() =>
    window.gridBench.mount(1000, 20, {
      footer: true,
      virtualizeColumns: true,
      trackAggregateReads: true,
    }),
  );
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "500500",
  );
  assert.equal(
    mount.aggregateReads,
    1000,
    "initial layout measurement must not rescan footer rows",
  );
  await page.evaluate(() => window.gridBench.scroll(640, 1));
  assert.equal(
    await page.evaluate(() => window.gridBench.state().aggregateReads),
    1000,
    "scrolling must not rescan unchanged footer rows",
  );
  await page.locator('.ftg-row input[type="checkbox"]').first().check();
  assert.equal(
    await page.evaluate(() => window.gridBench.state().aggregateReads),
    1000,
    "selection must not rescan footer rows",
  );
  await page.evaluate(() => window.gridBench.scroll(640, 1500));
  assert.equal(await page.locator('tfoot [data-column-id="c0"]').count(), 0);
  await page.evaluate(() => window.gridBench.scroll(640, 0));
  assert.equal(
    await page.evaluate(() => window.gridBench.state().aggregateReads),
    1000,
    "returning columns reuse their aggregate",
  );
  await page.evaluate(() => window.gridBench.editFirst());
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "500277",
    "row replacement updates the footer",
  );
  assert.equal(
    await page.evaluate(() => window.gridBench.state().aggregateReads),
    2000,
  );
  await page.evaluate(() => window.gridBench.aggregation("avg"));
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "500.277",
  );
  assert.equal(
    await page.evaluate(() => window.gridBench.state().aggregateReads),
    3000,
  );
  await page.evaluate(() => window.gridBench.footerValue("avg", null));
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "—",
  );
  await page.evaluate(() => window.gridBench.footerValue("avg", 999));
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "999",
  );
  assert.equal(
    await page.evaluate(() => window.gridBench.state().aggregateReads),
    3000,
    "server overrides must not read local rows",
  );
  await page.evaluate(() => window.gridBench.footerValue("avg", undefined));
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "500.277",
  );
  await page.evaluate(() => window.gridBench.filterMinimum(900));
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "950",
  );
  await page.evaluate(() => window.gridBench.filterMinimum(9999));
  assert.equal(
    await page.locator('tfoot [data-column-id="c0"]').textContent(),
    "—",
  );
  console.log(
    "Footer gates: cached scrolling/selection and row updates passed",
  );
}
