// The README's headless-layout example, kept compiling: the pieces you reach
// for when you render the grid yourself instead of using <DataGrid>.

import { col, type SchemaColumn } from "../src";
import {
  buildCellSpecs,
  buildColumnLayout,
  buildFlatItems,
  buildRowPositionsByIndex,
  buildVirtualRenderPlan,
  columnWidth,
  computeRowsAgg,
  pendingRowRunway,
  resolvePinnedColumns,
} from "../src/layout";
import {
  ColumnTypes,
  DENSE_CELL_RENDERERS,
  SKELETON_SHAPES,
} from "./column-types";

interface Row {
  make: string;
  price: number;
}

const columns = [
  col<Row>({ id: "make", label: "Make", type: ColumnTypes.TEXT, frozen: true }),
  col<Row>({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
];

export function layoutFor(
  rows: readonly Row[],
  opts: {
    collapsed?: ReadonlySet<string>;
    compact?: boolean;
    userPinnedColumns?: readonly string[];
    wrapCells?: boolean;
  } = {},
) {
  // Which columns are frozen, in which order, and where each sticks.
  const { pinned } = resolvePinnedColumns({
    compact: opts.compact ?? false,
    frozenColumns: columns.filter((c) => c.frozen).map((c) => c.id),
    userPinnedColumns: opts.userPinnedColumns,
  });
  const layout = buildColumnLayout(
    columns.map((c: SchemaColumn<Row>) => ({
      id: c.id,
      item: c,
      minWidth: c.minWidth,
      size: c.width,
    })),
    pinned,
  );

  // Group headers and rows interleaved into one virtualizable list, then the
  // 1..n numbering that counts what is on screen rather than `row.index + 1`.
  const wrapped = rows.map((original) => ({ original }));
  const flatItems = buildFlatItems(wrapped, "make", "asc", opts.collapsed);
  const positions = buildRowPositionsByIndex(flatItems);

  // Per-column cell facts, hoisted out of the per-row render loop.
  const specs = buildCellSpecs(layout, {
    wrapCells: opts.wrapCells ?? false,
    denseCellRenderers: DENSE_CELL_RENDERERS,
    skeletonShapes: SKELETON_SHAPES,
  });

  return {
    layout,
    flatItems,
    positions,
    specs,
    // Widths travel as CSS custom properties, so a resize never re-renders.
    firstWidth: columnWidth(layout[0].id, layout[0].size),
    total: computeRowsAgg(wrapped, "price", "sum"),
  };
}

/** Slot geometry for a virtualizer's current window, plus the placeholder tail
 *  to render past the loaded edge while the next page is in flight. */
export function renderWindow(
  virtualItems: readonly { index: number; start: number; end: number }[],
  totalSize: number,
  paging: { loadedRowCount: number; totalCount: number | null },
) {
  return {
    plan: buildVirtualRenderPlan(virtualItems, totalSize),
    runway: pendingRowRunway({ ...paging, pageSize: 100, hasNextPage: true }),
  };
}
