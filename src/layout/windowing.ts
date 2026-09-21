// Windowing for fixed-height rows, with no virtualizer dependency.
//
// `buildVirtualRenderPlan` handles items supplied by someone ELSE's
// virtualizer - it takes index/start/end and works out the spacers between
// non-contiguous items. This is the other path: when every row is the same
// height, the window is arithmetic, and a grid should not need a dependency to
// do arithmetic. `@tanstack/react-virtual` stays an optional peer, imported
// for types only, exactly as `use-column-resize-preview` does.

export interface FixedRowWindow {
  /** First item index to render. */
  startIndex: number;
  /** Last item index to render, INCLUSIVE. `-1` when there is nothing. */
  endIndex: number;
  /** Spacer height above the rendered slice. */
  before: number;
  /** Spacer height below it. */
  after: number;
}

/**
 * The slice of a fixed-height list a scroll position covers.
 *
 * `before` and `after` plus the rendered rows always sum to the full height,
 * which is the invariant that matters: if they drift, the scrollbar reports a
 * length the content does not have and the position jumps as you scroll.
 */
export function fixedRowWindow({
  itemCount,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 8,
}: {
  itemCount: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): FixedRowWindow {
  if (itemCount <= 0) {
    return { startIndex: 0, endIndex: -1, before: 0, after: 0 };
  }
  // A height of zero would divide to Infinity. Rendering everything is the
  // safe answer: slow, but never blank.
  if (rowHeight <= 0) {
    return { startIndex: 0, endIndex: itemCount - 1, before: 0, after: 0 };
  }

  const pad = Math.max(0, overscan);
  // macOS rubber-band overscroll reports a negative scrollTop, and a negative
  // first index computes a negative spacer - which collapses the grid.
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / rowHeight);
  // A viewport of zero is the first paint, before anything is measured. The
  // overscan alone still renders rows, so the grid is never blank while it
  // waits for a height.
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);

  const startIndex = Math.max(0, Math.min(first - pad, itemCount - 1));
  const endIndex = Math.min(itemCount - 1, first + visible + pad);

  return {
    startIndex,
    endIndex,
    before: startIndex * rowHeight,
    after: (itemCount - 1 - endIndex) * rowHeight,
  };
}

/**
 * Whether the rendered window has come within `threshold` rows of the loaded
 * edge, and the next page should be asked for.
 *
 * `threshold` must stay BELOW the caller's page size. Above it, the page that
 * lands is itself inside the threshold, so this returns true again immediately
 * and the fetches chain until the data runs out.
 */
export function reachedEndOfRows({
  lastRenderedIndex,
  loadedRowCount,
  threshold,
}: {
  lastRenderedIndex: number;
  loadedRowCount: number;
  threshold: number;
}): boolean {
  if (loadedRowCount <= 0) return false;
  return lastRenderedIndex >= loadedRowCount - 1 - Math.max(0, threshold);
}
