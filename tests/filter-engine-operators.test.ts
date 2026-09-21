import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import {
  all,
  any,
  applyView,
  col,
  emptyGridView,
  type GridView,
  where,
} from "../src";

// Covers empty-value handling, "is empty"/"is not empty" operators,
// percentage-point entry for ratio-stored columns, and the all/any branches
// that combine conditions.

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

const ids = (result: Row[]) => result.map((r) => r.id);
const run = (view: GridView) => ids(applyView(rows, view, columns));
const filtering = (filter: GridView["filter"]): GridView => ({
  ...emptyGridView(),
  filter,
});

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
    const result = applyView(
      values,
      filtering(where("name", op, "Repair bumper, door")),
      textColumns,
    );
    expect(result).toEqual([values[0]]);
  });

  test("is not excludes the complete value rather than comma-separated tokens", () => {
    expect(
      applyView(
        values,
        filtering(where("name", "is not", "Repair bumper, door")),
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
      applyView(values, filtering(where("name", "is", "bumper,door")), dynamic),
    ).toEqual(values.slice(2));
  });
});

describe("empty-value handling (#5)", () => {
  test("a numeric comparison excludes rows with an empty value", () => {
    // Only 'a' (100). 'b' has a null score and must NOT slip through.
    expect(run(filtering(where("score", ">", "50")))).toEqual(["a"]);
  });

  test("a scalar text 'is not' excludes rows with an empty value", () => {
    // 'b' has an empty name and is excluded despite not equalling "alpha".
    expect(run(filtering(where("name", "is not", "alpha")))).toEqual(["c"]);
  });
});

describe("'is empty' / 'is not empty' operators (#6)", () => {
  test("'is empty' matches only rows with an empty value", () => {
    expect(run(filtering(where("score", "is empty")))).toEqual(["b"]);
  });

  test("'is not empty' matches only rows with a value", () => {
    expect(run(filtering(where("score", "is not empty")))).toEqual(["a", "c"]);
  });
});

describe("percentage-point entry for ratio columns (#7)", () => {
  test("'> 50' (points) compares against the stored 0..1 fraction", () => {
    // 50% → 0.5. Only 'a' (0.6). 'b' (0.4) is below; 'c' (null) excluded.
    expect(run(filtering(where("ratio", ">", "50")))).toEqual(["a"]);
  });

  test("'≥ 40' (points) is inclusive of the equal fraction", () => {
    expect(run(filtering(where("ratio", "≥", "40")))).toEqual(["a", "b"]);
  });
});

describe("all / any (#1, #2, #3)", () => {
  test("`all` requires every child", () => {
    expect(
      run(
        filtering(
          all(where("score", ">", "50"), where("name", "contains", "beta")),
        ),
      ),
    ).toEqual([]);
  });

  test("`any` matches when one child matches", () => {
    expect(
      run(
        filtering(
          any(where("score", ">", "50"), where("name", "contains", "beta")),
        ),
      ),
    ).toEqual(["a", "c"]);
  });

  test("`any` over one column is the multi-select case", () => {
    expect(
      run(
        filtering(
          any(where("name", "is", "alpha"), where("name", "is", "beta")),
        ),
      ),
    ).toEqual(["a", "c"]);
  });

  test("`all` over one column intersects its conditions", () => {
    // "beta" contains "a" and is not "alpha"; "alpha" is excluded by the 2nd.
    expect(
      run(
        filtering(
          all(where("name", "contains", "a"), where("name", "is not", "alpha")),
        ),
      ),
    ).toEqual(["c"]);
  });

  test("a bare condition needs no branch around it", () => {
    expect(run(filtering(where("score", ">", "50")))).toEqual(["a"]);
  });
});

// Arbitrary nesting is the capability the two-level shape could not express.
describe("nested branches", () => {
  test("an `any` inside an `all` gates the group without widening it", () => {
    expect(
      run(
        filtering(
          all(
            where("score", "is not empty"),
            any(where("name", "is", "alpha"), where("name", "is", "beta")),
          ),
        ),
      ),
    ).toEqual(["a", "c"]);
  });

  test("an `all` inside an `any` offers an alternative to the rest", () => {
    expect(
      run(
        filtering(
          any(
            all(where("score", ">", "50"), where("name", "is", "alpha")),
            where("name", "is", "beta"),
          ),
        ),
      ),
    ).toEqual(["a", "c"]);
  });
});

// A filter row the user has started but not finished must narrow nothing,
// rather than emptying the grid under them mid-edit.
describe("a branch with no children matches everything", () => {
  test("an empty `all` filters nothing out", () => {
    expect(run(filtering(all()))).toEqual(["a", "b", "c"]);
  });

  test("an empty `any` filters nothing out either", () => {
    expect(run(filtering(any()))).toEqual(["a", "b", "c"]);
  });

  test("an empty branch nested in an `all` does not exclude every row", () => {
    expect(run(filtering(all(where("score", ">", "50"), any())))).toEqual([
      "a",
    ]);
  });
});

// Both of these were found by differential-fuzzing the compiled filter against
// the original row-at-a-time evaluator. They cover operators that a column's
// type does not define - reachable from a saved view whose column changed type
// under it, which is exactly when a filter must not quietly widen.
describe("operators a column does not define", () => {
  type Mixed = { num: number | string | null };
  const mixed = [
    col<Mixed>({ id: "num", label: "Num", type: ColumnTypes.NUMBER }),
  ];
  const mixedRows: Mixed[] = [
    { num: 5 },
    { num: "abc" },
    { num: null },
    { num: 0 },
  ];

  test("an inapplicable operator still excludes non-numeric rows", () => {
    // "on" is a date operator. It compares nothing here, but a row whose value
    // is not a number must not pass a numeric filter it never satisfied.
    expect(
      applyView(mixedRows, filtering(where("num", "on", "0")), mixed),
    ).toEqual([{ num: 5 }, { num: 0 }]);
  });

  test("a separator-only multi-select value still excludes empty rows", () => {
    // "," splits to no values, so it selects nothing and filters nothing - but
    // the empty-row exclusion still applies, because the value is not blank.
    type Enm = { enm: string | null };
    const enumCols = [
      col<Enm>({
        id: "enm",
        label: "Enum",
        type: ColumnTypes.BADGE,
        filterOptions: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ];
    const enumRows: Enm[] = [{ enm: "a" }, { enm: "" }, { enm: null }];
    expect(
      applyView(enumRows, filtering(where("enm", "is", ",")), enumCols),
    ).toEqual([{ enm: "a" }]);
  });

  test("an unknown column is skipped rather than excluding every row", () => {
    expect(run(filtering(where("nosuch", "is", "x")))).toEqual(["a", "b", "c"]);
  });
});

// Search is an AND-gate over whatever the filter selects, whatever boolean
// shape that filter has - an `any` filter must not widen past the query.
describe("search combines with the filter", () => {
  test("a query narrows an `any` filter rather than joining it", () => {
    expect(
      run({
        ...emptyGridView(),
        search: "beta",
        filter: any(where("score", ">", "50"), where("name", "is", "beta")),
      }),
    ).toEqual(["c"]);
  });
});
