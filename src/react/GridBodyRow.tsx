import type { RowData } from "@tanstack/react-table";
import { Fragment, memo, type ReactNode } from "react";
import type { SchemaColumn } from "../column-schema";
import {
  type CellSpec,
  type ColumnLayoutEntry,
  type ColumnWindow,
  ROW_INDEX_TEXT_CLASS,
  SELECTION_COLUMN_ID,
} from "../layout";
import { checkboxClick, type SelectionClick } from "../selection";
import { ColumnSpacer } from "./ColumnSpacer";
import type { DataGridProps } from "./DataGrid";

type ContentProps<TData extends RowData> = {
  row: TData;
  column: SchemaColumn<TData>;
  renderCell: DataGridProps<TData>["renderCell"];
};
function CellContent<TData extends RowData>({
  row,
  column,
  renderCell,
}: ContentProps<TData>): ReactNode {
  return renderCell(column, row);
}
const MemoCellContent = memo(CellContent) as typeof CellContent;

type BodyRowProps<TData extends RowData> = {
  row: TData;
  rowId?: string;
  selected: boolean;
  selectable: boolean;
  position?: number;
  layout: readonly ColumnLayoutEntry<SchemaColumn<TData>>[];
  cellSpecs: readonly CellSpec<TData>[];
  columnWindow?: ColumnWindow;
  renderCell: DataGridProps<TData>["renderCell"];
  renderCheckbox: NonNullable<DataGridProps<TData>["renderCheckbox"]>;
  onRowToggle: (id: string, click: SelectionClick) => void;
};
function BodyRow<TData extends RowData>({
  row,
  rowId,
  selected,
  selectable,
  position,
  layout,
  cellSpecs,
  columnWindow,
  renderCell,
  renderCheckbox,
  onRowToggle,
}: BodyRowProps<TData>) {
  return (
    <tr
      className={selected ? "ftg-row ftg-row-selected" : "ftg-row"}
      aria-selected={selectable ? selected : undefined}
    >
      {(
        columnWindow?.slots ??
        layout.map((_, index) => ({
          index,
          before: { start: index, count: 0, width: 0 },
        }))
      ).map(({ index, before }) => {
        const entry = layout[index];
        const column = entry.item;
        const spec = cellSpecs[index];
        return (
          <Fragment key={entry.id}>
            <ColumnSpacer gap={before} />
            <td
              aria-colindex={columnWindow ? index + 1 : undefined}
              data-column-id={entry.id}
              className={spec.staticClass}
              style={spec.style}
            >
              {entry.id === SELECTION_COLUMN_ID && rowId !== undefined ? (
                <span
                  onClickCapture={(e) =>
                    onRowToggle(rowId, checkboxClick({ shiftKey: e.shiftKey }))
                  }
                >
                  {renderCheckbox({
                    checked: selected,
                    indeterminate: false,
                    label: `Select row ${position ?? ""}`,
                    onToggle: () => {},
                  })}
                </span>
              ) : column.type.dataType === "index" ? (
                <span className={ROW_INDEX_TEXT_CLASS}>{position ?? ""}</span>
              ) : (
                <MemoCellContent
                  row={row}
                  column={column}
                  renderCell={renderCell}
                />
              )}
            </td>
          </Fragment>
        );
      })}
      {columnWindow ? <ColumnSpacer gap={columnWindow.after} /> : null}
    </tr>
  );
}
export const GridBodyRow = memo(BodyRow) as typeof BodyRow;
