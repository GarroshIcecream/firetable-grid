import { describe, expect, test } from "bun:test";
import { fixedRowWindow, reachedEndOfRows } from "../src/layout";

// Windowing for fixed-height rows, with no virtualizer dependency. The engine
// already had `buildVirtualRenderPlan` for items supplied by someone else's
// virtualizer; this is the path that needs nobody's.

const win = (over: Partial<Parameters<typeof fixedRowWindow>[0]> = {}) =>
  fixedRowWindow({
    itemCount: 1000,
    rowHeight: 40,
    scrollTop: 0,
    viewportHeight: 400, // 10 rows visible
    overscan: 2,
    ...over,
  });

describe("fixedRowWindow", () => {
  test("at the top it renders the viewport plus the trailing overscan", () => {
    const w = win();
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(12); // 10 visible + 2 overscan
    expect(w.before).toBe(0);
    expect(w.after).toBe((1000 - 1 - 12) * 40);
  });

  test("scrolled into the middle it overscans both ways", () => {
    const w = win({ scrollTop: 4000 }); // first visible row = 100
    expect(w.startIndex).toBe(98);
    expect(w.endIndex).toBe(112);
    expect(w.before).toBe(98 * 40);
    expect(w.after).toBe((1000 - 1 - 112) * 40);
  });

  test("the spacers always sum to the rows that are not rendered", () => {
    // If they drift, the scrollbar length lies and the scroll position jumps.
    for (const scrollTop of [0, 1000, 20_000, 39_600]) {
      const w = win({ scrollTop });
      const rendered = w.endIndex - w.startIndex + 1;
      expect(w.before + w.after + rendered * 40).toBe(1000 * 40);
    }
  });

  test("scrolled past the end it clamps to the last row", () => {
    const w = win({ scrollTop: 999_999 });
    expect(w.endIndex).toBe(999);
    expect(w.after).toBe(0);
  });

  test("a negative scrollTop clamps to the top", () => {
    // macOS rubber-band overscroll reports one, and a negative first index
    // would compute a negative spacer and blank the grid.
    const w = win({ scrollTop: -220 });
    expect(w.startIndex).toBe(0);
    expect(w.before).toBe(0);
  });

  test("no rows renders nothing and no spacers", () => {
    const w = win({ itemCount: 0 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(-1);
    expect(w.before).toBe(0);
    expect(w.after).toBe(0);
  });

  test("a viewport of zero still renders the overscan, not a blank grid", () => {
    // The first paint happens before any measurement, so a window computed
    // from height 0 must not be empty or the grid never shows anything.
    const w = win({ viewportHeight: 0 });
    expect(w.endIndex).toBeGreaterThanOrEqual(w.startIndex);
  });

  test("a row height of zero renders everything rather than dividing by it", () => {
    const w = win({ rowHeight: 0, itemCount: 5 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(4);
    expect(w.before).toBe(0);
    expect(w.after).toBe(0);
  });

  test("fewer rows than fit the viewport renders all of them", () => {
    const w = win({ itemCount: 3 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(2);
    expect(w.after).toBe(0);
  });

  test("zero overscan is honoured", () => {
    const w = win({ overscan: 0, scrollTop: 400 });
    expect(w.startIndex).toBe(10);
  });
});

describe("reachedEndOfRows", () => {
  test("fires once the last rendered row is within the threshold", () => {
    expect(
      reachedEndOfRows({
        lastRenderedIndex: 89,
        loadedRowCount: 100,
        threshold: 10,
      }),
    ).toBe(true);
    expect(
      reachedEndOfRows({
        lastRenderedIndex: 88,
        loadedRowCount: 100,
        threshold: 10,
      }),
    ).toBe(false);
  });

  test("a threshold of zero fires only on the very last row", () => {
    expect(
      reachedEndOfRows({
        lastRenderedIndex: 99,
        loadedRowCount: 100,
        threshold: 0,
      }),
    ).toBe(true);
    expect(
      reachedEndOfRows({
        lastRenderedIndex: 98,
        loadedRowCount: 100,
        threshold: 0,
      }),
    ).toBe(false);
  });

  test("never fires with nothing loaded", () => {
    // Otherwise an empty first render asks for page two before page one lands.
    expect(
      reachedEndOfRows({
        lastRenderedIndex: -1,
        loadedRowCount: 0,
        threshold: 10,
      }),
    ).toBe(false);
  });

  test("a threshold larger than the loaded set still fires rather than never", () => {
    expect(
      reachedEndOfRows({
        lastRenderedIndex: 0,
        loadedRowCount: 5,
        threshold: 500,
      }),
    ).toBe(true);
  });

  test("a negative threshold is treated as zero", () => {
    expect(
      reachedEndOfRows({
        lastRenderedIndex: 98,
        loadedRowCount: 100,
        threshold: -50,
      }),
    ).toBe(false);
  });
});
