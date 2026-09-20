import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import { applyAST, col, type FilterAST } from "../src";

// Covers empty-value handling, "is empty"/"is not empty" operators,
// percentage-point entry for ratio-stored columns, and user-selectable AND/OR
// between top-level terms and inside groups.

type Row = {
  id: string;
  score: number | null;
  ratio: number | null;
  name: string;
};

const columns = [
  col<Row>({ id: "score", label: "Score", type: ColumnTypes.NUMBER }),
  // PROGRESS stores a 0..1 ratio; the filter enters percentage points.
  col<Row>({ id: "ratio", label: "Ratio", type: ColumnTypes.PROGRESS }),
  col<Row>({ id: "name", label: "Name", type: ColumnTypes.TEXT }),
];

const rows: Row[] = [
  { id: "a", score: 100, ratio: 0.6, name: "alpha" },
  { id: "b", score: null, ratio: 0.4, name: "" },
  { id: "c", score: 20, ratio: null, name: "beta" },
];

const base = (): FilterAST => ({ search: "", and: [], orGroups: [] });
const ids = (result: Row[]) => result.map((r) => r.id);
const run = (ast: FilterAST) => ids(applyAST(rows, ast, columns));

describe("literal commas in text filters", () => {
  const values = [
    { name: "Repair bumper, door" },
    { name: "Change oil" },
    { name: "bumper" },
    { name: "door" },
  ];
  const textColumns = [
    col<{ name: string }>({
      id: "name",
      label: "Name",
      type: ColumnTypes.TEXT,
    }),
  ];

  test.each(["is", "contains"] as const)("%s keeps the comma as text", (op) => {
    const result = applyAST(
      values,
      {
        ...base(),
        and: [{ field: "name", op, val: "Repair bumper, door" }],
      },
      textColumns,
    );
    expect(result).toEqual([values[0]]);
  });

  test("is not excludes the complete value rather than comma-separated tokens", () => {
    expect(
      applyAST(
        values,
        {
          ...base(),
          and: [{ field: "name", op: "is not", val: "Repair bumper, door" }],
        },
        textColumns,
      ),
    ).toEqual(values.slice(1));
  });

  test("dynamic multi-select text columns still match selected values", () => {
    const dynamic = [
      col<{ name: string }>({
        id: "name",
        label: "Name",
        type: ColumnTypes.TEXT,
        dynamicOptions: true,
      }),
    ];
    expect(
      applyAST(
        values,
        {
          ...base(),
          and: [{ field: "name", op: "is", val: "bumper,door" }],
        },
        dynamic,
      ),
    ).toEqual(values.slice(2));
  });
});

describe("empty-value handling (#5)", () => {
  test("a numeric comparison excludes rows with an empty value", () => {
    const ast = {
      ...base(),
      and: [{ field: "score", op: ">" as const, val: "50" }],
    };
    // Only 'a' (100). 'b' has a null score and must NOT slip through.
    expect(run(ast)).toEqual(["a"]);
  });

  test("a scalar text 'is not' excludes rows with an empty value", () => {
    const ast = {
      ...base(),
      and: [{ field: "name", op: "is not" as const, val: "alpha" }],
    };
    // 'b' has an empty name and is excluded despite not equalling "alpha".
    expect(run(ast)).toEqual(["c"]);
  });
});

describe("'is empty' / 'is not empty' operators (#6)", () => {
  test("'is empty' matches only rows with an empty value", () => {
    const ast = {
      ...base(),
      and: [{ field: "score", op: "is empty" as const, val: "" }],
    };
    expect(run(ast)).toEqual(["b"]);
  });

  test("'is not empty' matches only rows with a value", () => {
    const ast = {
      ...base(),
      and: [{ field: "score", op: "is not empty" as const, val: "" }],
    };
    expect(run(ast)).toEqual(["a", "c"]);
  });
});

describe("percentage-point entry for ratio columns (#7)", () => {
  test("'> 50' (points) compares against the stored 0..1 fraction", () => {
    const ast = {
      ...base(),
      and: [{ field: "ratio", op: ">" as const, val: "50" }],
    };
    // 50% → 0.5. Only 'a' (0.6). 'b' (0.4) is below; 'c' (null) excluded.
    expect(run(ast)).toEqual(["a"]);
  });

  test("'≥ 40' (points) is inclusive of the equal fraction", () => {
    const ast = {
      ...base(),
      and: [{ field: "ratio", op: "≥" as const, val: "40" }],
    };
    expect(run(ast)).toEqual(["a", "b"]);
  });
});

describe("top-level AND/OR (#1, #2)", () => {
  test("andOp 'and' requires every term (default/legacy behavior)", () => {
    const ast = {
      ...base(),
      and: [
        { field: "score", op: ">" as const, val: "50" },
        { field: "name", op: "contains" as const, val: "beta" },
      ],
    };
    expect(run(ast)).toEqual([]);
  });

  test("andOp 'or' matches when any term matches", () => {
    const ast = {
      ...base(),
      andOp: "or" as const,
      and: [
        { field: "score", op: ">" as const, val: "50" },
        { field: "name", op: "contains" as const, val: "beta" },
      ],
    };
    expect(run(ast)).toEqual(["a", "c"]);
  });
});

describe("group inner AND/OR (#3)", () => {
  test("a group defaults to OR within (legacy behavior)", () => {
    const ast = {
      ...base(),
      orGroups: [
        [
          { field: "name", op: "is" as const, val: "alpha" },
          { field: "name", op: "is" as const, val: "beta" },
        ],
      ],
    };
    expect(run(ast)).toEqual(["a", "c"]);
  });

  test("a group with inner op 'and' requires both conditions", () => {
    const ast = {
      ...base(),
      orGroups: [
        [
          { field: "name", op: "contains" as const, val: "a" },
          { field: "name", op: "is not" as const, val: "alpha" },
        ],
      ],
      groupOps: ["and" as const],
    };
    // "beta" contains "a" and is not "alpha"; "alpha" is excluded by the 2nd.
    expect(run(ast)).toEqual(["c"]);
  });
});
