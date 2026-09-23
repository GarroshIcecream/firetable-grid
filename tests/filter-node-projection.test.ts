import { describe, expect, test } from "bun:test";

import {
  all,
  any,
  countConditions,
  FILTER_OP,
  type FilterCondition,
  projectFilter,
  where,
} from "../src";

const { gt, lte, is } = FILTER_OP;

// Narrowing a filter is a real operation - a chat assistant applying a model's
// intent, a column-access projection stripping fields the viewer cannot see -
// and it must not change the boolean logic of what survives.
//
// The shape this replaced stored each group's operator in a separate
// index-aligned array, so dropping a group silently slid every later operator
// onto the wrong one: "diesel OR hybrid" came back as "diesel AND hybrid", a
// different result set with nothing on screen to signal the change. A branch
// now carries its own kind, so that class of bug has nowhere to live.

const keepAll = () => true;
const drop = (field: string) => (c: FilterCondition) => c.field !== field;

describe("projectFilter", () => {
  test("a fully kept tree comes back unchanged", () => {
    const tree = all(
      where("price", lte, "25000"),
      any(where("fuel", is, "diesel"), where("fuel", is, "hybrid")),
    );
    expect(projectFilter(tree, keepAll)).toEqual(tree);
  });

  test("drops the conditions the caller rejects", () => {
    const tree = all(where("fuel", is, "diesel"), where("denied", is, "x"));
    expect(projectFilter(tree, drop("denied"))).toEqual(
      where("fuel", is, "diesel"),
    );
  });

  test("a surviving branch keeps its own kind when a sibling is dropped", () => {
    // The old shape's central failure: group 0 disappears and group 1 inherits
    // its operator. Here the surviving `any` carries its own kind with it.
    const tree = all(
      any(where("denied", is, "x"), where("denied", is, "y")),
      any(where("fuel", is, "diesel"), where("fuel", is, "hybrid")),
    );
    expect(projectFilter(tree, drop("denied"))).toEqual(
      any(where("fuel", is, "diesel"), where("fuel", is, "hybrid")),
    );
  });

  test("unwraps a branch left holding a single child", () => {
    // `any(a)` and `a` select the same rows, so the wrapper is noise.
    const tree = any(where("fuel", is, "diesel"), where("denied", is, "x"));
    expect(projectFilter(tree, drop("denied"))).toEqual(
      where("fuel", is, "diesel"),
    );
  });

  test("recurses into nested branches", () => {
    const tree = all(
      where("price", lte, "25000"),
      any(where("fuel", is, "diesel"), where("denied", is, "x")),
    );
    expect(projectFilter(tree, drop("denied"))).toEqual(
      all(where("price", lte, "25000"), where("fuel", is, "diesel")),
    );
  });

  test("returns null when nothing survives", () => {
    const tree = all(where("denied", is, "x"), where("denied", is, "y"));
    expect(projectFilter(tree, drop("denied"))).toBe(null);
  });

  test("projects a bare condition, with no branch around it", () => {
    const leaf = where("fuel", is, "diesel");
    expect(projectFilter(leaf, keepAll)).toEqual(leaf);
    expect(projectFilter(leaf, drop("fuel"))).toBe(null);
  });

  test("a null filter projects to null", () => {
    expect(projectFilter(null, keepAll)).toBe(null);
  });
});

describe("countConditions", () => {
  test("counts every leaf, however deeply nested", () => {
    expect(
      countConditions(
        all(
          where("price", lte, "25000"),
          any(
            where("fuel", is, "diesel"),
            all(where("year", gt, "2020"), where("make", is, "skoda")),
          ),
        ),
      ),
    ).toBe(4);
  });

  test("an unfiltered view counts zero", () => {
    expect(countConditions(null)).toBe(0);
    expect(countConditions(all())).toBe(0);
  });

  test("a bare condition counts one", () => {
    expect(countConditions(where("fuel", is, "diesel"))).toBe(1);
  });
});
