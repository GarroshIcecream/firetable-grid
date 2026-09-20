// Horizontal padding for table cells, shared by the header and the body so the
// two can never drift apart.
//
// Most columns hold text and get the standard gutter. Narrow structural columns
// (a row-index strip, a thumbnail) hold a fixed-size graphic just 20-60px wide,
// where a 12px gutter on each side is a third of the column and pushes the
// first real value to the right for no benefit — they get a tighter one.

export const CELL_PADDING_CLASS = "px-3";
export const DENSE_CELL_PADDING_CLASS = "px-1.5";

/**
 * Renderers that get the tight gutter by default.
 *
 * Matched on the cell renderer rather than `dataType`, because a thumbnail
 * column reports the same generic `dataType: "composite"` that text columns do.
 * Pass your own set to `cellPaddingClass` (or to `buildCellSpecs`) when your
 * catalogue names them differently.
 */
export const DEFAULT_DENSE_CELL_RENDERERS: ReadonlySet<string> = new Set([
  "indexCell",
  "thumbnail",
]);

export type CellPaddingType = {
  cellRenderer?: string;
  dataType?: string;
};

export function cellPaddingClass(
  type: CellPaddingType | undefined,
  denseRenderers: ReadonlySet<string> = DEFAULT_DENSE_CELL_RENDERERS,
): string {
  const renderer = type?.cellRenderer;
  return renderer && denseRenderers.has(renderer)
    ? DENSE_CELL_PADDING_CLASS
    : CELL_PADDING_CLASS;
}
