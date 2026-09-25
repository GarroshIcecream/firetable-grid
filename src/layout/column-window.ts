export interface ColumnGap {
  start: number;
  count: number;
  width: number;
}

export interface ColumnWindow {
  slots: Array<{ index: number; before: ColumnGap }>;
  after: ColumnGap;
  totalWidth: number;
  pinnedWidth: number;
}

export interface ColumnWindowOptions {
  scrollLeft: number;
  viewportWidth: number;
  overscan?: number;
  keep?: ReadonlySet<string>;
}

/** Columns use display order, with pinned columns grouped at the leading edge. */
export function buildColumnWindow(
  columns: readonly { id: string; size: number; isPinned: boolean }[],
  options: ColumnWindowOptions,
): ColumnWindow {
  const { viewportWidth, scrollLeft, keep, overscan = 2 } = options;
  if (!Number.isSafeInteger(overscan) || overscan < 0)
    throw new RangeError("Column overscan must be a non-negative safe integer");
  if (!Number.isFinite(viewportWidth) || viewportWidth < 0)
    throw new RangeError(
      "Column viewport width must be finite and non-negative",
    );
  if (!Number.isFinite(scrollLeft))
    throw new RangeError("Column scroll offset must be finite");

  const offsets = [0];
  const unpinned: number[] = [];
  const retained = new Set<number>();
  let pinnedWidth = 0;
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index];
    if (!Number.isFinite(column.size) || column.size <= 0)
      throw new RangeError("Column widths must be finite and positive");
    offsets.push(offsets[index] + column.size);
    if (column.isPinned) {
      retained.add(index);
      pinnedWidth += column.size;
    } else {
      unpinned.push(index);
    }
    if (keep?.has(column.id)) retained.add(index);
  }
  const totalWidth = offsets[columns.length];
  if (!Number.isFinite(totalWidth))
    throw new RangeError("Total column width must be finite");

  let first = -1;
  let last = -1;
  if (viewportWidth === 0 && unpinned.length > 0) {
    // Before measurement, mount an initial column and its overscan neighbors.
    first = 0;
    last = 0;
  } else if (viewportWidth > pinnedWidth) {
    const left = Math.max(
      0,
      Math.min(scrollLeft, Math.max(0, totalWidth - viewportWidth)),
    );
    const start = left + pinnedWidth;
    const end = left + viewportWidth;
    for (let position = 0; position < unpinned.length; position++) {
      const index = unpinned[position];
      if (offsets[index + 1] > start && offsets[index] < end) {
        if (first === -1) first = position;
        last = position;
      }
    }
  }
  if (first !== -1) {
    const start = Math.max(0, first - overscan);
    const end = Math.min(unpinned.length - 1, last + overscan);
    for (let position = start; position <= end; position++)
      retained.add(unpinned[position]);
  }

  const gap = (start: number, end: number): ColumnGap => ({
    start,
    count: end - start,
    width: offsets[end] - offsets[start],
  });
  const slots: ColumnWindow["slots"] = [];
  let next = 0;
  for (let index = 0; index < columns.length; index++) {
    if (!retained.has(index)) continue;
    slots.push({ index, before: gap(next, index) });
    next = index + 1;
  }
  return {
    slots,
    after: gap(next, columns.length),
    totalWidth,
    pinnedWidth,
  };
}
