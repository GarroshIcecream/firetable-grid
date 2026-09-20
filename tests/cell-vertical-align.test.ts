import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cellVerticalAlignClass } from "../src/layout";

describe("cellVerticalAlignClass", () => {
  test("wrapping on puts cells at the top", () => {
    // A wrapped row is as tall as its tallest multi-line renderer; centring
    // would leave every short value floating in the middle of it.
    expect(cellVerticalAlignClass(true)).toBe("align-top");
  });

  test("wrapping off centres cells", () => {
    // Every cell is single-line, but the row is still as tall as the 40px
    // thumbnail, so the short values belong on the image's axis.
    expect(cellVerticalAlignClass(false)).toBe("align-middle");
  });

  test("the two states never resolve to the same class", () => {
    expect(cellVerticalAlignClass(true)).not.toBe(
      cellVerticalAlignClass(false),
    );
  });
});

describe("the rule lives in one place", () => {
  const cellSpec = readFileSync(
    join(import.meta.dir, "../src/layout/cell-spec.ts"),
    "utf8",
  );

  test("the body cell derives its axis from wrapCells", () => {
    expect(cellSpec).toContain("cellVerticalAlignClass(wrapCells)");
  });

  test("the cell spec never pins an axis of its own", () => {
    // A hardcoded `align-*` alongside `py-2` would outrank nothing on its own,
    // but it would silently diverge from the wrap preference.
    expect(cellSpec).not.toContain("py-2 align-top");
    expect(cellSpec).not.toContain("py-2 align-middle");
  });
});
