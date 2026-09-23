// Horizontal padding for table cells, shared by the header and the body so the
// two can never drift apart.
//
// Most columns hold text and get the standard gutter. A narrow structural
// column — a row-index strip, a thumbnail — holds a fixed-size graphic just
// 20-60px wide, where a 12px gutter on each side is a third of the column and
// pushes the first real value to the right for no benefit, so it wants a
// tighter one. Which renderers those are is the catalogue's call, not this
// module's: name them in `denseRenderers`. The default is empty, so every
// cell keeps the standard gutter until you say otherwise.

export const CELL_PADDING_CLASS = "px-3";
export const DENSE_CELL_PADDING_CLASS = "px-1.5";

const NO_DENSE_RENDERERS: ReadonlySet<string> = new Set();

/**
 * The slice of a column type this needs. `cellRenderer` accepts `null` so a
 * `ColumnType` — where a column with no renderer declares `cellRenderer: null`
 * — can be passed straight in without a cast.
 */
export type CellPaddingType = {
  cellRenderer?: string | null;
  dataType?: string;
};

export function cellPaddingClass(
  type: CellPaddingType | undefined,
  denseRenderers: ReadonlySet<string> = NO_DENSE_RENDERERS,
): string {
  const renderer = type?.cellRenderer;
  return renderer && denseRenderers.has(renderer)
    ? DENSE_CELL_PADDING_CLASS
    : CELL_PADDING_CLASS;
}
