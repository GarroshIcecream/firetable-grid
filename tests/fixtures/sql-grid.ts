import { ColumnTypes } from "../../examples/column-types";
import { all, any, col, emptyGridView, type GridView, where } from "../../src";
import { type SqlDialect, type SqlGridColumn, sql } from "../../src/sql";

export interface SqlRow {
  id: number;
  name: string | null;
  price: number | null;
  ratio: number | null;
  status: string | null;
  tags: string[] | null;
  tagsText: string | null;
  day: unknown;
  instant: unknown;
  tenant: string;
}
export const sqlColumns: SqlGridColumn<SqlRow>[] = [
  col({ id: "id", label: "Id", type: ColumnTypes.NUMBER }),
  col({ id: "name", label: "Name", type: ColumnTypes.TEXT }),
  col({ id: "price", label: "Price", type: ColumnTypes.NUMBER }),
  col({ id: "ratio", label: "Ratio", type: ColumnTypes.PROGRESS }),
  col({
    id: "status",
    label: "Status",
    type: ColumnTypes.BADGE,
    filterOptions: [
      { value: "new", label: "New" },
      { value: "used", label: "Used" },
    ],
  }),
  {
    ...col({
      id: "tags",
      label: "Tags",
      type: { ...ColumnTypes.BADGE, setValued: true },
    }),
    sqlType: "text[]",
  },
  col({
    id: "tagsText",
    label: "Tags",
    type: { ...ColumnTypes.BADGE, setValued: true },
  }),
  {
    ...col({ id: "day", label: "Day", type: ColumnTypes.DATE }),
    sqlType: "date",
  },
  {
    ...col({ id: "instant", label: "Instant", type: ColumnTypes.DATE }),
    sqlType: "timestamptz",
  },
];
const data = [
  [
    1,
    "Alpha_100%",
    10,
    0.5,
    "new",
    " Red, blue ",
    "2026-09-24",
    "2026-09-24T23:30:00Z",
    "a",
  ],
  [
    2,
    "beta",
    20,
    0.8,
    "used",
    "green",
    "2026-09-25",
    "2026-09-25T10:00:00Z",
    "a",
  ],
  [3, " \t\n", null, null, null, null, null, null, "a"],
  [4, null, "NaN", null, "other", "", null, null, "a"],
  [
    5,
    "ALPHA",
    20,
    0.5,
    "new",
    "blue",
    "2026-09-24",
    "2026-09-24T00:30:00Z",
    "a",
  ],
  [
    6,
    "other tenant",
    1,
    0.2,
    "new",
    "red",
    "2026-09-24",
    "2026-09-24T23:30:00Z",
    "b",
  ],
] as const;

export function fixtureQuery(dialect: SqlDialect) {
  const selects = data.map(
    ([id, name, price, ratio, status, tags, day, instant, tenant]) => {
      const array =
        dialect === "postgres"
          ? sql`string_to_array(CAST(${tags} AS text), ',')`
          : sql`SPLIT(CAST(${tags} AS VARCHAR), ',')`;
      const time =
        dialect === "postgres"
          ? sql`CAST(${instant} AS timestamptz)`
          : sql`CAST(${instant} AS TIMESTAMP_TZ)`;
      const number =
        dialect === "postgres"
          ? sql`CAST(${price} AS numeric)`
          : sql`CAST(${price} AS DOUBLE)`;
      return sql`SELECT CAST(${id} AS INTEGER) AS "id", CAST(${name} AS VARCHAR) AS "name", ${number} AS "price", CAST(${ratio} AS DECIMAL(10,2)) AS "ratio", CAST(${status} AS VARCHAR) AS "status", ${array} AS "tags", CAST(${tags} AS VARCHAR) AS "tagsText", CAST(${day} AS DATE) AS "day", ${time} AS "instant", ${tenant} AS "tenant"`;
    },
  );
  const base = selects
    .slice(1)
    .reduce((query, next) => sql`${query} UNION ALL ${next}`, selects[0]);
  return sql`SELECT * FROM (${base}) fixture WHERE "tenant" = ${"a"}`;
}

const filtered = (filter: GridView["filter"]): GridView => ({
  ...emptyGridView(),
  filter,
});
export const sqlCases: {
  name: string;
  view: GridView;
  ids: number[];
  timeZone?: string;
}[] = [
  {
    name: "tenant scope and stable row-key ordering",
    view: emptyGridView(),
    ids: [1, 2, 3, 4, 5],
  },
  {
    name: "case-insensitive search",
    view: { ...emptyGridView(), search: "alpha" },
    ids: [1, 5],
  },
  {
    name: "literal percent and underscore",
    view: { ...emptyGridView(), search: "_100%" },
    ids: [1],
  },
  {
    name: "empty text equality",
    view: filtered(where("name", "is", "")),
    ids: [3, 4],
  },
  {
    name: "blank and null text",
    view: filtered(where("name", "is empty")),
    ids: [3, 4],
  },
  {
    name: "not equal excludes empty text",
    view: filtered(where("name", "is not", "beta")),
    ids: [1, 5],
  },
  {
    name: "numeric comparison excludes NaN",
    view: filtered(where("price", ">", "10")),
    ids: [2, 5],
  },
  {
    name: "numeric null and NaN are empty",
    view: filtered(where("price", "is empty")),
    ids: [3, 4],
  },
  {
    name: "ratio input uses percentage points",
    view: filtered(where("ratio", "=", "50")),
    ids: [1, 5],
  },
  {
    name: "multi-select tokens",
    view: filtered(where("status", "is", " NEW, USED ")),
    ids: [1, 2, 5],
  },
  {
    name: "negated multi-select",
    view: filtered(where("status", "is not", "new, used")),
    ids: [4],
  },
  {
    name: "array membership trims and folds case",
    view: filtered(where("tags", "is", " RED ")),
    ids: [1],
  },
  {
    name: "array exclusion retains null rows",
    view: filtered(where("tags", "is not", "blue")),
    ids: [2, 3, 4],
  },
  {
    name: "comma text membership",
    view: filtered(where("tagsText", "is", "BLUE")),
    ids: [1, 5],
  },
  {
    name: "empty OR branch stays true",
    view: filtered(any(where("price", "<", "15"), any())),
    ids: [1, 2, 3, 4, 5],
  },
  {
    name: "nested all and any",
    view: filtered(
      all(
        any(where("price", "=", "10"), where("price", "=", "20")),
        where("status", "is", "new"),
      ),
    ),
    ids: [1, 5],
  },
  {
    name: "empty numeric input stays true in OR",
    view: filtered(any(where("price", "<", ""), where("name", "is", "beta"))),
    ids: [1, 2, 3, 4, 5],
  },
  {
    name: "calendar date",
    view: filtered(where("day", "on", "2026-09-24")),
    ids: [1, 5],
  },
  {
    name: "open ended date range",
    view: filtered(where("day", "between", "2026-09-25|")),
    ids: [2],
  },
  {
    name: "instant in Prague",
    view: filtered(where("instant", "on", "2026-09-25")),
    timeZone: "Europe/Prague",
    ids: [1, 2],
  },
  {
    name: "instant in UTC",
    view: filtered(where("instant", "on", "2026-09-25")),
    timeZone: "UTC",
    ids: [2],
  },
  {
    name: "enum declaration order with unknowns last",
    view: { ...emptyGridView(), sort: [{ field: "status", dir: "asc" }] },
    ids: [1, 5, 2, 3, 4],
  },
  {
    name: "enum descending keeps unknowns last",
    view: { ...emptyGridView(), sort: [{ field: "status", dir: "desc" }] },
    ids: [2, 1, 5, 3, 4],
  },
  {
    name: "blank date range is inactive",
    view: filtered(where("day", "between", "")),
    ids: [1, 2, 3, 4, 5],
  },
];
