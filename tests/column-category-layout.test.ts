import { describe, expect, test } from "bun:test";

import {
  buildCategoryBlocks,
  groupIdsByCategory,
  moveCategoryBlock,
  moveColumnWithinCategory,
  projectIdsByCategory,
  windowCategoryBlocks,
} from "../src";

const CATEGORY: Record<string, string> = {
  a1: "pricing",
  a2: "pricing",
  a3: "pricing",
  b1: "timeDuration",
  b2: "timeDuration",
  c1: "statusAlerts",
  pin: "vehicleInfo",
  pin2: "pricing",
  hidden: "pricing",
};
const categoryOf = (id: string) => CATEGORY[id];

describe("groupIdsByCategory", () => {
  test("groups by first occurrence, preserving order inside a category", () => {
    expect(
      groupIdsByCategory(["a1", "b1", "a2", "b2", "a3"], categoryOf),
    ).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  test("category order follows first occurrence, not the vocabulary order", () => {
    // timeDuration precedes pricing in the input, and must stay ahead of it
    // even though the vocabulary lists pricing first.
    expect(groupIdsByCategory(["b1", "a1", "b2", "a2"], categoryOf)).toEqual([
      "b1",
      "b2",
      "a1",
      "a2",
    ]);
  });

  test("unknown categories collapse into a single trailing 'other' block", () => {
    expect(groupIdsByCategory(["a1", "zz", "a2", "yy"], categoryOf)).toEqual([
      "a1",
      "a2",
      "zz",
      "yy",
    ]);
  });

  test("is a no-op on an already grouped order", () => {
    const grouped = ["a1", "a2", "b1", "c1"];
    expect(groupIdsByCategory(grouped, categoryOf)).toEqual(grouped);
  });
});

describe("projectIdsByCategory", () => {
  test("leaves non-participating ids on their stored index", () => {
    const order = ["pin", "a1", "b1", "a2", "hidden", "b2"];
    const participating = new Set(["a1", "b1", "a2", "b2"]);
    expect(projectIdsByCategory(order, participating, categoryOf)).toEqual([
      "pin",
      "a1",
      "a2",
      "b1",
      "hidden",
      "b2",
    ]);
  });

  test("returns a copy when nothing participates", () => {
    const order = ["pin", "hidden"];
    const result = projectIdsByCategory(order, new Set(), categoryOf);
    expect(result).toEqual(order);
    expect(result).not.toBe(order);
  });
});

describe("buildCategoryBlocks", () => {
  test("collapses consecutive runs into one block each", () => {
    expect(buildCategoryBlocks(["a1", "a2", "b1", "c1"], categoryOf)).toEqual([
      { category: "pricing", startIndex: 0, endIndex: 1 },
      { category: "timeDuration", startIndex: 2, endIndex: 2 },
      { category: "statusAlerts", startIndex: 3, endIndex: 3 },
    ]);
  });

  test("a single-column category is a block of its own", () => {
    const blocks = buildCategoryBlocks(["c1"], categoryOf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      category: "statusAlerts",
      startIndex: 0,
      endIndex: 0,
    });
  });

  test("an ungrouped order still yields one block per run", () => {
    expect(buildCategoryBlocks(["a1", "b1", "a2"], categoryOf)).toHaveLength(3);
  });
});

describe("moveColumnWithinCategory", () => {
  const all = (order: readonly string[]) => new Set(order);

  test("rejects a move across categories", () => {
    expect(
      moveColumnWithinCategory(
        ["a1", "b1"],
        all(["a1", "b1"]),
        "a1",
        "b1",
        categoryOf,
      ),
    ).toBeNull();
  });

  test("rejects a no-op move", () => {
    expect(
      moveColumnWithinCategory(
        ["a1", "a2"],
        all(["a1", "a2"]),
        "a1",
        "a1",
        categoryOf,
      ),
    ).toBeNull();
  });

  test("keeps category order stable when the first member moves", () => {
    // The regression this guards: arrayMove over the stored order would yield
    // ["b1","a2","a1","b2","a3"], putting b1 at index 0 and swapping the whole
    // strip because category rank comes from first occurrence.
    const order = ["a1", "b1", "a2", "b2", "a3"];
    const next = moveColumnWithinCategory(
      order,
      all(order),
      "a1",
      "a2",
      categoryOf,
    );
    expect(next).toEqual(["a2", "b1", "a1", "b2", "a3"]);
    expect(groupIdsByCategory(next as string[], categoryOf)).toEqual([
      "a2",
      "a1",
      "a3",
      "b1",
      "b2",
    ]);
  });

  test("a pinned column of the same category never joins the move", () => {
    // `pin2` is pricing like a1/a2/a3 but sits in the frozen zone, so it is
    // not a slot participant. Sweeping it in would write it into slot 0 and
    // flip the whole block order under a drag made inside one block.
    const order = ["a1", "pin2", "b1", "a2", "a3"];
    const participating = new Set(["a1", "b1", "a2", "a3"]);
    const next = moveColumnWithinCategory(
      order,
      participating,
      "a1",
      "a2",
      categoryOf,
    ) as string[];
    expect(next[1]).toBe("pin2");
    expect(next).toEqual(["a2", "pin2", "b1", "a1", "a3"]);
    const strip = groupIdsByCategory(
      next.filter((id) => participating.has(id)),
      categoryOf,
    );
    expect(strip).toEqual(["a2", "a1", "a3", "b1"]);
  });

  test("a hidden column of the same category never joins the move", () => {
    const order = ["a1", "hidden", "b1", "a2"];
    const participating = new Set(["a1", "b1", "a2"]);
    const next = moveColumnWithinCategory(
      order,
      participating,
      "a1",
      "a2",
      categoryOf,
    ) as string[];
    expect(next[1]).toBe("hidden");
    expect(next).toEqual(["a2", "hidden", "b1", "a1"]);
  });

  test("never moves a foreign column", () => {
    const order = ["a1", "b1", "a2", "b2", "a3"];
    const next = moveColumnWithinCategory(
      order,
      all(order),
      "a3",
      "a1",
      categoryOf,
    ) as string[];
    expect(next[1]).toBe("b1");
    expect(next[3]).toBe("b2");
  });

  test("moving the last member to the front reorders only that category", () => {
    const order = ["a1", "b1", "a2", "b2", "a3"];
    const next = moveColumnWithinCategory(
      order,
      all(order),
      "a3",
      "a1",
      categoryOf,
    );
    expect(next).toEqual(["a3", "b1", "a1", "b2", "a2"]);
  });

  test("rejects a move whose target is not a participant", () => {
    const order = ["a1", "pin2", "a2"];
    expect(
      moveColumnWithinCategory(
        order,
        new Set(["a1", "a2"]),
        "a1",
        "pin2",
        categoryOf,
      ),
    ).toBeNull();
  });

  test("leaves the stored order untouched", () => {
    const order = ["a1", "b1", "a2"];
    moveColumnWithinCategory(order, all(order), "a2", "a1", categoryOf);
    expect(order).toEqual(["a1", "b1", "a2"]);
  });
});

describe("moveCategoryBlock", () => {
  const participating = new Set(["a1", "b1", "a2", "b2", "c1"]);

  test("rejects dropping a block on itself", () => {
    expect(
      moveCategoryBlock(
        ["a1", "b1"],
        participating,
        "pricing",
        "pricing",
        categoryOf,
      ),
    ).toBeNull();
  });

  test("reorders whole blocks, keeping each block's internal order", () => {
    const order = ["a1", "b1", "a2", "b2", "c1"];
    const next = moveCategoryBlock(
      order,
      participating,
      "timeDuration",
      "pricing",
      categoryOf,
    ) as string[];
    expect(groupIdsByCategory(next, categoryOf)).toEqual([
      "b1",
      "b2",
      "a1",
      "a2",
      "c1",
    ]);
  });

  test("keeps non-participating ids on their stored index", () => {
    const order = ["pin", "a1", "b1", "hidden", "a2", "b2"];
    const next = moveCategoryBlock(
      order,
      new Set(["a1", "b1", "a2", "b2"]),
      "timeDuration",
      "pricing",
      categoryOf,
    ) as string[];
    expect(next[0]).toBe("pin");
    expect(next[3]).toBe("hidden");
  });

  test("returns null for a category that is not on screen", () => {
    expect(
      moveCategoryBlock(
        ["a1", "a2"],
        new Set(["a1", "a2"]),
        "pricing",
        "statusAlerts",
        categoryOf,
      ),
    ).toBeNull();
  });
});

describe("windowCategoryBlocks", () => {
  // pricing[0..2] | timeDuration[3..4] | statusAlerts[5]
  const blocks = buildCategoryBlocks(
    ["a1", "a2", "a3", "b1", "b2", "c1"],
    categoryOf,
  );

  test("the strip's first block never draws a leading edge", () => {
    // The frozen zone's own trailing border already draws that line; a second
    // one lands right beside it and reads as a double rule.
    const windowed = windowCategoryBlocks(blocks, 0, 5);
    expect(windowed[0].category).toBe("pricing");
    expect(windowed[0].showLeadingEdge).toBe(false);
  });

  test("later blocks do draw one", () => {
    const windowed = windowCategoryBlocks(blocks, 0, 5);
    expect(windowed.map((b) => b.showLeadingEdge)).toEqual([false, true, true]);
  });

  test("a block starting left of the window draws no edge", () => {
    // Otherwise overscan paints a divider in the middle of a category.
    const windowed = windowCategoryBlocks(blocks, 1, 5);
    expect(windowed[0].category).toBe("pricing");
    expect(windowed[0].showLeadingEdge).toBe(false);
    expect(windowed[0].spanned).toBe(2);
  });

  test("spanned is the intersection with the window, not the block width", () => {
    const windowed = windowCategoryBlocks(blocks, 2, 3);
    expect(windowed).toHaveLength(2);
    expect(windowed[0]).toMatchObject({ category: "pricing", spanned: 1 });
    expect(windowed[1]).toMatchObject({ category: "timeDuration", spanned: 1 });
  });

  test("blocks fully outside the window are dropped", () => {
    const windowed = windowCategoryBlocks(blocks, 5, 5);
    expect(windowed.map((b) => b.category)).toEqual(["statusAlerts"]);
  });

  test("an empty window yields nothing", () => {
    expect(windowCategoryBlocks(blocks, 3, 2)).toEqual([]);
    expect(windowCategoryBlocks([], 0, 5)).toEqual([]);
  });

  test("the windowed spans always sum to the window size", () => {
    for (let first = 0; first <= 5; first++) {
      for (let last = first; last <= 5; last++) {
        const total = windowCategoryBlocks(blocks, first, last).reduce(
          (sum, b) => sum + b.spanned,
          0,
        );
        expect(total).toBe(last - first + 1);
      }
    }
  });
});
