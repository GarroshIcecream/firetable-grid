import { expect, test } from "bun:test";
import { buildColumnWindow } from "../src/layout/column-window";

const columns = [
  { id: "pinned", size: 60, isPinned: true },
  { id: "a", size: 100, isPinned: false },
  { id: "b", size: 80, isPinned: false },
  { id: "c", size: 120, isPinned: false },
  { id: "d", size: 70, isPinned: false },
  { id: "e", size: 90, isPinned: false },
  { id: "f", size: 110, isPinned: false },
];
const indices = (window: ReturnType<typeof buildColumnWindow>) =>
  window.slots.map((slot) => slot.index);

test("pinned columns remain while variable-width columns use actual viewport intersection", () => {
  const window = buildColumnWindow(columns, {
    scrollLeft: 180,
    viewportWidth: 180,
    overscan: 0,
  });
  expect(indices(window)).toEqual([0, 3]);
  expect(window.slots[1].before).toEqual({ start: 1, count: 2, width: 180 });
  expect(window.after).toEqual({ start: 4, count: 3, width: 270 });
  expect(window.totalWidth).toBe(630);
  expect(window.pinnedWidth).toBe(60);
});

test("touching either edge does not count as a visible column", () => {
  expect(
    indices(
      buildColumnWindow(columns, {
        scrollLeft: 100,
        viewportWidth: 140,
        overscan: 0,
      }),
    ),
  ).toEqual([0, 2]);
});

test("default overscan keeps two neighboring unpinned columns on each side", () => {
  const window = buildColumnWindow(columns, {
    scrollLeft: 180,
    viewportWidth: 180,
  });
  expect(indices(window)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(window.after).toEqual({ start: 6, count: 1, width: 110 });
});

test("focused or dragged columns stay mounted with discontiguous gaps", () => {
  const window = buildColumnWindow(columns, {
    scrollLeft: 180,
    viewportWidth: 180,
    overscan: 0,
    keep: new Set(["a", "f", "hidden"]),
  });
  expect(indices(window)).toEqual([0, 1, 3, 6]);
  expect(window.slots.map((slot) => slot.before)).toEqual([
    { start: 0, count: 0, width: 0 },
    { start: 1, count: 0, width: 0 },
    { start: 2, count: 1, width: 80 },
    { start: 4, count: 2, width: 160 },
  ]);
  expect(window.after).toEqual({ start: 7, count: 0, width: 0 });
});

test("negative rubberband scroll and stale scroll after hiding clamp to populated windows", () => {
  expect(
    indices(
      buildColumnWindow(columns, {
        scrollLeft: -100,
        viewportWidth: 180,
        overscan: 0,
      }),
    ),
  ).toEqual([0, 1, 2]);
  expect(
    indices(
      buildColumnWindow(columns, {
        scrollLeft: 9999,
        viewportWidth: 180,
        overscan: 0,
      }),
    ),
  ).toEqual([0, 5, 6]);
  expect(
    indices(
      buildColumnWindow(columns.slice(0, 3), {
        scrollLeft: 9999,
        viewportWidth: 180,
        overscan: 0,
      }),
    ),
  ).toEqual([0, 1, 2]);
});

test("an unmeasured viewport bootstraps pinned plus the first overscan columns", () => {
  expect(
    indices(buildColumnWindow(columns, { scrollLeft: 0, viewportWidth: 0 })),
  ).toEqual([0, 1, 2, 3]);
  expect(
    indices(
      buildColumnWindow(columns, {
        scrollLeft: 0,
        viewportWidth: 0,
        overscan: 0,
      }),
    ),
  ).toEqual([0, 1]);
});

test("a positive viewport covered by pinned columns needs only pinned and kept slots", () => {
  const window = buildColumnWindow(columns, {
    scrollLeft: 100,
    viewportWidth: 50,
    keep: new Set(["d"]),
  });
  expect(indices(window)).toEqual([0, 4]);
});

test("empty input, all pinned and an oversized viewport retain valid geometry", () => {
  expect(buildColumnWindow([], { scrollLeft: 10, viewportWidth: 100 })).toEqual(
    {
      slots: [],
      after: { start: 0, count: 0, width: 0 },
      totalWidth: 0,
      pinnedWidth: 0,
    },
  );
  expect(
    indices(
      buildColumnWindow(
        columns.map((c) => ({ ...c, isPinned: true })),
        { scrollLeft: 100, viewportWidth: 50 },
      ),
    ),
  ).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(
    indices(
      buildColumnWindow(columns, {
        scrollLeft: 100,
        viewportWidth: 1000,
        overscan: 0,
      }),
    ),
  ).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

test("slots and gaps preserve every column and pixel across window positions", () => {
  for (const scrollLeft of [-50, 0, 1, 100, 180, 250, 9999]) {
    for (const viewportWidth of [0, 30, 60, 100, 180, 1000]) {
      const window = buildColumnWindow(columns, {
        scrollLeft,
        viewportWidth,
        overscan: 0,
        keep: new Set(["b", "f"]),
      });
      const covered: number[] = [];
      let width = 0;
      for (const slot of window.slots) {
        for (
          let i = slot.before.start;
          i < slot.before.start + slot.before.count;
          i++
        )
          covered.push(i);
        covered.push(slot.index);
        width += slot.before.width + columns[slot.index].size;
      }
      for (
        let i = window.after.start;
        i < window.after.start + window.after.count;
        i++
      )
        covered.push(i);
      expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(width + window.after.width).toBe(630);
    }
  }
});

test("invalid widths, overscan and measurements are rejected", () => {
  for (const size of [0, -1, NaN, Infinity]) {
    expect(() =>
      buildColumnWindow([{ id: "a", size, isPinned: false }], {
        scrollLeft: 0,
        viewportWidth: 100,
      }),
    ).toThrow();
  }
  for (const overscan of [-1, 1.5, NaN, Infinity]) {
    expect(() =>
      buildColumnWindow(columns, {
        scrollLeft: 0,
        viewportWidth: 100,
        overscan,
      }),
    ).toThrow();
  }
  for (const viewportWidth of [-1, NaN, Infinity]) {
    expect(() =>
      buildColumnWindow(columns, { scrollLeft: 0, viewportWidth }),
    ).toThrow();
  }
  expect(() =>
    buildColumnWindow(columns, { scrollLeft: NaN, viewportWidth: 100 }),
  ).toThrow();
});

test("unpinned grids use resized widths and preserve original indices after scrolling", () => {
  const unpinned = columns.map((column) => ({ ...column, isPinned: false }));
  expect(
    indices(
      buildColumnWindow(unpinned, {
        scrollLeft: 160,
        viewportWidth: 80,
        overscan: 0,
      }),
    ),
  ).toEqual([2]);
  unpinned[1] = { ...unpinned[1], size: 180 };
  expect(
    indices(
      buildColumnWindow(unpinned, {
        scrollLeft: 160,
        viewportWidth: 80,
        overscan: 0,
      }),
    ),
  ).toEqual([1]);
});
