// Vertical alignment for table body cells, driven by the wrap preference.
//
// A row is as tall as its tallest cell. With wrapping on, that height comes
// from multi-line renderers (score breakdown, wrapped titles), and centring
// would leave every short value floating in the middle of a tall row — so
// cells align to the top (ADR-0066 supersedes the table-wide rule from
// 224c38d2).
//
// With wrapping off, every cell is single-line but the row is still as tall as
// the thumbnail (`h-10`), so top-aligning pins numbers and badges to the upper
// edge instead of the image's axis. There, centring is the correct default.
//
// `ColumnType.cellAlignment` is the horizontal axis only; this is table-wide,
// exactly as the alignment it replaces was.

const WRAPPED_ALIGN_CLASS = "align-top";
const UNWRAPPED_ALIGN_CLASS = "align-middle";

export function cellVerticalAlignClass(wrapCells: boolean): string {
  return wrapCells ? WRAPPED_ALIGN_CLASS : UNWRAPPED_ALIGN_CLASS;
}
