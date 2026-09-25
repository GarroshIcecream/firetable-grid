import type { ColumnGap } from "../layout";

export function ColumnSpacer({
  gap,
  header = false,
}: {
  gap: ColumnGap;
  header?: boolean;
}) {
  if (gap.count === 0) return null;
  const Tag = header ? "th" : "td";
  return (
    <Tag
      aria-hidden="true"
      data-column-spacer=""
      colSpan={gap.count}
      style={{
        boxSizing: "border-box",
        width: gap.width,
        minWidth: gap.width,
        maxWidth: gap.width,
        padding: 0,
        border: 0,
      }}
    />
  );
}
