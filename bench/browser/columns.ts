import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

export async function checkColumnWindow(page: Page) {
  await page.evaluate(() =>
    window.gridBench.mount(1000, 100, { pinned: ["c0"], footer: true }),
  );
  const width = await page
    .locator(".ftg-grid")
    .evaluate((el) => el.getBoundingClientRect().width);
  const full = await page
    .locator(".ftg-row")
    .first()
    .locator("[data-column-id]")
    .count();
  await page.evaluate(() =>
    window.gridBench.mount(1000, 100, {
      virtualizeColumns: true,
      pinned: ["c0"],
      footer: true,
    }),
  );
  const visible = await page
    .locator(".ftg-row")
    .first()
    .locator("[data-column-id]")
    .count();
  assert(
    visible < 20,
    `horizontal window mounted ${visible} of ${full} columns`,
  );
  assert(
    Math.abs(
      (await page
        .locator(".ftg-grid")
        .evaluate((el) => el.getBoundingClientRect().width)) - width,
    ) < 2,
    "virtualization must preserve full table width",
  );
  await page.getByLabel("Edit r0", { exact: true }).fill("keep focused state");
  await page.evaluate(() => window.gridBench.scroll(0, 5500));
  assert.equal(
    await page.getByLabel("Edit r0", { exact: true }).inputValue(),
    "keep focused state",
  );
  assert.equal(
    await page
      .getByLabel("Edit r0", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  const pins = await page
    .locator(".ftg-row")
    .first()
    .locator('[data-column-id="c0"]')
    .boundingBox();
  assert(pins && pins.x < 150, "pinned data column stays in view");
  const mounted = await page
    .locator("thead [data-column-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-column-id")));
  assert(mounted.includes("c50"), "middle columns become visible");
  assert(!mounted.includes("c20"), "distant unfocused columns unmount");
  assert.equal(
    await page.locator(".ftg-grid").getAttribute("aria-colcount"),
    "101",
  );
  for (const id of ["c0", "c50"]) {
    const boxes = await page
      .locator(`[data-column-id="${id}"]`)
      .evaluateAll((els) =>
        els.map((el) => ({
          x: el.getBoundingClientRect().x,
          w: el.getBoundingClientRect().width,
        })),
      );
    assert(
      boxes.every(
        (b) => Math.abs(b.x - boxes[0].x) < 1 && Math.abs(b.w - boxes[0].w) < 1,
      ),
      `${id} header/body/footer alignment`,
    );
  }
  console.log("Column gates: focus, pinning and alignment passed");
  // Blur releases the retained offscreen column; virtualized editors must persist committed data externally.
  await page
    .getByRole("separator", { name: "Resize Column 50", exact: true })
    .focus();
  assert.equal(await page.getByLabel("Edit r0", { exact: true }).count(), 0);
  await page
    .getByRole("separator", { name: "Resize Column 50", exact: true })
    .press("ArrowRight");
  await page.waitForFunction(() =>
    document.querySelector(
      'thead [data-column-id="c50"] [aria-valuenow="118"]',
    ),
  );
  const header = page.locator('thead [data-column-id="c50"]');
  const headerBox = await header.boundingBox();
  const bodyBox = await page
    .locator('.ftg-row [data-column-id="c50"]')
    .first()
    .boundingBox();
  assert(
    headerBox &&
      bodyBox &&
      Math.abs(headerBox.width - 118) < 1 &&
      Math.abs(headerBox.width - bodyBox.width) < 1,
  );
  const handle = page.getByRole("separator", {
    name: "Resize Column 50",
    exact: true,
  });
  const handleBox = await handle.boundingBox();
  assert(handleBox);
  await page.mouse.move(handleBox.x + 1, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + 1 + 180,
    handleBox.y + handleBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('thead [data-column-id="c50"] [aria-valuenow]')
          ?.getAttribute("aria-valuenow"),
      ) > 250,
  );
  console.log("Column gates: resizing passed");
  await page.evaluate(() =>
    window.gridBench.layout({
      visibility: Object.fromEntries(
        Array.from({ length: 95 }, (_, i) => [`c${i + 5}`, false]),
      ),
    }),
  );
  await page.waitForFunction(
    () => document.querySelectorAll("thead [data-column-id]").length === 6,
  );
  assert.equal(
    await page.locator(".ftg-grid").getAttribute("aria-colcount"),
    "6",
  );
  const columns = await page
    .locator("thead [data-column-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-column-id")));
  assert(
    columns.includes("c4"),
    "hiding columns clamps stale horizontal scroll",
  );
  // Independent of built-in row virtualization.
  await page.evaluate(() =>
    window.gridBench.mount(12, 100, {
      virtualizeColumns: true,
      rowVirtual: false,
      pinned: ["c0"],
    }),
  );
  await page.evaluate(() => window.gridBench.scroll(0, 100000));
  assert.equal(await page.locator(".ftg-row").count(), 12);
  assert.equal(await page.locator('thead [data-column-id="c99"]').count(), 1);
  assert(
    (await page
      .locator(".ftg-row")
      .first()
      .locator("[data-column-id]")
      .count()) < 20,
  );
  await page.evaluate(() =>
    window.gridBench.layout({
      order: [
        "c99",
        "c0",
        "c1",
        ...Array.from({ length: 97 }, (_, i) => `c${i + 2}`),
      ],
    }),
  );
  await page.evaluate(() => window.gridBench.scroll(0, 0));
  assert.equal(
    await page.locator('thead [data-column-id="c99"]').count(),
    1,
    "column order changes recompute window",
  );
  await page.evaluate(() => window.gridBench.group("c1"));
  assert.equal(await page.locator(".ftg-group-row").count(), 12);
  assert.equal(
    await page.locator(".ftg-group-row td").first().getAttribute("colspan"),
    "101",
  );
  await page
    .locator(".ftg-group-toggle")
    .first()
    .click({ position: { x: 80, y: 16 } });
  assert.equal(await page.locator(".ftg-row").count(), 11);

  // Declared widths include padding even without an application CSS reset.
  const reset = await page.addStyleTag({
    content: ".ftg-grid td,.ftg-grid th{box-sizing:content-box}",
  });
  await page.evaluate(() =>
    window.gridBench.mount(1000, 100, {
      virtualizeColumns: true,
      pinned: ["c0"],
      footer: true,
    }),
  );
  await page.evaluate(() =>
    window.gridBench.layout({
      sizes: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`c${i}`, 80 + i * 3]),
      ),
    }),
  );
  for (const left of [0, 5500, 20000]) {
    await page.evaluate((left) => window.gridBench.scroll(0, left), left);
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Missing ${selector}`);
        return el.getBoundingClientRect();
      };
      return {
        width: box(".ftg-grid").width,
        selectionRight: box('thead [data-column-id="__select__"]').right,
        pinLeft: box('thead [data-column-id="c0"]').left,
        mismatches: [
          ...document.querySelectorAll("thead [data-column-id]"),
        ].filter((el) => {
          const id = (el as HTMLElement).dataset.columnId;
          if (!id) throw new Error("Missing column ID");
          const expected =
            id === "__select__" ? 36 : 80 + Number(id.slice(1)) * 3;
          return Math.abs(el.getBoundingClientRect().width - expected) > 0.5;
        }).length,
      };
    });
    assert.equal(geometry.width, 22886, "variable widths must include padding");
    assert.equal(
      geometry.mismatches,
      0,
      "mounted columns retain their declared widths",
    );
    assert(
      Math.abs(geometry.selectionRight - geometry.pinLeft) < 0.5,
      "pinned columns must not overlap",
    );
  }
  const beforeNarrowing = await page.locator("thead [data-column-id]").count();
  await page.locator(".ftg-frame").evaluate((el) => {
    (el as HTMLElement).style.width = "700px";
  });
  await page.waitForFunction(
    (before) =>
      document.querySelectorAll("thead [data-column-id]").length < before,
    beforeNarrowing,
  );
  await page.evaluate(() =>
    window.gridBench.mount(0, 100, { virtualizeColumns: true }),
  );
  assert.equal(await page.locator(".ftg-empty").getAttribute("colspan"), "101");
  assert((await page.locator("thead [data-column-id]").count()) < 20);
  await reset.evaluate((el) => el.parentNode?.removeChild(el));
  console.log("Horizontal virtualization behavior gates passed");
}
