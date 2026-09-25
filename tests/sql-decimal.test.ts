import { expect, test } from "bun:test";
import { emptyGridView, where } from "../src";
import { compileGridQuery, GridRequestError } from "../src/sql";
import { sqlColumns } from "./fixtures/sql-grid";

test("Snowflake decimal bindings preserve digits and scale, including exponent and ratios", () => {
  for (const [field, value, want, scale] of [
    ["price", "9007199254740993", "9007199254740993", 0],
    ["price", "000.0012300", "0.00123", 5],
    ["ratio", "1.234e-4", "0.000001234", 9],
    ["price", "1.23e3", "1230", 0],
    ["price", "-0", "0", 0],
  ] as const) {
    const query = compileGridQuery(
      { ...emptyGridView(), filter: where(field, "=", value) },
      sqlColumns,
      { dialect: "snowflake", rowKey: "id" },
    ).where.toQuery("snowflake");
    expect(query.values).toContain(want);
    expect(query.text).toContain(`NUMBER(38, ${scale})`);
  }
});

test("Snowflake rejects decimals outside its precision instead of rounding the filter", () => {
  for (const value of ["1e38", "0.00000000000000000000000000000000000001"]) {
    expect(() =>
      compileGridQuery(
        { ...emptyGridView(), filter: where("price", "=", value) },
        sqlColumns,
        { dialect: "snowflake", rowKey: "id" },
      ),
    ).toThrow(GridRequestError);
  }
});
