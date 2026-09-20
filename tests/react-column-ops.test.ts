// The decision logic behind <DataGrid>'s resize and reorder, tested without a
// DOM: the hooks contribute pointer plumbing, these functions decide outcomes.

import { describe, expect, test } from "bun:test";
import { moveColumnWithinCategory } from "../src";
import { clampColumnSize, MAX_COLUMN_WIDTH } from "../src/react";

describe("clampColumnSize", () => {
  test("passes a size that is already in range", () => {
    expect(clampColumnSize(200, 80)).toBe(200);
  });

  test("a drag past the left edge stops at the column's minimum", () => {
    expect(clampColumnSize(10, 80)).toBe(80);
    expect(clampColumnSize(-400, 80)).toBe(80);
  });

  test("a runaway drag stops at the maximum", () => {
    expect(clampColumnSize(99999, 80)).toBe(MAX_COLUMN_WIDTH);
  });

  test("min wins when the bounds cross, so a column never collapses", () => {
    // A column whose declared minWidth exceeds the max would otherwise clamp
    // to the max and render narrower than it is allowed to be.
    expect(clampColumnSize(50, 900, 400)).toBe(900);
  });

  test("the bounds are inclusive", () => {
    expect(clampColumnSize(80, 80)).toBe(80);
    expect(clampColumnSize(MAX_COLUMN_WIDTH, 80)).toBe(MAX_COLUMN_WIDTH);
  });
});

describe("reorder rules", () => {
  const order = ["a", "b", "c", "d"];
  const all = new Set(order);
  const free = () => undefined; // no categories: every column shares a bucket

  test("a drag moves the column to the target's slot", () => {
    expect(moveColumnWithinCategory(order, all, "a", "c", free)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  test("dragging leftwards inserts before the target", () => {
    expect(moveColumnWithinCategory(order, all, "d", "b", free)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  test("dropping a column on itself is refused", () => {
    expect(moveColumnWithinCategory(order, all, "a", "a", free)).toBeNull();
  });

  test("a column outside the participating set is refused", () => {
    // This is what keeps a pinned column from being dragged out of the frozen
    // block, which would leave the sticky offsets describing a dead order.
    const unpinned = new Set(["b", "c", "d"]);
    expect(
      moveColumnWithinCategory(order, unpinned, "a", "c", free),
    ).toBeNull();
    expect(
      moveColumnWithinCategory(order, unpinned, "c", "a", free),
    ).toBeNull();
  });

  describe("with categories", () => {
    const categoryOf = (id: string) =>
      id === "a" || id === "b" ? "left" : "right";

    test("a move within one category is allowed", () => {
      expect(
        moveColumnWithinCategory(order, all, "c", "d", categoryOf),
      ).toEqual(["a", "b", "d", "c"]);
    });

    test("a cross-category drop is refused rather than silently applied", () => {
      expect(
        moveColumnWithinCategory(order, all, "a", "d", categoryOf),
      ).toBeNull();
    });

    test("a refused move leaves the order untouched", () => {
      const before = [...order];
      moveColumnWithinCategory(order, all, "a", "d", categoryOf);
      expect(order).toEqual(before);
    });

    test("columns never leave their category's slots", () => {
      const next = moveColumnWithinCategory(order, all, "d", "c", categoryOf);
      expect(next?.slice(0, 2).sort()).toEqual(["a", "b"]);
      expect(next?.slice(2).sort()).toEqual(["c", "d"]);
    });
  });
});
