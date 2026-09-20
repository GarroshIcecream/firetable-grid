import { describe, expect, test } from "bun:test";

import { type FilterAST, projectFilterAST } from "../src";

// `projectFilterAST` exists because rebuilding a FilterAST as a
// `{ search, and, orGroups }` literal silently drops `andOp` / `groupOps`.
// That turns "diesel OR under 20k" into "diesel AND under 20k" - a different
// result set, with nothing in the UI to signal the change. Every caller that
// narrows an AST (the chat assistant applying a model intent, the
// column-access projection) must keep the user's boolean logic intact.

const ast = (over: Partial<FilterAST> = {}): FilterAST => ({
  search: "",
  and: [],
  orGroups: [],
  ...over,
});

const cond = (field: string) => ({ field, op: "=" as const, val: "x" });

describe("projectFilterAST", () => {
  test("keeps the top-level operator so an OR filter stays an OR filter", () => {
    const result = projectFilterAST(
      ast({ and: [cond("fuel"), cond("price")], andOp: "or" }),
      () => true,
    );

    expect(result.andOp).toBe("or");
  });

  test("reindexes groupOps when a group loses every kept condition", () => {
    // Group 0 ("and") is dropped entirely; group 1's "and" must travel with
    // it, or the surviving group silently inherits group 0's operator.
    const result = projectFilterAST(
      ast({
        orGroups: [[cond("denied")], [cond("fuel"), cond("price")]],
        groupOps: ["or", "and"],
      }),
      (c) => c.field !== "denied",
    );

    expect(result.orGroups).toEqual([[cond("fuel"), cond("price")]]);
    expect(result.groupOps).toEqual(["and"]);
  });

  test("fills a missing per-group operator with the legacy OR default", () => {
    const result = projectFilterAST(
      ast({ orGroups: [[cond("fuel")], [cond("price")]], groupOps: ["and"] }),
      () => true,
    );

    expect(result.groupOps).toEqual(["and", "or"]);
  });

  test("leaves a legacy AST without operators unchanged", () => {
    const legacy = ast({ search: "octavia", and: [cond("fuel")] });

    expect(projectFilterAST(legacy, () => true)).toEqual(legacy);
  });

  test("drops conditions the caller rejects", () => {
    const result = projectFilterAST(
      ast({ and: [cond("fuel"), cond("denied")] }),
      (c) => c.field !== "denied",
    );

    expect(result.and).toEqual([cond("fuel")]);
  });
});
