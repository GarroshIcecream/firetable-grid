import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import type { ColumnType } from "../src";
import {
  CELL_PADDING_CLASS,
  cellPaddingClass,
  columnLeft,
  columnLeftProperty,
  columnSizeProperty,
  columnWidth,
  DENSE_CELL_PADDING_CLASS,
  tableGeometry,
} from "../src/layout";

describe("column geometry", () => {
  test("an id becomes a valid custom property", () => {
    expect(columnSizeProperty("price")).toBe("--ftg-size-70-72-69-63-65");
  });

  test("ids that are not valid CSS identifiers still produce valid names", () => {
    // Spaces, dots and brackets would all break a naive `--ftg-size-${id}`.
    for (const id of ["a b", "a.b", "a[0]", "über", "—", "__select__"]) {
      expect(columnSizeProperty(id)).toMatch(/^--ftg-size-[0-9a-f-]+$/);
    }
  });

  test("distinct ids never collide", () => {
    const ids = ["ab", "a-b", "a", "b", "AB", "a b"];
    const props = new Set(ids.map(columnSizeProperty));
    expect(props.size).toBe(ids.length);
  });

  test("the left property mirrors the size property", () => {
    expect(columnLeftProperty("price")).toBe("--ftg-left-70-72-69-63-65");
  });

  test("a size property collision cannot leak into the left namespace", () => {
    // `replace` targets the prefix only; an id whose hex contains the prefix
    // text would otherwise be rewritten mid-string.
    expect(columnLeftProperty("x")).toBe("--ftg-left-78");
  });

  test("width and left read the property with a px fallback", () => {
    expect(columnWidth("x", 120)).toBe("var(--ftg-size-78, 120px)");
    expect(columnLeft("x", 36)).toBe("var(--ftg-left-78, 36px)");
  });

  test("table geometry reads the shared totals", () => {
    expect(tableGeometry("pinned", 0)).toBe("var(--ftg-pinned, 0px)");
    expect(tableGeometry("after", 42)).toBe("var(--ftg-after, 42px)");
  });
});

describe("cellPaddingClass", () => {
  test("a text column gets the standard gutter", () => {
    expect(cellPaddingClass({ cellRenderer: "text" })).toBe(CELL_PADDING_CLASS);
  });

  test("no renderer is dense unless you name it", () => {
    expect(cellPaddingClass({ cellRenderer: "indexCell" })).toBe(
      CELL_PADDING_CLASS,
    );
    expect(cellPaddingClass({ cellRenderer: "thumbnail" })).toBe(
      CELL_PADDING_CLASS,
    );
  });

  test("an unknown or absent renderer falls back to the standard gutter", () => {
    expect(cellPaddingClass(undefined)).toBe(CELL_PADDING_CLASS);
    expect(cellPaddingClass({ dataType: "number" })).toBe(CELL_PADDING_CLASS);
  });

  test("a ColumnType passes straight in, renderer-null and all", () => {
    // Regression: `ColumnType.cellRenderer` is `string | null`, so a narrower
    // `string | undefined` here forced every caller into a cast.
    const nullRenderer: ColumnType = {
      dataType: "index",
      cellRenderer: null,
      filterType: null,
      sortable: false,
      groupable: false,
      aggregatable: false,
    };
    expect(cellPaddingClass(nullRenderer)).toBe(CELL_PADDING_CLASS);
    expect(cellPaddingClass(ColumnTypes.INDEX)).toBe(CELL_PADDING_CLASS);
    expect(cellPaddingClass(ColumnTypes.TEXT)).toBe(CELL_PADDING_CLASS);
  });

  test("the dense set is the catalogue's to name", () => {
    const mine = new Set(["sparkline"]);
    expect(cellPaddingClass({ cellRenderer: "sparkline" }, mine)).toBe(
      DENSE_CELL_PADDING_CLASS,
    );
    expect(cellPaddingClass({ cellRenderer: "indexCell" }, mine)).toBe(
      CELL_PADDING_CLASS,
    );
    expect(cellPaddingClass(ColumnTypes.INDEX, new Set(["indexCell"]))).toBe(
      DENSE_CELL_PADDING_CLASS,
    );
  });
});
