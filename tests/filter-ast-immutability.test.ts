import { describe, expect, test } from "bun:test";

import {
  applyAST,
  EMPTY_FILTER_AST,
  emptyFilterAST,
  type FilterAST,
  isFilterASTEmpty,
} from "../src";

// `Object.freeze` on the object alone left `and` and `orGroups` writable, and
// the documented way to reach a new AST — `{ ...EMPTY_FILTER_AST, search }` —
// copies those array *references*. One `push` downstream appended to the
// module-level constant that every other spread was also sharing, so a filter
// leaked into unrelated views and, on a server, across requests and tenants.

describe("EMPTY_FILTER_AST is deeply immutable", () => {
  test("the arrays are frozen, not just the object", () => {
    expect(Object.isFrozen(EMPTY_FILTER_AST)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTER_AST.and)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTER_AST.orGroups)).toBe(true);
  });

  test("a push through a spread throws instead of corrupting the constant", () => {
    const ast: FilterAST = { ...EMPTY_FILTER_AST, search: "estate" };
    expect(() => ast.and.push({ field: "price", op: "≤", val: "1" })).toThrow();
    expect(EMPTY_FILTER_AST.and).toHaveLength(0);
    expect(EMPTY_FILTER_AST.orGroups).toHaveLength(0);
  });

  test("the constant stays empty however many spreads are taken from it", () => {
    const a: FilterAST = { ...EMPTY_FILTER_AST, search: "a" };
    const b: FilterAST = { ...EMPTY_FILTER_AST, search: "b" };
    try {
      a.and.push({ field: "f", op: "is", val: "1" });
    } catch {
      // expected — the point is what b and the constant look like afterwards
    }
    expect(b.and).toHaveLength(0);
    expect(isFilterASTEmpty(EMPTY_FILTER_AST)).toBe(true);
    expect(applyAST([{ price: 1 }], EMPTY_FILTER_AST, [])).toHaveLength(1);
  });

  test("supplying your own arrays in the spread still works", () => {
    const ast: FilterAST = {
      ...EMPTY_FILTER_AST,
      and: [{ field: "price", op: "≤", val: "1" }],
    };
    expect(ast.and).toHaveLength(1);
    expect(EMPTY_FILTER_AST.and).toHaveLength(0);
  });
});

describe("emptyFilterAST()", () => {
  test("returns a fresh, mutable AST each call", () => {
    const a = emptyFilterAST();
    const b = emptyFilterAST();
    expect(a.and).not.toBe(b.and);
    expect(a.orGroups).not.toBe(b.orGroups);

    a.and.push({ field: "price", op: "≤", val: "1" });
    a.orGroups.push([{ field: "fuel", op: "is", val: "diesel" }]);

    expect(b.and).toHaveLength(0);
    expect(b.orGroups).toHaveLength(0);
    expect(EMPTY_FILTER_AST.and).toHaveLength(0);
  });

  test("starts out equivalent to the frozen constant", () => {
    expect(isFilterASTEmpty(emptyFilterAST())).toBe(true);
    expect(emptyFilterAST()).toEqual({ search: "", and: [], orGroups: [] });
  });
});
