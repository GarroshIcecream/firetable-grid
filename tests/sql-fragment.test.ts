import { expect, test } from "bun:test";
import { sql } from "../src/sql";

test("nested fragments bind values in traversal order for each dialect", () => {
  const tenant = sql`select * from listings where tenant = ${"tenant-a"}`;
  const query = sql`select * from (${tenant}) grid where name = ${"x'; drop table listings;--"}`;
  expect(query.toQuery("postgres")).toEqual({
    text: "select * from (select * from listings where tenant = $1) grid where name = $2",
    values: ["tenant-a", "x'; drop table listings;--"],
  });
  expect(query.toQuery("snowflake")).toEqual({
    text: "select * from (select * from listings where tenant = ?) grid where name = ?",
    values: ["tenant-a", "x'; drop table listings;--"],
  });
});

test("fragments reject objects and non-finite bind values instead of stringifying SQL", () => {
  for (const value of [{ text: "danger" }, undefined, Number.NaN, Infinity]) {
    expect(() => sql`select ${value as never}`).toThrow();
  }
});

test("rendering cannot mutate a fragment's bindings", () => {
  const query = sql`select ${"a"}`;
  query.toQuery("postgres").values[0] = "changed";
  expect(query.toQuery("postgres").values).toEqual(["a"]);
});
