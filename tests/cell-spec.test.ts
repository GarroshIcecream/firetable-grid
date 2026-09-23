import { describe, expect, test } from "bun:test";
import {
  buildCellSpecs,
  type ColumnLayoutEntry,
  PINNED_EDGE_BORDER,
  PINNED_INNER_EDGE_SHADOW,
  SELECTION_COLUMN_ID,
} from "../src/layout";

interface Row {
  price: number;
}

// `buildCellSpecs` only reads `item.column.columnDef.meta`, so a header fake is
// enough — building a real TanStack table here would test TanStack, not this.
type Meta = {
  type?: { cellRenderer?: string; cellAlignment?: "start" | "center" | "end" };
  cellTint?: (row: Row) => string | undefined;
};

function entry(
  id: string,
  meta: Meta | undefined,
  over: Partial<ColumnLayoutEntry<never>> = {},
): ColumnLayoutEntry<never> {
  return {
    id,
    size: 120,
    isPinned: false,
    isLastPinned: false,
    ...over,
    item: { column: { columnDef: { meta } } },
  } as unknown as ColumnLayoutEntry<never>;
}

const opts = { wrapCells: false, enableSelection: false };

describe("buildCellSpecs", () => {
  test("width, minWidth and maxWidth all read the column's size property", () => {
    const [spec] = buildCellSpecs<Row>([entry("price", undefined)], opts);
    const expected = "var(--ftg-size-70-72-69-63-65, 120px)";
    expect(spec.style.width).toBe(expected);
    expect(spec.style.minWidth).toBe(expected);
    expect(spec.style.maxWidth).toBe(expected);
  });

  test("an unpinned cell gets no sticky offset and no edge", () => {
    const [spec] = buildCellSpecs<Row>([entry("price", undefined)], opts);
    expect(spec.style.left).toBeUndefined();
    expect(spec.staticClass).not.toContain("sticky");
    expect(spec.staticClass).not.toContain(PINNED_EDGE_BORDER);
  });

  test("the last pinned column carries the border, inner ones the hairline", () => {
    const [inner, last] = buildCellSpecs<Row>(
      [
        entry("a", undefined, { isPinned: true, stickyLeft: 0 }),
        entry("b", undefined, {
          isPinned: true,
          isLastPinned: true,
          stickyLeft: 120,
        }),
      ],
      opts,
    );
    expect(inner.staticClass).toContain(PINNED_INNER_EDGE_SHADOW);
    expect(inner.staticClass).not.toContain(PINNED_EDGE_BORDER);
    expect(last.staticClass).toContain(PINNED_EDGE_BORDER);
    expect(last.style.left).toBe("var(--ftg-left-62, 120px)");
  });

  test("wrapping flips both the wrap and the vertical axis", () => {
    const [off] = buildCellSpecs<Row>([entry("price", undefined)], opts);
    const [on] = buildCellSpecs<Row>([entry("price", undefined)], {
      ...opts,
      wrapCells: true,
    });
    expect(off.staticClass).toContain("whitespace-nowrap");
    expect(off.staticClass).toContain("align-middle");
    expect(on.staticClass).toContain("whitespace-normal");
    expect(on.staticClass).toContain("align-top");
  });

  test("horizontal alignment comes from the column type", () => {
    const [spec] = buildCellSpecs<Row>(
      [entry("price", { type: { cellAlignment: "end" } })],
      opts,
    );
    expect(spec.staticClass).toContain("text-right");
  });

  describe("skeleton shapes", () => {
    test("resolve from the map you pass, falling back to text", () => {
      const [num, unknown] = buildCellSpecs<Row>(
        [
          entry("a", { type: { cellRenderer: "currency" } }),
          entry("b", { type: { cellRenderer: "nope" } }),
        ],
        { ...opts, skeletonShapes: { currency: "number" } },
      );
      expect(num.skeletonShape).toBe("number");
      expect(unknown.skeletonShape).toBe("text");
    });

    test("an omitted map leaves every renderer as text", () => {
      const [spec] = buildCellSpecs<Row>(
        [entry("a", { type: { cellRenderer: "currency" } })],
        opts,
      );
      expect(spec.skeletonShape).toBe("text");
    });
  });

  test("the dense renderer set threads through to padding", () => {
    const [spec] = buildCellSpecs<Row>(
      [entry("a", { type: { cellRenderer: "sparkline" } })],
      { ...opts, denseCellRenderers: new Set(["sparkline"]) },
    );
    expect(spec.staticClass).toContain("px-1.5");
  });

  describe("the selection column", () => {
    const layout = [
      entry(SELECTION_COLUMN_ID, { type: { cellRenderer: "x" } }),
    ];

    test("is inert when selection is off", () => {
      const [spec] = buildCellSpecs<Row>(layout, opts);
      expect(spec.isSelectionCell).toBe(false);
      expect(spec.skeletonShape).toBe("text");
    });

    test("takes its own padding and renders no skeleton when on", () => {
      const [spec] = buildCellSpecs<Row>(layout, {
        ...opts,
        enableSelection: true,
      });
      expect(spec.isSelectionCell).toBe(true);
      expect(spec.skeletonShape).toBe("none");
      expect(spec.staticClass).toContain("pl-3.5");
    });
  });
});
